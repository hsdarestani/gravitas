import hashlib
import io
import json
import tempfile
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings

from core.layer_models import ActivityEvent
from core.models import ResearchProject
from core.operating_models import (
    OperatingTask, OperatingTaskComment, OperatingTaskConsolidation,
    WorkStatus,
)
from core.management.commands.consolidate_task_history import task_fingerprint
from core.platform_runtime_v3 import ensure_platform_workspaces

User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False)
class TaskConsolidationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_superuser(
            'consolidation-test@example.test', 'consolidation-test@example.test', 'pass123ABC!',
        )
        spaces = ensure_platform_workspaces(self.user)
        self.core = spaces['core']
        self.project = ResearchProject.objects.create(
            workspace=spaces['research'], title='Historical task project', owner=self.user)
        self.client.force_login(self.user)
        self.target = OperatingTask.objects.create(
            workspace=self.core, project=self.project, owner=self.user,
            title='Fix input positioning and alignment', status=WorkStatus.DONE,
            source_key='gdocs:historical-target', definition_of_done='Source preserved.')
        self.source = OperatingTask.objects.create(
            workspace=self.core, project=self.project, owner=self.user,
            title='Align input controls and positioning', status=WorkStatus.DONE,
            source_key='gdocs:historical-source', definition_of_done='Source preserved.')

    def plan(self):
        return {
            'schema': 1,
            'pairs': [{
                'source': self.source.pk, 'target': self.target.pk,
                'source_fingerprint': task_fingerprint(self.source),
                'target_fingerprint': task_fingerprint(self.target),
                'reason': 'Reviewed overlapping historical UI work, retaining both original references.',
            }]
        }

    def test_merge_does_not_rewrite_ids_or_logs_and_aggregates_reads(self):
        comment = OperatingTaskComment.objects.create(
            task=self.source, author=self.user, body='Historic evidence preserved')
        event = ActivityEvent.objects.create(
            actor=self.user, layer=ActivityEvent.Layer.CORE,
            action='task.recorded', object_type='operating_task',
            object_id=str(self.source.pk), detail={'origin': 'source'})
        with tempfile.TemporaryDirectory() as base:
            plan_path = Path(base) / 'plan.json'
            audit_path = Path(base) / 'journal.json'
            plan_path.write_text(json.dumps(self.plan()))
            # Dry run must perform no database writes.
            call_command('consolidate_task_history', plan=str(plan_path), stdout=io.StringIO())
            self.assertEqual(OperatingTaskConsolidation.objects.count(), 0)
            digest = hashlib.sha256(plan_path.read_bytes()).hexdigest()
            call_command('consolidate_task_history', plan=str(plan_path), apply=True,
                         expected_plan_sha=digest, audit_output=audit_path, stdout=io.StringIO())
            self.assertEqual(OperatingTaskConsolidation.objects.count(), 1)
            self.assertTrue(audit_path.exists())
            self.target.refresh_from_db()
            self.source.refresh_from_db()
            self.assertEqual(self.target.status, 'done')
            self.assertEqual(self.source.status, 'done')
            self.assertEqual(self.source.source_key, 'gdocs:historical-source')
            self.assertEqual(self.source.project_id, self.target.project_id)
            board = self.client.get('/api/operating/task-board/').json()
            ids = [task['id'] for task in board['tasks']]
            self.assertIn(self.target.pk, ids)
            self.assertNotIn(self.source.pk, ids)
            detail = self.client.get(f'/api/operating/task-board/{self.target.pk}/').json()
            self.assertEqual(detail['task']['consolidated_sources'][0]['id'], self.source.pk)
            comments = self.client.get(
                f'/api/operating/tasks/{self.target.pk}/comments/').json()['comments']
            self.assertTrue(any(row['id'] == comment.pk for row in comments))
            history = self.client.get(
                f'/api/operating/tasks/{self.target.pk}/history/').json()['events']
            self.assertTrue(any(row['id'] == event.pk and row['origin_task_id'] == self.source.pk
                                for row in history))
            forbidden = self.client.patch(
                f'/api/operating/task-board/{self.source.pk}/', json.dumps({'title':'unsafe'}),
                content_type='application/json')
            self.assertEqual(forbidden.status_code, 409)
            self.assertEqual(forbidden.json()['canonical_task_id'], self.target.pk)
            # A reviewed inverse can drop only the alias row and unhide source.
            OperatingTaskConsolidation.objects.all().delete()
            restored = self.client.get('/api/operating/task-board/').json()
            self.assertIn(self.source.pk, [task['id'] for task in restored['tasks']])

    def test_stale_version_fails_closed(self):
        plan = self.plan()
        self.source.title = 'Changed independently'
        self.source.save(update_fields=['title'])
        with tempfile.TemporaryDirectory() as base:
            plan_path = Path(base)/'stale.json'
            plan_path.write_text(json.dumps(plan))
            with self.assertRaisesMessage(Exception, 'source_fingerprint_stale'):
                call_command('consolidate_task_history', plan=str(plan_path), stdout=io.StringIO())

    def test_different_project_rejected(self):
        with tempfile.TemporaryDirectory() as base:
            plan_path = Path(base)/'scope.json'
            plan = self.plan()
            self.source.project = None
            self.source.save(update_fields=['project'])
            plan['pairs'][0]['source_fingerprint'] = task_fingerprint(self.source)
            plan_path.write_text(json.dumps(plan))
            with self.assertRaisesMessage(Exception, 'different_scope_or_not_completed'):
                call_command('consolidate_task_history', plan=str(plan_path), stdout=io.StringIO())
