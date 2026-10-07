import json
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import TestCase

from . import cloud, space_fs
from .models import KnowledgeResource, ProjectMembership, ResearchProject
from .platform_access import policy_for
from .platform_api import ensure_dual_workspaces
from .platform_models import ObjectPolicy, ResearchProjectProfile
from .research_models import DocumentAnnotation
from .space_fs import create_node
from .space_models import ProjectSpaceLink, SpaceNode


class SpaceAwareProjectCreationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            'space-create@example.com',
            'space-create@example.com',
            'A-secure-password-123!',
        )
        self.client.force_login(self.user)
        self.workspaces = ensure_dual_workspaces(self.user)
        self.research = create_node(self.user, 'Research', SpaceNode.Kind.SUBSPACE, sync=False)
        self.category = create_node(
            self.user,
            'Cell Biology',
            SpaceNode.Kind.CATEGORY,
            parent=self.research,
            sync=False,
        )

    def test_project_is_created_in_selected_parent_category_before_sync(self):
        response = self.client.post(
            '/api/platform/projects/',
            data=json.dumps({
                'title': 'Cell Atlas Project',
                'category': 'client',
                'visibility': 'invite',
                'space_category_id': self.category.pk,
                'research_question': 'Which states matter?',
                'description': 'A complete brief',
                'client_name': 'Client A',
                'requester_name': 'Requester B',
                'requester_email': 'requester@example.com',
                'confidentiality': 'restricted',
                'required_skills': ['Python', 'biology'],
                'application_open': True,
                'secure_data_room': True,
                'allow_public_links': False,
                'allow_downloads': False,
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        project = ResearchProject.objects.get(title='Cell Atlas Project')
        link = ProjectSpaceLink.objects.get(project=project, user=self.user)
        self.assertEqual(link.category, self.category)
        self.assertEqual(link.folder_path, 'Space/Research/Cell_Biology/Cell_Atlas_Project')
        self.assertEqual(link.metadata_path, 'Space/Research/Cell_Biology/Cell_Atlas_Project.md')
        self.assertEqual(response.json()['project']['space_placement']['category_id'], self.category.pk)

        profile = ResearchProjectProfile.objects.get(project=project)
        self.assertEqual(profile.requester_email, 'requester@example.com')
        self.assertEqual(profile.required_skills, ['Python', 'biology'])
        self.assertFalse(profile.allow_downloads)

        # CoreConfig wires the complete renderer into every Space sync entry
        # point at app startup. This regression test exercises that runtime hook
        # rather than testing only the standalone renderer.
        markdown = space_fs._project_markdown(project, self.user)
        self.assertIn('requester_email: "requester@example.com"', markdown)
        self.assertIn('required_skills: ["Python", "biology"]', markdown)
        self.assertIn('storage_contract: "space-index+team-folder-data"', markdown)
        self.assertIn(f'team_folder_mount: "{cloud.project_mountpoint(project)}"', markdown)

    def test_project_create_rejects_category_owned_by_another_user(self):
        other = get_user_model().objects.create_user(
            'other-space@example.com',
            'other-space@example.com',
            'A-secure-password-123!',
        )
        other_research = create_node(other, 'Research', SpaceNode.Kind.SUBSPACE, sync=False)
        other_category = create_node(other, 'Private', SpaceNode.Kind.CATEGORY, parent=other_research, sync=False)
        before = ResearchProject.objects.count()
        response = self.client.post(
            '/api/platform/projects/',
            data=json.dumps({
                'title': 'Should Not Exist',
                'space_category_id': other_category.pk,
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'invalid_space_category')
        self.assertEqual(ResearchProject.objects.count(), before)


class DocumentAnnotationApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            'annotations@example.com',
            'annotations@example.com',
            'A-secure-password-123!',
        )
        self.client.force_login(self.user)
        spaces = ensure_dual_workspaces(self.user)
        self.project = ResearchProject.objects.create(
            workspace=spaces['research'],
            owner=self.user,
            title='Annotation Project',
            description='x',
        )
        ProjectMembership.objects.create(
            project=self.project,
            user=self.user,
            role=ProjectMembership.Role.OWNER,
        )
        ResearchProjectProfile.objects.create(project=self.project)
        policy_for(
            self.project,
            create=True,
            created_by=self.user,
            default_visibility=ObjectPolicy.Visibility.WORKSPACE,
        )
        self.note = KnowledgeResource.objects.create(
            workspace=spaces['research'],
            project=self.project,
            owner=self.user,
            kind=KnowledgeResource.Kind.NOTE,
            title='Review Note',
            body='A sentence to review.',
        )
        policy_for(
            self.note,
            create=True,
            created_by=self.user,
            default_visibility=ObjectPolicy.Visibility.PROJECT,
        )

    def test_annotation_thread_create_reply_resolve_and_list(self):
        created = self.client.post(
            '/api/platform/annotations/',
            data=json.dumps({
                'resource_id': self.note.pk,
                'body': 'Please verify this statement.',
                'anchor': {'quote': 'A sentence'},
            }),
            content_type='application/json',
        )
        self.assertEqual(created.status_code, 201, created.content)
        root_id = created.json()['annotation']['id']
        self.assertEqual(created.json()['annotation']['anchor']['quote'], 'A sentence')

        reply = self.client.post(
            '/api/platform/annotations/',
            data=json.dumps({
                'resource_id': self.note.pk,
                'parent_id': root_id,
                'body': 'Verified.',
            }),
            content_type='application/json',
        )
        self.assertEqual(reply.status_code, 201, reply.content)
        self.assertEqual(reply.json()['annotation']['parent_id'], root_id)
        self.assertEqual(reply.json()['annotation']['anchor'], {})

        resolved = self.client.patch(
            f'/api/platform/annotations/{root_id}/',
            data=json.dumps({'resolved': True}),
            content_type='application/json',
        )
        self.assertEqual(resolved.status_code, 200, resolved.content)
        self.assertTrue(resolved.json()['annotation']['resolved'])
        self.assertFalse(DocumentAnnotation.objects.filter(resource=self.note, resolved=False).exists())

        listing = self.client.get(f'/api/platform/annotations/?resource_id={self.note.pk}')
        self.assertEqual(listing.status_code, 200, listing.content)
        self.assertEqual(len(listing.json()['annotations']), 2)
        self.assertEqual(listing.json()['resource']['project_id'], self.project.pk)

    def test_standalone_note_has_no_shared_annotation_boundary(self):
        note = KnowledgeResource.objects.create(
            workspace=self.note.workspace,
            owner=self.user,
            kind=KnowledgeResource.Kind.NOTE,
            title='Private note',
            body='private',
        )
        response = self.client.get(f'/api/platform/annotations/?resource_id={note.pk}')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()['error'], 'resource_not_found_or_not_project_linked')


class SpaceWorkspaceAssetContractTests(TestCase):
    def test_workspace_loads_space_integration_without_native_dialogs(self):
        root = Path(__file__).resolve().parents[2]
        workspace = (root / 'workspace.html').read_text(encoding='utf-8')
        script = (root / 'assets' / 'ws' / 'ws-space-integration.js').read_text(encoding='utf-8')
        self.assertIn('ws-space-integration.css?v=20260917-1', workspace)
        self.assertIn('installSpaceWorkspaceIntegration', workspace)
        self.assertIn('space_category_id', script)
        self.assertIn('/platform/space/notes/?remote=1', script)
        self.assertIn('/platform/space/reconcile/', script)
        self.assertIn('/platform/annotations/', script)
        self.assertNotIn('.showModal(', script)
        self.assertNotIn("createElement('dialog')", script)
        self.assertNotIn('createElement("dialog")', script)
