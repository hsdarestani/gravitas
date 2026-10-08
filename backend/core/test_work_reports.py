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


    @override_settings(GRAVITAS_DAILY_REPORT_HOUR=18)
    def test_tehran_boundary_platform_request_and_later_telegram_connection(self):
        from datetime import datetime, timezone as tz
        from .work_report_models import DailyCheckIn
        with patch('core.work_reports.timezone.now', return_value=datetime(2026, 10, 8, 14, 29, tzinfo=tz.utc)):
            self.assertEqual(enqueue_daily_checkins(), 0)
            self.assertFalse(self.client.get('/api/platform/work-reports/').json()['checkin']['due'])
        with patch('core.work_reports.timezone.now', return_value=datetime(2026, 10, 8, 14, 30, tzinfo=tz.utc)):
            self.assertEqual(enqueue_daily_checkins(), 1)
            self.assertEqual(DailyCheckIn.objects.get().report_date.isoformat(), '2026-10-08')
            self.assertFalse(TaskNotificationOutbox.objects.exists())
            state = self.client.get('/api/platform/work-reports/').json()['checkin']
            self.assertTrue(state['due']); self.assertFalse(state['telegram_connected'])
            TaskNotificationPreference.objects.create(user=self.user, telegram_enabled=True, telegram_chat_id=123)
            self.assertEqual(enqueue_daily_checkins(), 0)
            self.assertEqual(TaskNotificationOutbox.objects.filter(event_type='daily.checkin').count(), 1)
            self.assertEqual(enqueue_daily_checkins(), 0)
            self.assertEqual(TaskNotificationOutbox.objects.count(), 1)

    @override_settings(GRAVITAS_DAILY_REPORT_HOUR=0)
    def test_inactive_and_completed_owners_receive_no_request(self):
        from .work_report_models import DailyCheckIn
        self.user.is_active = False; self.user.save()
        self.assertEqual(enqueue_daily_checkins(), 0)
        self.user.is_active = True; self.user.save()
        self.task.status = 'done'; self.task.save()
        self.assertEqual(enqueue_daily_checkins(), 0)
        self.assertFalse(DailyCheckIn.objects.exists())

    @override_settings(GRAVITAS_DAILY_REPORT_HOUR=0)
    def test_confirmed_today_suppresses_request_but_tomorrow_requests_again(self):
        report = self.propose(); decide(self.user, report.pk, 1, 'confirm')
        self.assertEqual(enqueue_daily_checkins(), 0)
        self.assertTrue(self.client.get('/api/platform/work-reports/').json()['checkin']['confirmed'])
        with patch('core.work_reports.timezone.now', return_value=timezone.now() + timezone.timedelta(days=1)):
            self.assertEqual(enqueue_daily_checkins(), 1)
            self.assertTrue(self.client.get('/api/platform/work-reports/').json()['checkin']['due'])


    @override_settings(GRAVITAS_DAILY_REPORT_HOUR=0)
    def test_manager_coverage_includes_platform_only_member_and_confirmed_state(self):
        state = self.client.get('/api/platform/work-reports/overview/').json()['checkins']
        self.assertEqual(len(state), 1)
        self.assertTrue(state[0]['due']); self.assertFalse(state[0]['telegram_connected'])
        report = self.propose(); decide(self.user, report.pk, 1, 'confirm')
        state = self.client.get('/api/platform/work-reports/overview/').json()['checkins'][0]
        self.assertTrue(state['confirmed']); self.assertFalse(state['due'])

    @override_settings(GRAVITAS_DAILY_REPORT_HOUR=0)
    def test_daily_delivery_opens_plain_language_report_session_without_auto_confirmation(self):
        from .task_notifications import deliver_pending
        from .operating_models import TelegramPulsarSession
        TaskNotificationPreference.objects.create(user=self.user, telegram_enabled=True, telegram_chat_id=123)
        enqueue_daily_checkins()
        with patch('core.task_notifications._telegram_api', return_value={'ok': True}) as send:
            self.assertEqual(deliver_pending()['sent'], 1)
            self.assertEqual(deliver_pending()['sent'], 0)
        send.assert_called_once()
        self.assertEqual(send.call_args.args[1]['chat_id'], 123)
        self.assertEqual(TelegramPulsarSession.objects.get(user=self.user).state['mode'], 'daily_checkin')
        with patch('core.work_reports.interpret', return_value=self.raw):
            preview = handle_report_message(self.user, 'I retested lessons', 'private:message')
        self.assertIn('Confirm', str(preview))
        self.assertEqual(DailyWorkReport.objects.get().status, 'pending')
        self.task.refresh_from_db(); self.assertEqual(self.task.status, 'active')


    @override_settings(GRAVITAS_DAILY_REPORT_HOUR=0)
    def test_queued_checkin_is_not_sent_after_confirmation_or_on_next_day(self):
        from .task_notifications import deliver_pending
        TaskNotificationPreference.objects.create(user=self.user, telegram_enabled=True, telegram_chat_id=123)
        enqueue_daily_checkins()
        report = self.propose(); decide(self.user, report.pk, 1, 'confirm')
        with patch('core.task_notifications._telegram_api') as send:
            self.assertEqual(deliver_pending()['skipped'], 1)
        send.assert_not_called()
        row = TaskNotificationOutbox.objects.get()
        row.status = 'pending'; row.payload['report_date'] = str(report.report_date - timezone.timedelta(days=1)); row.save()
        with patch('core.task_notifications._telegram_api') as send:
            self.assertEqual(deliver_pending()['skipped'], 1)
        send.assert_not_called()

    def test_daily_prompt_does_not_capture_other_telegram_commands(self):
        from .operating_models import TelegramPulsarSession
        TelegramPulsarSession.objects.create(user=self.user, state={'mode': 'daily_checkin'})
        for command in ['/tasks', '/help', '/new']:
            self.assertIsNone(handle_report_message(self.user, command))
        self.assertFalse(DailyWorkReport.objects.exists())


    def test_date_filter_retrieves_older_report_and_rejects_invalid_filters(self):
        report = self.propose()
        DailyWorkReport.objects.filter(pk=report.pk).update(report_date='2025-01-01')
        DailyWorkReport.objects.bulk_create([DailyWorkReport(user=self.user, report_date='2026-10-08', source='platform', source_key=f'later-{i}', original_text='Later draft') for i in range(101)])
        data = self.client.get('/api/platform/work-reports/?date=2025-01-01&status=pending').json()
        self.assertEqual([r['id'] for r in data['reports']], [str(report.pk)])
        self.assertEqual(self.client.get('/api/platform/work-reports/?date=bad').status_code, 400)
        self.assertEqual(self.client.get('/api/platform/work-reports/?status=bad').status_code, 400)
