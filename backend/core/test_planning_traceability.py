"""Regression coverage for mobile Planning and Core task traceability.

All data is disposable test database data; no Nextcloud or production writes.
"""
import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, SimpleTestCase, override_settings
from django.utils import timezone

from core.operating_models import Initiative, KeyResult, OperatingProcess, OperatingTask, StrategicObjective
from core.platform_runtime_v3 import ensure_platform_workspaces

User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False)
class PlanningTraceabilityTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='planning-regression@example.test', email='planning-regression@example.test',
            password='test-password-123',
        )
        self.core = ensure_platform_workspaces(self.user)['core']
        self.client.force_login(self.user)
        response = self.client.get('/api/operating/dashboard/')
        self.assertEqual(response.status_code, 200)
        self.process = OperatingProcess.objects.get(workspace=self.core, key='research')

    def post(self, path, data):
        return self.client.post(path, json.dumps(data), content_type='application/json')

    def patch(self, path, data):
        return self.client.patch(path, json.dumps(data), content_type='application/json')

    def objective(self, title, **extra):
        response = self.post('/api/operating/objectives/', {
            'title': title, 'owner_id': self.user.pk, **extra,
        })
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['objective']

    def kr(self, objective, title, **extra):
        response = self.post('/api/operating/key-results/', {
            'objective_id': objective['id'], 'owner_id': self.user.pk,
            'title': title, **extra,
        })
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['key_result']

    def test_planning_counts_do_not_double_count_and_schedule_is_explicit(self):
        today = timezone.localdate()
        objective = self.objective(
            'Measurable timeline', start_date=(today - timedelta(days=5)).isoformat(),
            due_date=(today + timedelta(days=5)).isoformat(),
        )
        kr = self.kr(objective, 'Progress measurable', target_value=100, baseline_value=0, current_value=25)
        initiative = Initiative.objects.create(
            workspace=self.core, key_result_id=kr['id'],
            process=self.process, title='Workstream', owner=self.user,
        )
        OperatingTask.objects.create(
            workspace=self.core, initiative=initiative, title='Open overdue',
            owner=self.user, definition_of_done='Report result',
            due_date=today - timedelta(days=1), status='active',
        )
        OperatingTask.objects.create(
            workspace=self.core, initiative=initiative, title='Completed',
            owner=self.user, definition_of_done='Report result',
            due_date=today - timedelta(days=1), status='done',
        )
        data = self.client.get('/api/operating/dashboard/').json()
        row = next(o for o in data['planning']['objectives'] if o['id'] == objective['id'])
        self.assertEqual(row['tasks'], {'total': 2, 'open': 1, 'done': 1, 'overdue': 1, 'oldest_overdue_days': 1})
        self.assertEqual(row['key_results'][0]['tasks'], row['tasks'])
        self.assertEqual(row['key_results'][0]['progress'], 25.0)
        self.assertEqual(row['key_results'][0]['schedule'], 'behind')
        self.assertEqual(row['key_results'][0]['expected_progress'], 50.0)
        self.assertEqual(row['key_results'][0]['variance_points'], -25.0)
        self.assertEqual(row['key_results'][0]['timeline_basis'], 'objective_start')

    def test_unmeasured_kr_does_not_invent_progress(self):
        objective = self.objective('Unmeasured objective')
        self.kr(objective, 'Qualitative outcome')
        data = self.client.get('/api/operating/dashboard/').json()
        row = next(o for o in data['planning']['objectives'] if o['id'] == objective['id'])
        self.assertIsNone(row['progress'])
        self.assertEqual(row['schedule'], 'unmeasured')
        self.assertEqual(row['key_results'][0]['tasks']['total'], 0)
        self.assertEqual(row['key_results'][0]['schedule'], 'unmeasured')

    def test_reordering_and_moving_kr_preserve_all_linked_tasks(self):
        original = self.objective('First')
        target = self.objective('Second')
        self.assertLess(original['sort_order'], target['sort_order'])
        new_order = self.patch('/api/operating/objectives/%s/' % target['id'], {
            'sort_order': original['sort_order'] - 1,
        })
        self.assertEqual(new_order.status_code, 200, new_order.content)
        ordered = self.client.get('/api/operating/dashboard/').json()['planning']['objectives']
        ids = [row['id'] for row in ordered]
        self.assertLess(ids.index(target['id']), ids.index(original['id']))
        kr = self.kr(original, 'Deliverable')
        initiative = Initiative.objects.create(
            workspace=self.core, key_result_id=kr['id'],
            process=self.process, title='Initiative', owner=self.user,
        )
        task = OperatingTask.objects.create(
            workspace=self.core, initiative=initiative, title='Child task',
            owner=self.user, definition_of_done='Checked', due_date=timezone.localdate(),
        )
        moved = self.patch('/api/operating/key-results/%s/' % kr['id'], {
            'objective_id': target['id'],
        })
        self.assertEqual(moved.status_code, 200, moved.content)
        self.assertEqual(moved.json()['key_result']['objective_id'], target['id'])
        task.refresh_from_db()
        self.assertEqual(task.initiative.key_result.objective_id, target['id'])
        planning = self.client.get('/api/operating/dashboard/').json()['planning']
        target_row = next(row for row in planning['objectives'] if row['id'] == target['id'])
        self.assertEqual(target_row['tasks']['total'], 1)
        self.assertEqual(self.patch('/api/operating/key-results/%s/' % kr['id'], {
            'sort_order': 'not-a-number',
        }).status_code, 400)

    def test_delete_keeps_linked_work_and_archive_hides_only_planning_row(self):
        objective = self.objective('Protected')
        kr = self.kr(objective, 'Protected KR')
        Initiative.objects.create(
            workspace=self.core, key_result_id=kr['id'],
            process=self.process, title='Must remain', owner=self.user,
        )
        self.assertEqual(self.client.delete('/api/operating/objectives/%s/' % objective['id']).status_code, 409)
        self.assertEqual(self.client.delete('/api/operating/key-results/%s/' % kr['id']).status_code, 409)
        result = self.patch('/api/operating/objectives/%s/' % objective['id'], {'status':'archived'})
        self.assertEqual(result.status_code, 200)
        self.assertTrue(KeyResult.objects.filter(pk=kr['id']).exists())
        planning = self.client.get('/api/operating/dashboard/').json()['planning']
        archived = next(obj for obj in planning['objectives'] if obj['id'] == objective['id'])
        self.assertEqual(archived['status'], 'archived')
        self.assertTrue(any(kr_row['id'] == kr['id'] for kr_row in archived['key_results']))
        self.assertEqual(planning['counts']['archived_objectives'], 1)
        self.assertEqual(planning['counts']['objectives'], 0)


