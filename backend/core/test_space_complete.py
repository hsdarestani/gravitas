from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import KnowledgeResource, ResearchProject
from .platform_api import ensure_dual_workspaces
from .space_fs import create_node
from .space_items import create_item, item_markdown
from .space_models import NoteSpaceLink, ProjectSpaceLink, SpaceManagedItem, SpaceNode
from .space_moves import move_node, place_note, sync_project_moveaware


class CompleteSpaceFilesystemTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            'complete-space@example.com', 'complete-space@example.com', 'A-secure-password-123!'
        )
        self.workspaces = ensure_dual_workspaces(self.user)
        self.research = create_node(self.user, 'Research', SpaceNode.Kind.SUBSPACE, sync=False)
        self.category = create_node(self.user, 'Biology', SpaceNode.Kind.CATEGORY, parent=self.research, sync=False)

    @patch('core.space_moves.sync_node')
    @patch('core.space_moves._move_pair')
    @patch('core.space_moves._assert_remote_clean')
    @patch('core.nextcloud_bridge.ensure_user')
    @patch('core.space_moves.ensure_defaults')
    def test_category_rename_rewrites_every_nested_indexed_path(self, defaults, ensure_user, clean, move_pair, sync_node):
        defaults.return_value = {'research': self.research, 'projects': self.category}
        ensure_user.return_value = object()
        child = create_node(self.user, 'Cells', SpaceNode.Kind.CATEGORY, parent=self.category, sync=False)
        project = ResearchProject.objects.create(
            workspace=self.workspaces['research'], owner=self.user, title='Atlas', description='x'
        )
        project_link = ProjectSpaceLink.objects.create(
            project=project, user=self.user, category=self.category,
            folder_path='Space/Research/Biology/Atlas', metadata_path='Space/Research/Biology/Atlas.md',
        )
        note = KnowledgeResource.objects.create(
            workspace=self.workspaces['personal'], owner=self.user,
            kind=KnowledgeResource.Kind.NOTE, title='Field Note', body='x',
        )
        note_link = NoteSpaceLink.objects.create(
            resource=note, category=self.category,
            note_path='Space/Research/Biology/Field_Note.md',
            attachments_path='Space/Research/Biology/Field_Note',
        )
        managed = SpaceManagedItem.objects.create(
            owner=self.user, category=self.category, kind=SpaceManagedItem.Kind.REPOSITORY,
            title='Code Repo', body='', file_path='Space/Research/Biology/Code_Repo.md',
            folder_path='Space/Research/Biology/Code_Repo',
        )

        move_node(self.category, title='Life Science', parent=self.research, force=True)

        child.refresh_from_db(); project_link.refresh_from_db(); note_link.refresh_from_db(); managed.refresh_from_db()
        self.assertEqual(self.category.nextcloud_path, 'Space/Research/Life_Science')
        self.assertEqual(child.nextcloud_path, 'Space/Research/Life_Science/Cells')
        self.assertEqual(project_link.folder_path, 'Space/Research/Life_Science/Atlas')
        self.assertEqual(project_link.metadata_path, 'Space/Research/Life_Science/Atlas.md')
        self.assertEqual(note_link.note_path, 'Space/Research/Life_Science/Field_Note.md')
        self.assertEqual(managed.file_path, 'Space/Research/Life_Science/Code_Repo.md')
        move_pair.assert_called_once_with(
            ensure_user.return_value,
            'Space/Research/Biology', 'Space/Research/Life_Science',
            'Space/Research/Biology.md', 'Space/Research/Life_Science.md',
        )

    @patch('core.space_moves.sync_project')
    @patch('core.space_moves._move_pair')
    @patch('core.space_moves._assert_remote_clean')
    @patch('core.nextcloud_bridge.ensure_user')
    @patch('core.space_moves.ensure_defaults')
    def test_project_title_change_moves_folder_and_sidecar(self, defaults, ensure_user, clean, move_pair, sync_project):
        defaults.return_value = {'projects': self.category}
        ensure_user.return_value = object()
        project = ResearchProject.objects.create(
            workspace=self.workspaces['research'], owner=self.user, title='Old Name', description='x'
        )
        link = ProjectSpaceLink.objects.create(
            project=project, user=self.user, category=self.category,
            folder_path='Space/Research/Biology/Old_Name', metadata_path='Space/Research/Biology/Old_Name.md',
        )
        project.title = 'New Name'
        project.save(update_fields=['title', 'updated_at'])
        sync_project.side_effect = lambda project, user=None, force=False: ProjectSpaceLink.objects.get(pk=link.pk)

        result = sync_project_moveaware(project, self.user, force=True)
        result.refresh_from_db()
        self.assertEqual(result.folder_path, 'Space/Research/Biology/New_Name')
        self.assertEqual(result.metadata_path, 'Space/Research/Biology/New_Name.md')
        move_pair.assert_called_with(
            ensure_user.return_value,
            'Space/Research/Biology/Old_Name', 'Space/Research/Biology/New_Name',
            'Space/Research/Biology/Old_Name.md', 'Space/Research/Biology/New_Name.md',
        )

    @patch('core.space_moves.sync_note')
    @patch('core.space_moves.move_remote')
    @patch('core.space_moves._assert_remote_clean')
    @patch('core.nextcloud_bridge.ensure_user')
    @patch('core.space_moves.ensure_defaults')
    def test_note_rename_moves_md_attachment_folder_and_nested_notes(self, defaults, ensure_user, clean, move_remote, sync_note):
        defaults.return_value = {'notes': self.category}
        ensure_user.return_value = object()
        parent = KnowledgeResource.objects.create(
            workspace=self.workspaces['personal'], owner=self.user,
            kind=KnowledgeResource.Kind.NOTE, title='Parent Note', body='x',
        )
        child = KnowledgeResource.objects.create(
            workspace=self.workspaces['personal'], owner=self.user,
            kind=KnowledgeResource.Kind.NOTE, title='Child', body='x',
        )
        parent_link = NoteSpaceLink.objects.create(
            resource=parent, category=self.category,
            note_path='Space/Research/Biology/Parent_Note.md',
            attachments_path='Space/Research/Biology/Parent_Note',
        )
        child_link = NoteSpaceLink.objects.create(
            resource=child, parent_note=parent,
            note_path='Space/Research/Biology/Parent_Note/Child.md',
            attachments_path='',
        )
        parent.title = 'Renamed Note'
        parent.save(update_fields=['title', 'updated_at'])
        move_remote.return_value = True
        sync_note.side_effect = lambda resource, force=False: NoteSpaceLink.objects.get(pk=parent_link.pk)

        result = place_note(parent, category=self.category, attachments=True, force=True)
        result.refresh_from_db(); child_link.refresh_from_db()
        self.assertEqual(result.note_path, 'Space/Research/Biology/Renamed_Note.md')
        self.assertEqual(result.attachments_path, 'Space/Research/Biology/Renamed_Note')
        self.assertEqual(child_link.note_path, 'Space/Research/Biology/Renamed_Note/Child.md')

    def test_all_remaining_system_types_are_db_backed_and_tagged(self):
        subproject = create_item(
            self.user, kind='subproject', title='Protein Models', category=self.category, sync=False,
        )
        task = create_item(
            self.user, kind='task', title='Run Analysis', category=self.category, sync=False,
        )
        subtask = create_item(
            self.user, kind='subtask', title='Check Output', parent=task, sync=False,
        )
        repository = create_item(
            self.user, kind='repository', title='Model Code', category=self.category, sync=False,
        )
        self.assertEqual(subproject.file_path, 'Space/Research/Biology/Protein_Models.md')
        self.assertEqual(task.folder_path, 'Space/Research/Biology/Run_Analysis')
        self.assertEqual(subtask.file_path, 'Space/Research/Biology/Run_Analysis/Check_Output.md')
        self.assertEqual(repository.file_path, 'Space/Research/Biology/Model_Code.md')
        self.assertTrue(item_markdown(subproject).startswith('@subproject\n'))
        self.assertTrue(item_markdown(task).startswith('@task\n'))
        self.assertTrue(item_markdown(subtask).startswith('@subtask\n'))
        self.assertTrue(item_markdown(repository).startswith('@repository\n'))
