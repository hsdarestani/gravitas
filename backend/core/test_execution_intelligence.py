"""Acceptance evidence for lifecycle truth, authorization and shared analytics."""
import json
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction
from django.test import SimpleTestCase, TestCase
from django.test.utils import CaptureQueriesContext
from django.db import connection

from .execution_analytics import DAY, annotate_graph, apply_forecasts, business_days, task_metrics
from .execution_history import execution_source
from .layer_models import ActivityEvent
from .models import WorkspaceMembership
from .operating_models import OperatingTask
from .platform_access import access_batch, can_view, policy_for
from .platform_models import ObjectPolicy
from .platform_runtime_v3 import ensure_platform_workspaces


def at(day, hour=0):
    return datetime(2026, 9, day, hour, tzinfo=timezone.utc)


CONFIG = {'timezone': 'UTC', 'inactivity_business_days': 3, 'business_weekdays': [0, 1, 2, 3, 4]}


def task(**overrides):
    return {'id': 1, 'title': 'Evidence task', 'priority': 'p1', 'status': 'done',
            'created_at': at(1).isoformat(), 'started_at': None,
            'completed_at': at(18).isoformat(), 'due_date': '2026-09-17',
            'parent_id': None, 'dependency_id': None, 'milestone_id': None,
            **overrides}


def event(day, before, after, source='human'):
    return {'id': day, 'created_at': at(day).isoformat(), 'action': 'task.lifecycle',
            'actor_id': 1, 'detail': {'source': source, 'changes': {'status': {'from': before, 'to': after}}}}