class PlanningFrontendContractTests(SimpleTestCase):
    def test_inline_edit_reorder_and_mobile_counters(self):
        from pathlib import Path
        content = (Path(__file__).resolve().parents[2] / 'assets/ws/ws-views.js').read_text()
        planning = content.split('export function renderCorePlanning(host, { go }) {', 1)[1].split('const RESOURCE_VIEWS = {', 1)[0]
        for token in ('planning-compact', 'grid-template-columns:repeat(2,', 'objectiveFields',
                      'krFields', 'objective_id', 'sort_order', 'Delete', 'Archive',
                      'variance_points', 'Open task board', 'Hide archived', 'Restore'):
            self.assertIn(token, planning)


class MergeAuditUnitTests(SimpleTestCase):
    def test_private_report_only_proposes_candidates_and_keeps_source_log_counts(self):
        from core.management.commands.audit_work_graph import report_for
        samples = {
            'workspace': {'id': 9, 'organization_id': 1, 'name': 'Core'},
            'tasks': [
                dict(id=10, owner_id=2, project_id=7, initiative_id=5,
                     title=' Review DATA ', status='active', comments=[1],
                     checklist=[1, 2], attachments=[]),
                dict(id=11, owner_id=2, project_id=7, initiative_id=5,
                     title='review data', status='done', comments=[],
                     checklist=[], attachments=[1]),
            ],
            'projects': [
                dict(id=7, workspace_id=3, owner_id=2, title='Research',
                     canonical={'enabled': True, 'last_error': None}),
            ],
            'initiatives': [dict(id=5, key_result_id=4)],
            'notes': [], 'canonical_files': [],
        }
        report = report_for(samples, {'10': 3, '11': 1}, {10: 2}, {10: 1})
        self.assertTrue(report['read_only'])
        self.assertEqual(report['tasks']['total'], 2)
        self.assertEqual(report['tasks']['without_kr'], 0)
        self.assertEqual(report['tasks']['duplicates_exact_review_only'][0]['ids'], [10, 11])
        self.assertEqual(report['logs']['activity_events'], 4)
        self.assertEqual(report['logs']['daily_report_links'], 2)
        self.assertEqual(report['logs']['time_log_note_projections'], 1)
        self.assertEqual(report['logs']['board_comments'], 1)
        self.assertEqual(report['logs']['attachments'], 1)
