import json
from datetime import datetime, timezone as dt_timezone
from django.contrib.auth import get_user_model
from django.test import TestCase
from core.layer_models import ActivityEvent
from core.models import ResearchProject, WorkspaceMembership
from core.operating_models import OperatingTask
from core.platform_runtime_v3 import ensure_platform_workspaces
from core.canonical_models import CanonicalFile, CanonicalFileRevision
from core.task_dates import recover_task_dates


def at(day, hour=10):
    return datetime(2026, 9, day, hour, tzinfo=dt_timezone.utc)


class TaskDatesTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_user(username='dates-admin', email='dates-admin@example.test')
        self.core = ensure_platform_workspaces(self.admin)['core']
        WorkspaceMembership.objects.filter(workspace=self.core, user=self.admin).update(role='admin')
        self.task = OperatingTask.objects.create(workspace=self.core, owner=self.admin, title='Date test',
            definition_of_done='Recorded', status='draft', created_at=at(1))
        self.client.force_login(self.admin)

    def patch(self, payload):
        return self.client.patch(f'/api/operating/task-board/{self.task.pk}/',
            data=json.dumps(payload), content_type='application/json')

    def test_real_transitions_capture_dates_and_reopening_keeps_first_start(self):
        self.assertIsNone(self.task.started_at)
        self.task.status = 'active'
        self.task.save(update_fields=['status', 'updated_at'])
        first = self.task.started_at
        self.assertIsNotNone(first)
        self.task.refresh_from_db()
        self.assertEqual(self.task.started_at, first)
        self.task.status = 'done'
        self.task.save(update_fields=['status', 'updated_at'])
        self.assertIsNotNone(self.task.completed_at)
        completed = self.task.completed_at
        self.task.title = 'Renamed'
        self.task.save()
        self.assertEqual(self.task.completed_at, completed)
        self.task.status = 'active'
        self.task.save(update_fields=['status', 'updated_at'])
        self.assertIsNone(self.task.completed_at)
        self.assertEqual(self.task.started_at, first)
        self.assertIsNone(self.task.due_date)

    def test_admin_can_correct_dates_separately_from_due_date(self):
        response = self.patch({'created_at': at(1).isoformat(), 'started_at': at(2).isoformat(),
            'completed_at': at(3).isoformat(), 'due_date': '2026-09-20', 'status': 'done'})
        self.assertEqual(response.status_code, 200, response.content)
        task = response.json()['task']
        self.assertEqual(task['completed_at'], at(3).isoformat())
        self.assertEqual(task['due_date'], '2026-09-20')
        response = self.patch({'title': 'Title only'})
        self.assertEqual(response.json()['task']['completed_at'], at(3).isoformat())
        self.assertEqual(response.json()['task']['date_provenance']['started_at']['source'], 'admin')

    def test_member_cannot_rewrite_audit_dates(self):
        member = get_user_model().objects.create_user(username='dates-member', email='dates-member@example.test')
        WorkspaceMembership.objects.create(workspace=self.core, user=member, role='member')
        self.client.force_login(member)
        response = self.patch({'created_at': at(2).isoformat()})
        self.assertEqual(response.status_code, 403, response.content)
        self.task.refresh_from_db()
        self.assertEqual(self.task.created_at, at(1))

    def test_invalid_chronology_and_naive_datetimes_are_rejected(self):
        for payload in ({'started_at': at(2).isoformat(), 'completed_at': at(1).isoformat()},
                        {'created_at': '2026-09-01T10:00:00'}, {'created_at': None}):
            response = self.patch(payload)
            self.assertEqual(response.status_code, 400, response.content)

    def event(self, action, detail, date):
        row = ActivityEvent.objects.create(layer='core', action=action, object_type='operating_task',
            object_id=str(self.task.pk), detail=detail)
        ActivityEvent.objects.filter(pk=row.pk).update(created_at=date)
        return row

    def make_imported(self, status='done'):
        OperatingTask.objects.filter(pk=self.task.pk).update(created_at=at(20), started_at=None,
            completed_at=at(20) if status == 'done' else None, date_provenance={}, status=status,
            source_key='historical-date-test')

    def test_recovery_uses_history_is_idempotent_and_never_invents_due(self):
        self.make_imported()
        self.event('task.created', {'status': 'draft'}, at(1))
        self.event('task.moved', {'from_status': 'draft', 'to_status': 'active'}, at(2))
        self.event('task.updated', {'changes': {'status': {'from': 'active', 'to': 'done'}}}, at(4))
        report = recover_task_dates(apply=True)
        self.task.refresh_from_db()
        self.assertEqual(self.task.created_at, at(1))
        self.assertEqual(self.task.started_at, at(2))
        self.assertEqual(self.task.completed_at, at(4))
        self.assertIsNone(self.task.due_date)
        self.assertGreater(report['changed'], 0)
        self.assertEqual(recover_task_dates(apply=True)['changed'], 0)

    def test_latest_explicit_deadline_clear_wins_over_old_deadline(self):
        self.make_imported('active')
        self.event('task.updated', {'changes': {'due_date': {'from': None, 'to': '2026-09-10'}}}, at(2))
        self.event('task.updated', {'changes': {'due_date': {'from': '2026-09-10', 'to': None}}}, at(3))
        recover_task_dates(apply=True)
        self.task.refresh_from_db()
        self.assertIsNone(self.task.due_date)

    def test_recovery_restores_recorded_deadline_and_protects_admin_corrections(self):
        self.make_imported('active')
        self.event('task.moved', {'to_status': 'active'}, at(3))
        self.event('task.updated', {'changes': {'due_date': {'from': None, 'to': '2026-09-10'}}}, at(4))
        recover_task_dates(apply=True)
        self.task.refresh_from_db()
        self.assertEqual(str(self.task.due_date), '2026-09-10')
        response = self.patch({'created_at': at(1).isoformat(), 'started_at': at(2).isoformat()})
        self.assertEqual(response.status_code, 200, response.content)
        recover_task_dates(apply=True)
        self.task.refresh_from_db()
        self.assertEqual(self.task.started_at, at(2))

    def test_canonical_snapshot_recovery_marks_earliest_known_start(self):
        self.make_imported()
        project = ResearchProject.objects.create(workspace=ensure_platform_workspaces(self.admin)['research'],
            owner=self.admin, title='Historical project')
        file = CanonicalFile.objects.create(project=project, path='task.json', object_type='OperatingTask', object_id=self.task.pk)
        rev = CanonicalFileRevision.objects.create(file=file, content=json.dumps({'type': 'OperatingTask',
            'id': self.task.pk, 'fields': {'status': 'active', 'due_date': '2026-09-12'}}))
        CanonicalFileRevision.objects.filter(pk=rev.pk).update(created_at=at(2))
        recover_task_dates(apply=True)
        self.task.refresh_from_db()
        self.assertEqual(self.task.started_at, at(2))
        self.assertEqual(self.task.date_provenance['started_at']['confidence'], 'earliest_known')
        self.assertEqual(str(self.task.due_date), '2026-09-12')

    def test_project_and_core_payloads_include_same_lifecycle_dates(self):
        from core.project_cockpit import _task_json as project_json
        from core.task_board_api import _task_json as core_json
        self.task.status = 'active'
        self.task.save()
        self.assertEqual(project_json(self.task, self.admin)['started_at'], core_json(self.task)['started_at'])
        self.assertEqual(project_json(self.task, self.admin)['created_at'], core_json(self.task)['created_at'])

    def test_old_canonical_schema_preserves_recovered_lifecycle_dates(self):
        from core.canonical_projects import encode, decode
        self.task.project = ResearchProject.objects.create(workspace=ensure_platform_workspaces(self.admin)['research'],
            owner=self.admin, title='Canonical dates')
        self.task.save()
        payload = json.loads(encode(self.task))
        self.assertEqual(payload['schema'], 3)
        payload['schema'] = 2
        for key in ('created_at', 'started_at', 'date_provenance'):
            del payload['fields'][key]
        restored = decode(self.task, json.dumps(payload))
        self.assertEqual(restored['created_at'], self.task.created_at)

    def test_archiving_preserves_completion_even_when_an_older_writer_clears_it(self):
        self.task.status = 'done'
        self.task.save()
        ended = self.task.completed_at
        self.task.status = 'archived'
        self.task.completed_at = None
        self.task.save(update_fields=['status', 'completed_at'])
        self.task.refresh_from_db()
        self.assertEqual(self.task.completed_at, ended)

    def test_idempotency_key_does_not_suppress_new_task_activation(self):
        task = OperatingTask.objects.create(workspace=self.core, owner=self.admin, title='New Pulsar task',
            definition_of_done='Recorded', status='active', source_key='pulsar:test-request')
        self.assertIsNotNone(task.started_at)
        self.assertEqual(task.date_provenance['started_at']['source'], 'observed')
        imported = OperatingTask.objects.create(workspace=self.core, owner=self.admin, title='Imported history',
            definition_of_done='Recorded', status='active', source_key='historical:test',
            source_metadata={'migration_run_id': 'old-import', 'activity_date_raw': '2026-09-01'})
        self.assertIsNone(imported.started_at)

    def test_legacy_pulsar_creation_event_recovers_activation_without_status_field(self):
        self.make_imported('active')
        self.event('task.created', {'source': 'telegram', 'title': 'Date test'}, at(2))
        recover_task_dates(apply=True)
        self.task.refresh_from_db()
        self.assertEqual(self.task.started_at, at(2))
        self.assertEqual(self.task.date_provenance['started_at']['confidence'], 'recorded')
