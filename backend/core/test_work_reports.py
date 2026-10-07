import json
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from .models import WorkspaceMembership
from .operating_models import OperatingTask, KeyResult, Initiative, OperatingProcess, StrategicObjective, TaskNotificationPreference, TaskNotificationOutbox
from .platform_runtime_v3 import ensure_platform_workspaces
from .work_report_models import DailyWorkReport
from .work_reports import propose, decide, normalize, enqueue_daily_checkins
from .telegram_work_reports import handle_report_message, handle_report_callback
from .layer_models import ActivityEvent


@override_settings(SECURE_SSL_REDIRECT=False)
class DailyWorkReportTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser('report-owner', 'report@example.test', 'pass')
        self.other = get_user_model().objects.create_superuser('report-other', 'other@example.test', 'pass')
        core = ensure_platform_workspaces(self.user)['core']
        objective = StrategicObjective.objects.create(workspace=core, title='Technology', owner=self.user)
        kr = KeyResult.objects.create(objective=objective, title='Reliable operations', owner=self.user)
        process, _ = OperatingProcess.objects.get_or_create(workspace=core, key='technology', defaults={'name': 'Technology'})
        initiative = Initiative.objects.create(workspace=core, key_result=kr, process=process, owner=self.user, title='Acceptance')
        self.task = OperatingTask.objects.create(workspace=core, initiative=initiative, owner=self.user, title='LMS acceptance retest', due_date='2026-10-10', definition_of_done='Real acceptance pass')
        self.raw = {'summary': 'Retested lessons', 'updates': [{'task_id': self.task.pk, 'progress': 'Progress passed', 'status': 'retest', 'blocker': 'Preview still pending', 'next_action': 'Test preview'}]}
        self.client.force_login(self.user)

    def propose(self, key='message-1'):
        with patch('core.work_reports.interpret', return_value=self.raw):
            return propose(self.user, 'I retested lessons. Preview is still pending.', source='telegram', source_key=key)

    def test_correction_requires_accessible_confirmed_original(self):
        import uuid
        pending = self.propose()
        cases = ['invalid-uuid', str(uuid.uuid4()), str(pending.pk)]
        decide(self.user, pending.pk, 1, 'confirm')
        self.client.force_login(self.other)
        cases.append(str(pending.pk))
        for ident in cases:
            response = self.client.post('/api/platform/work-reports/',
                json.dumps({'text': 'Correction', 'supersedes': ident}), content_type='application/json')
            self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(DailyWorkReport.objects.count(), 1)

    def test_task_catalog_includes_acceptance_context(self):
        response = self.client.get('/api/platform/work-reports/')
        self.assertEqual(response.status_code, 200)
        task = next(t for t in response.json()['tasks'] if t['id'] == self.task.pk)
        self.assertEqual(task['definition_of_done'], 'Real acceptance pass')
        self.assertEqual(task['priority'], self.task.priority)

    def test_proposal_does_not_mutate_tasks_confirm_once_has_provenance(self):
        report = self.propose(); self.task.refresh_from_db()
        self.assertEqual(self.task.status, 'active')
        self.assertFalse(ActivityEvent.objects.filter(action='task.daily_report').exists())
        decide(self.user, report.pk, 1, 'confirm')
        decide(self.user, report.pk, 1, 'confirm')
        self.task.refresh_from_db(); self.assertEqual(self.task.status, 'retest')
        events = ActivityEvent.objects.filter(action='task.daily_report')
        self.assertEqual(events.count(), 1)
        self.assertEqual(events.get().detail['provenance'], 'Confirmed by user')
        self.assertEqual(report.original_text, 'I retested lessons. Preview is still pending.')

    def test_duplicate_input_returns_same_report_and_cancel_does_not_mutate(self):
        report = self.propose(); again = self.propose()
        self.assertEqual(report.pk, again.pk)
        decide(self.user, report.pk, 1, 'cancel')
        self.task.refresh_from_db(); self.assertEqual(self.task.status, 'active')
        self.assertFalse(ActivityEvent.objects.filter(action='task.daily_report').exists())

    def test_edit_invalidates_old_confirmation_and_refreshes_task_revision(self):
        report = self.propose()
        decide(self.user, report.pk, 1, 'edit', self.raw)
        with self.assertRaisesMessage(ValueError, 'stale_report_revision'):
            decide(self.user, report.pk, 1, 'confirm')
        decide(self.user, report.pk, 2, 'confirm')

    def test_task_changed_after_proposal_is_not_overwritten(self):
        report = self.propose()
        self.task.status = 'needs_review'; self.task.save()
        with self.assertRaisesMessage(ValueError, 'task_changed_review_proposal'):
            decide(self.user, report.pk, 1, 'confirm')
        self.task.refresh_from_db(); self.assertEqual(self.task.status, 'needs_review')
        self.assertFalse(ActivityEvent.objects.filter(action='task.daily_report').exists())

    def test_other_user_cannot_confirm_even_with_report_uuid(self):
        report = self.propose()
        with self.assertRaises(PermissionError):
            decide(self.other, report.pk, 1, 'confirm')

    def test_ambiguous_work_stays_unmatched_and_can_be_confirmed(self):
        with patch('core.work_reports.interpret', return_value={'summary': 'Research', 'updates': [], 'unmatched_work': 'Some R&D'}):
            report = propose(self.user, 'I did some R&D')
        decide(self.user, report.pk, 1, 'confirm')
        self.assertFalse(report.tasks.exists())
        self.task.refresh_from_db(); self.assertEqual(self.task.status, 'active')

    def test_cannot_match_foreign_owned_task(self):
        self.task.owner = self.other; self.task.save()
        with self.assertRaisesMessage(ValueError, 'task_not_accessible'):
            normalize(self.user, self.raw)

    def test_dependency_prevents_premature_done(self):
        dep = OperatingTask.objects.create(workspace=self.task.workspace, initiative=self.task.initiative, owner=self.other, title='Template approval', due_date='2026-10-10', definition_of_done='Approved')
        self.task.dependency = dep; self.task.save()
        self.raw['updates'][0]['status'] = 'done'
        report = self.propose()
        with self.assertRaisesMessage(ValueError, 'dependency_not_complete'):
            decide(self.user, report.pk, 1, 'confirm')

    def test_platform_report_and_correction_append_history(self):
        report = self.propose(); decide(self.user, report.pk, 1, 'confirm')
        with patch('core.work_reports.interpret', return_value={'summary': 'Correction', 'updates': []}):
            response = self.client.post('/api/platform/work-reports/', json.dumps({'text': 'Correction: one lesson remains', 'supersedes': str(report.pk)}), content_type='application/json')
        self.assertEqual(response.status_code, 201, response.content)
        report.refresh_from_db(); self.assertEqual(report.status, 'confirmed')
        self.assertEqual(DailyWorkReport.objects.count(), 2)

    def test_telegram_preview_callback_replay_and_identity(self):
        with patch('core.work_reports.interpret', return_value=self.raw):
            messages = handle_report_message(self.user, '/report I retested lessons', 'chat:123')
        report = DailyWorkReport.objects.get()
        self.task.refresh_from_db(); self.assertEqual(self.task.status, 'active')
        action = messages[0]['reply_markup']['inline_keyboard'][0][0]['callback_data']
        self.assertLessEqual(len(action.encode()), 64)
        self.assertIn('not found', handle_report_callback(self.other, action)[0]['text'])
        handle_report_callback(self.user, action); handle_report_callback(self.user, action)
        self.assertEqual(ActivityEvent.objects.filter(action='task.daily_report').count(), 1)

    @override_settings(GRAVITAS_DAILY_REPORT_HOUR=0)
    def test_daily_checkin_queues_once_without_sending_immediately(self):
        TaskNotificationPreference.objects.create(user=self.user, telegram_enabled=True, telegram_chat_id=123)
        self.assertEqual(enqueue_daily_checkins(), 1)
        self.assertEqual(enqueue_daily_checkins(), 0)
        self.assertEqual(TaskNotificationOutbox.objects.filter(event_type='daily.checkin').count(), 1)
