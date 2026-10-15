import io
import json
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from .models import ResearchProject, Workspace, KnowledgeResource
from .operating_models import OperatingTask
from .platform_runtime_v3 import ensure_platform_workspaces
from .task_reconciliation_export import snapshot


class ReconciliationExportTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser('manager', 'manager@example.test', 'pass')
        self.spaces = ensure_platform_workspaces(self.user)
        self.project = ResearchProject.objects.create(workspace=self.spaces['research'], owner=self.user, title='Revenue research')
        self.done = OperatingTask.objects.create(workspace=self.spaces['core'], owner=self.user, title='Historical work', status='done', project=self.project, definition_of_done='Evidence retained')
        self.done.checklist_items.create(title='Step', created_by=self.user, is_completed=True)
        self.done.board_comments.create(author=self.user, body='Source reference and context')
        self.note = KnowledgeResource.objects.create(workspace=self.spaces['research'], project=self.project, owner=self.user, kind='note', title='Strategy baseline', body='Do not export private note bodies', metadata={'private': 'excluded'})

    def test_closed_tasks_and_relations_included_without_writes_or_note_content(self):
        before = (OperatingTask.objects.count(), ResearchProject.objects.count(), self.done.updated_at)
        data = snapshot()
        self.done.refresh_from_db()
        self.assertEqual(before, (OperatingTask.objects.count(), ResearchProject.objects.count(), self.done.updated_at))
        self.assertTrue(data['read_only'])
        row = next(t for t in data['tasks'] if t['id'] == self.done.pk)
        self.assertEqual(row['status'], 'done')
        self.assertEqual(row['project_id'], self.project.pk)
        self.assertEqual(row['checklist'][0]['title'], 'Step')
        self.assertEqual(row['comments'][0]['body'], 'Source reference and context')
        self.assertNotIn('body', data['notes'][0])
        self.assertNotIn('metadata', data['notes'][0])

    def test_personal_workspace_content_excluded(self):
        personal = ResearchProject.objects.create(workspace=self.spaces['personal'], owner=self.user, title='Private')
        OperatingTask.objects.create(workspace=self.spaces['personal'], owner=self.user, title='Private task', definition_of_done='Private')
        data = snapshot()
        self.assertNotIn(personal.pk, [p['id'] for p in data['projects']])
        self.assertEqual(len(data['tasks']), 1)

    def test_default_command_remains_open_only_and_new_mode_includes_done(self):
        out = io.StringIO(); call_command('export_open_tasks', stdout=out)
        self.assertEqual(json.loads(out.getvalue())['count'], 0)
        out = io.StringIO(); call_command('export_open_tasks', reconciliation=True, stdout=out)
        self.assertEqual(json.loads(out.getvalue())['tasks'][0]['id'], self.done.pk)

    def test_invalid_workspace_fails_closed(self):
        with self.assertRaises(ValueError): snapshot(self.spaces['personal'].pk)
        with self.assertRaises(CommandError): call_command('export_open_tasks', workspace_id=self.spaces['core'].pk)