class ExecutionMetricTests(SimpleTestCase):
    def test_segmented_lifecycle_acceptance_b(self):
        events = [event(1, None, 'draft'), event(3, 'draft', 'active'), event(8, 'active', 'blocked'),
                  event(13, 'blocked', 'active'), event(18, 'active', 'done')]
        result = task_metrics(task(), events, at(20), CONFIG)
        self.assertEqual([part['state'] for part in result['segments']], ['waiting', 'active', 'blocked', 'active'])
        self.assertEqual(result['waiting_seconds'], 2 * DAY)
        self.assertEqual(result['active_seconds'], 10 * DAY)
        self.assertEqual(result['blocked_seconds'], 5 * DAY)
        self.assertEqual(result['lead_seconds'], 17 * DAY)
        self.assertEqual(result['cycle_seconds'], 15 * DAY)
        self.assertEqual(result['segments'][-1]['end'], at(18).isoformat())

    def test_missing_history_never_becomes_active_labor_acceptance_c(self):
        result = task_metrics(task(), [], at(20), CONFIG)
        self.assertIsNone(result['active_seconds'])
        self.assertIsNone(result['blocked_seconds'])
        self.assertIsNone(result['cycle_seconds'])
        self.assertIsNone(result['work_seconds'])
        self.assertEqual(result['segments'][0]['state'], 'unknown')

    def test_completed_without_timestamp_does_not_extend_to_today(self):
        result = task_metrics(task(completed_at=None), [], at(20), CONFIG)
        self.assertEqual(result['segments'], [])
        self.assertIsNone(result['lead_seconds'])

    def test_out_of_order_duplicate_events_do_not_double_count(self):
        original = [event(1, None, 'active'), event(8, 'active', 'blocked'), event(18, 'blocked', 'done')]
        result = task_metrics(task(), [original[2], original[0], original[1], original[1]], at(20), CONFIG)
        self.assertEqual(result['active_seconds'], 7 * DAY)
        self.assertEqual(result['blocked_seconds'], 10 * DAY)

    def test_reopened_task_retains_final_completion_and_history_acceptance_i(self):
        result = task_metrics(task(), [event(1, None, 'active'), event(8, 'active', 'done'),
            event(13, 'done', 'active'), event(18, 'active', 'done')], at(20), CONFIG)
        self.assertEqual(result['reopen_count'], 1)
        self.assertEqual(result['active_seconds'], 12 * DAY)
        self.assertEqual(result['cycle_seconds'], 17 * DAY)
        self.assertEqual(result['completed_at'], at(18).isoformat())

    def test_sync_does_not_reset_human_inactivity(self):
        result = task_metrics(task(status='blocked', completed_at=None), [event(1, None, 'active'), event(18, 'active', 'blocked', 'nextcloud')], at(20), CONFIG)
        self.assertEqual(result['last_human_activity'], at(1).isoformat())
        self.assertTrue(result['stalled'])

    def test_unknown_last_activity_is_not_a_stalled_fact(self):
        result = task_metrics(task(status='active', completed_at=None), [], at(20), CONFIG)
        self.assertIsNone(result['inactivity_seconds'])
        self.assertFalse(result['stalled'])

    def test_overlap_union_per_person_preserves_parallel_effort(self):
        logs = [{'start': at(3).isoformat(), 'end': at(3, 2).isoformat(), 'owner_id': 1},
                {'start': at(3, 1).isoformat(), 'end': at(3, 3).isoformat(), 'owner_id': 1},
                {'start': at(3, 1).isoformat(), 'end': at(3, 2).isoformat(), 'owner_id': 2}]
        result = task_metrics(task(), [], at(20), CONFIG, logs)
        self.assertEqual(result['work_seconds'], 4 * 3600)

    def test_estimated_start_is_not_precise_state_evidence(self):
        result = task_metrics(task(started_at=at(3).isoformat(), date_provenance={'started_at': {'confidence': 'inferred'}}), [], at(20), CONFIG)
        self.assertIsNone(result['active_seconds'])
        self.assertIsNone(result['cycle_seconds'])

    def test_recorded_start_is_cycle_evidence_but_not_continuous_state_history(self):
        result = task_metrics(task(started_at=at(3).isoformat()), [], at(20), CONFIG)
        self.assertIsNone(result['active_seconds'])
        self.assertEqual(result['cycle_seconds'], 15 * DAY)

    def test_business_days_weekends_and_zone(self):
        self.assertEqual(business_days(at(4), at(7)), 1)  # Friday to Monday
        self.assertEqual(business_days(at(4), at(7), weekdays=[5, 6, 0, 1, 2]), 3)
        self.assertEqual(business_days(at(4, 22), at(5, 2), zone='Asia/Tehran'), 0)

    def test_contradictory_current_snapshot_leaves_unknown_tail(self):
        result = task_metrics(task(status='blocked', completed_at=None), [event(1, None, 'active')], at(20), CONFIG)
        self.assertEqual(result['segments'][-1]['state'], 'unknown')
        self.assertEqual(result['active_seconds'], 0)

    def test_weighted_leaf_rollup_and_milestone_blocker_acceptance_d_e(self):
        parent = task(id=1, status='active', completed_at=None, milestone_id=9)
        small = task(id=2, parent_id=1, execution_weight=1)
        big = task(id=3, parent_id=1, execution_weight=9, status='blocked', completed_at=None)
        for row in [parent, small, big]:
            row['execution'] = task_metrics(row, [], at(20), CONFIG)
        milestones = annotate_graph([parent, small, big], [{'id': 9, 'title': 'Real linked milestone', 'status': 'active', 'due_date': '2026-09-30'}], at(20))
        self.assertAlmostEqual(milestones[0]['progress'], .1)
        self.assertEqual(milestones[0]['delivery_status'], 'at_risk')
        self.assertEqual(milestones[0]['critical_task_ids'], [3])
        self.assertEqual(parent['execution']['rollup']['leaf_count'], 2)
        self.assertIsNone(milestones[0]['forecast'])

    def test_forecasting_requires_a_sufficient_recorded_cohort(self):
        samples = []
        for pk in range(1, 9):
            row = task(id=pk, project_id=3, started_at=at(1).isoformat())
            row['execution'] = task_metrics(row, [event(1, None, 'active'), event(18, 'active', 'done')], at(20), CONFIG)
            samples.append(row)
        current = task(id=9, project_id=3, status='active', started_at=at(19).isoformat(), completed_at=None)
        current['execution'] = task_metrics(current, [event(19, None, 'active')], at(20), CONFIG)
        rows = samples + [current]
        annotate_graph(rows, [], at(20))
        apply_forecasts(rows, [], at(20))
        self.assertIsNotNone(current['execution']['forecast'])
        self.assertEqual(current['execution']['forecast_sample_size'], 8)
        self.assertEqual(current['execution']['forecast_confidence'], 'limited')
        current['status'] = 'blocked'
        current['execution']['forecast'] = None
        apply_forecasts(rows, [], at(20))
        self.assertIsNone(current['execution']['forecast'])

    def test_estimated_completion_does_not_produce_precise_duration(self):
        row = task(date_provenance={'completed_at': {'confidence': 'inferred', 'precision': 'day'}})
        result = task_metrics(row, [], at(20), CONFIG)
        self.assertIsNone(result['lead_seconds'])
        self.assertTrue(result['completion_estimated'])


class ExecutionApiTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_user(username='execution-admin', email='execution-admin@example.test')
        self.core = ensure_platform_workspaces(self.admin)['core']
        WorkspaceMembership.objects.filter(workspace=self.core, user=self.admin).update(role='admin')
        self.client.force_login(self.admin)
        self.row = OperatingTask.objects.create(workspace=self.core, owner=self.admin, title='Execution test', status='draft', definition_of_done='Evidence recorded')

    def dashboard(self):
        response = self.client.get('/api/operating/execution/')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_endpoint_uses_server_facts_no_network_and_private_cache(self):
        with patch('requests.sessions.Session.request', side_effect=AssertionError('Analytics must not perform network sync')):
            response = self.client.get('/api/operating/execution/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        row = next(t for t in response.json()['tasks'] if t['id'] == self.row.pk)
        self.assertEqual(row['title'], self.row.title)
        self.assertIsNone(row['execution']['work_seconds'])

    def test_model_audits_service_writes_and_due_date_changes_acceptance_l(self):
        with execution_source('nextcloud'):
            self.row.status = 'blocked'
            self.row.due_date = at(25).date()
            self.row.save(update_fields=['status', 'due_date', 'updated_at'])
        event = ActivityEvent.objects.filter(action='task.lifecycle', object_id=str(self.row.pk)).first()
        self.assertEqual(event.detail['source'], 'nextcloud')
        self.assertFalse(event.detail['meaningful_human'])
        self.assertEqual(event.detail['changes']['due_date']['to'], '2026-09-25')

    def test_canonical_refresh_is_never_human_activity(self):
        from .canonical_projects import suppress
        with execution_source('human', self.admin.pk), suppress():
            self.row.title = 'Projection refresh'
            self.row.save()
        event = ActivityEvent.objects.filter(action='task.lifecycle', object_id=str(self.row.pk)).first()
        self.assertEqual(event.detail['source'], 'canonical_sync')
        self.assertFalse(event.detail['meaningful_human'])

    def test_event_rolls_back_with_the_task(self):
        count = ActivityEvent.objects.filter(action='task.lifecycle').count()
        try:
            with transaction.atomic():
                self.row.title = 'Rolled back'
                self.row.save()
                raise ValueError('rollback')
        except ValueError:
            pass
        self.row.refresh_from_db()
        self.assertEqual(self.row.title, 'Execution test')
        self.assertEqual(ActivityEvent.objects.filter(action='task.lifecycle').count(), count)

    def test_dependency_cycle_and_cross_workspace_rejected(self):
        second = OperatingTask.objects.create(workspace=self.core, owner=self.admin, title='Second', status='draft', definition_of_done='Evidence', dependency=self.row)
        self.row.dependency = second
        with self.assertRaises(ValidationError):
            self.row.save()
        response = self.client.patch(f'/api/operating/task-board/{self.row.pk}/', json.dumps({'dependency_id': second.pk}), content_type='application/json')
        self.assertEqual(response.status_code, 409)

    def test_permission_private_tasks_do_not_leak_through_analytics_acceptance_j(self):
        other = get_user_model().objects.create_user(username='execution-member', email='execution-member@example.test')
        WorkspaceMembership.objects.create(workspace=self.core, user=other, role='member')
        policy_for(self.row, create=True, created_by=self.admin, default_visibility=ObjectPolicy.Visibility.PRIVATE)
        self.client.force_login(other)
        payload = self.dashboard()
        self.assertNotIn(self.row.pk, [t['id'] for t in payload['tasks']])
        self.assertNotIn(self.row.title, json.dumps(payload))
        self.assertEqual(payload['summary']['open'], 0)
        detail = self.client.get(f'/api/operating/task-board/{self.row.pk}/')
        self.assertEqual(detail.status_code, 404)
        board = self.client.get('/api/operating/task-board/').json()
        self.assertNotIn(self.row.title, json.dumps(board.get('tasks')))
        dependencies = self.client.get('/api/operating/task-board/?mode=dependencies').json()
        self.assertNotIn(self.row.title, json.dumps(dependencies))

    def test_nonmember_cannot_read_aggregate(self):
        user = get_user_model().objects.create_user(username='execution-outsider')
        self.client.force_login(user)
        response = self.client.get('/api/operating/execution/')
        self.assertEqual(response.status_code, 403)

    def test_calendar_validation_conflict_and_audit(self):
        path = '/api/operating/execution/settings/'
        payload = {'timezone': 'Asia/Tehran', 'inactivity_business_days': 4, 'business_weekdays': [5, 6, 0, 1, 2]}
        response = self.client.patch(path, json.dumps(payload), content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.dashboard()['config']['timezone'], 'Asia/Tehran')
        self.assertTrue(ActivityEvent.objects.filter(action='execution.calendar_changed').exists())
        payload['expected_updated_at'] = None
        self.assertEqual(self.client.patch(path, json.dumps(payload), content_type='application/json').status_code, 409)
        self.assertEqual(self.client.patch(path, json.dumps({'timezone': 'No/such_zone'}), content_type='application/json').status_code, 400)

    def test_reader_cannot_change_calendar(self):
        member = get_user_model().objects.create_user(username='execution-reader')
        WorkspaceMembership.objects.create(workspace=self.core, user=member, role='member')
        self.client.force_login(member)
        self.assertEqual(self.client.patch('/api/operating/execution/settings/', '{}', content_type='application/json').status_code, 403)

    def test_task_weight_validated_and_committed(self):
        path = f'/api/operating/task-board/{self.row.pk}/'
        for value in [0, -1, True, '2', 100001]:
            self.assertEqual(self.client.patch(path, json.dumps({'execution_weight': value}), content_type='application/json').status_code, 400)
        response = self.client.patch(path, json.dumps({'execution_weight': 9}), content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        self.row.refresh_from_db()
        self.assertEqual(self.row.execution_weight, 9)

    def test_core_schedule_reuses_markdown_adapter_and_detects_conflicts(self):
        data = {'task_id': self.row.pk, 'start_date': '2026-09-03', 'end_date': '2026-09-18', 'estimated_minutes': 180, 'expected_updated_at': None}
        response = self.client.post('/api/operating/execution/schedules/', json.dumps(data), content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['schedule']['estimated_minutes'], 180)
        payload = self.dashboard()
        current = next(t for t in payload['tasks'] if t['id'] == self.row.pk)
        self.assertEqual(current['execution']['plan']['start_date'], '2026-09-03')
        response = self.client.post('/api/operating/execution/schedules/', json.dumps(data), content_type='application/json')
        self.assertEqual(response.status_code, 409, response.content)
        self.assertTrue(ActivityEvent.objects.filter(action='task.schedule_changed').exists())

    def test_core_schedule_cannot_write_a_private_task(self):
        member = get_user_model().objects.create_user(username='schedule-reader')
        WorkspaceMembership.objects.create(workspace=self.core, user=member, role='member')
        policy_for(self.row, create=True, created_by=self.admin, default_visibility=ObjectPolicy.Visibility.PRIVATE)
        self.client.force_login(member)
        response = self.client.post('/api/operating/execution/schedules/', json.dumps({'task_id': self.row.pk, 'start_date': '2026-09-01', 'end_date': '2026-09-03', 'estimated_minutes': 1}), content_type='application/json')
        self.assertEqual(response.status_code, 403)

    def test_thousand_tasks_use_bounded_acl_queries_acceptance_h(self):
        OperatingTask.objects.bulk_create([OperatingTask(workspace=self.core, owner=self.admin, title=f'Large task {i}', status='draft', definition_of_done='Evidence') for i in range(1000)])
        with CaptureQueriesContext(connection) as captured:
            payload = self.dashboard()
        self.assertEqual(len(payload['tasks']), 1001)
        self.assertLess(len(captured), 75)

    def test_bulk_access_preserves_private_policy(self):
        member = get_user_model().objects.create_user(username='batch-reader')
        WorkspaceMembership.objects.create(workspace=self.core, user=member, role='member')
        policy_for(self.row, create=True, created_by=self.admin, default_visibility=ObjectPolicy.Visibility.PRIVATE)
        expected = can_view(member, self.row)
        with access_batch(member, [self.row]):
            self.assertEqual(can_view(member, self.row), expected)
