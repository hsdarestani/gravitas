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

    def test_report_catalog_handles_task_without_any_kr(self):
        from .work_reports import catalog
        standalone = OperatingTask.objects.create(
            workspace=self.task.workspace, owner=self.user,
            title='Research without strategic KR',
            definition_of_done='A reviewable source inventory exists.',
        )
        rows = catalog(self.user)
        row = next(item for item in rows if item['id'] == standalone.pk)
        self.assertEqual(row['key_result'], '')
        self.assertEqual(row['objective'], '')

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

    def test_confirm_obeys_canonical_project_transaction_boundary(self):
        # A canonicalized project refuses an unguarded task save. A Telegram
        # confirmation must still succeed through the canonical write journal.
        from .canonical_journal import RecoveryRequired
        report = self.propose(key='canonical-telegram-report')
        with patch('core.canonical_signals.active', return_value=True), \
             patch('core.canonical_signals.project_for', return_value=self.task.project):
            with self.assertRaisesMessage(RecoveryRequired, 'use_canonical_operation_for_project_write'):
                self.task.save()
            with patch('core.canonical_signals.flush_pending') as flush:
                confirmed = decide(self.user, report.pk, 1, 'confirm')
                flush.assert_called_once()
        self.assertEqual(confirmed.status, 'confirmed')
        self.task.refresh_from_db()
        self.assertEqual(self.task.status, 'retest')
        self.assertEqual(
            ActivityEvent.objects.filter(action='task.daily_report').count(), 1,
        )

    def test_task_history_displays_confirmed_pulsar_report_details(self):
        """A task owner sees the real Telegram report, not only Done status."""
        report = self.propose(key='report-task-history')
        decide(self.user, report.pk, 1, 'confirm')
        response = self.client.get(f'/api/operating/tasks/{self.task.pk}/history/')
        self.assertEqual(response.status_code, 200, response.content)
        events = [e for e in response.json()['events'] if e['action'] == 'task.daily_report']
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['detail']['progress'], 'Progress passed')
        self.assertEqual(events[0]['report']['original_text'], report.original_text)
        self.assertEqual(events[0]['report']['source'], 'telegram')

    def test_mobile_preview_includes_confirmed_pulsar_evidence_in_one_request(self):
        report = self.propose(key='preview-one-request')
        decide(self.user, report.pk, 1, 'confirm')
        response = self.client.get(f'/api/operating/task-board/{self.task.pk}/?mode=preview')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data['task']['id'], self.task.pk)
        self.assertEqual(data['task']['status'], 'retest')
        self.assertNotIn('key_results', data)
        self.assertNotIn('members', data)
        events = [e for e in data['events'] if e['action'] == 'task.daily_report']
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['report']['original_text'], report.original_text)
        self.assertEqual(events[0]['detail']['progress'], 'Progress passed')

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
        self.assertIn(f'Task #{self.task.pk} · LMS acceptance retest', messages[0]['text'])
        preview_again = handle_report_message(self.user, '/reportpreview')
        self.assertEqual(preview_again[0]['text'], messages[0]['text'])
        self.assertEqual(DailyWorkReport.objects.count(), 1)
        self.task.refresh_from_db(); self.assertEqual(self.task.status, 'active')
        action = messages[0]['reply_markup']['inline_keyboard'][0][0]['callback_data']
        self.assertLessEqual(len(action.encode()), 64)
        self.assertIn('not found', handle_report_callback(self.other, action)[0]['text'])
        handle_report_callback(self.user, action); handle_report_callback(self.user, action)
        self.assertEqual(ActivityEvent.objects.filter(action='task.daily_report').count(), 1)

    def test_report_preview_shows_unmatched_as_no_task_and_omits_false_unmatched(self):
        from .telegram_work_reports import preview
        with patch('core.work_reports.interpret', return_value={
            'summary': 'One completed milestone',
            'updates': [{'task_id': self.task.pk, 'status': 'done', 'progress': 'Built the preview',
                         'deliverable': 'Verified preview'},
                        {'task_id': None, 'progress': 'Independent research', 'status': None}],
            'unmatched_work': 'No unmatched work reported',
        }):
            report = propose(self.user, 'One completed milestone', source='telegram',
                             source_key='preview-ids')
        result = preview(report)['text']
        self.assertIn(f'Task #{self.task.pk} · LMS acceptance retest', result)
        self.assertIn('UNMATCHED (no task change)', result)
        self.assertNotIn('Unmatched work (no task will change):\nNo unmatched work reported', result)
        self.task.refresh_from_db()
        self.assertEqual(self.task.status, 'active')

    def test_reportpreview_without_active_pending_report_is_read_only(self):
        response = handle_report_message(self.user, '/reportpreview')
        self.assertIn('No active pending report', response[0]['text'])
        self.assertFalse(DailyWorkReport.objects.exists())

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
        # A delivery reminder is not an instruction to capture the next chat.
        self.assertFalse(TelegramPulsarSession.objects.filter(user=self.user).exists())
        self.assertIsNone(handle_report_message(self.user, 'where is research intelligence', 'private:question'))
        self.assertFalse(DailyWorkReport.objects.exists())
        # Only the explicit Telegram button arms the reporting workflow.
        from .telegram_work_reports import handle_report_callback
        started = handle_report_callback(self.user, 'wr:start')
        self.assertIn('What did you work on today', started[0]['text'])
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


    def test_backdated_telegram_report_keeps_real_submission_time_and_work_day(self):
        from .work_reports import report_day, parse_work_date_prefix
        from datetime import timedelta
        backdated = (report_day(self.user) - timedelta(days=3)).isoformat()
        work_date, text = parse_work_date_prefix(backdated + ' I retested the lessons', self.user)
        self.assertEqual(work_date.isoformat(), backdated)
        self.assertEqual(text, 'I retested the lessons')
        with patch('core.work_reports.interpret', return_value=self.raw):
            messages = handle_report_message(
                self.user, '/report ' + backdated + ' I retested the lessons',
                source_key='tg:backdate:1',
            )
        self.assertIn('Work date: ' + backdated, messages[0]['text'])
        self.assertIn('Submitted:', messages[0]['text'])
        report = DailyWorkReport.objects.get(source_key='tg:backdate:1')
        self.assertEqual(report.report_date.isoformat(), backdated)
        self.assertNotEqual(report.report_date, report.created_at.date())
        self.assertEqual(report.original_text, 'I retested the lessons')
        handle_report_callback(self.user, messages[0]['reply_markup']['inline_keyboard'][0][0]['callback_data'])
        report.refresh_from_db()
        self.assertEqual(report.status, 'confirmed')
        event = ActivityEvent.objects.get(action='task.daily_report')
        self.assertEqual(event.detail['work_date'], backdated)
        listed = handle_report_message(self.user, '/reports')
        self.assertIn(backdated, listed[0]['text'])
        self.assertIn('confirmed', listed[0]['text'])
        self.assertIn('Submitted', messages[0]['text'])

    def test_relative_backfill_expressions_and_reject_future(self):
        from .work_reports import report_day, parse_work_date_prefix
        from datetime import timedelta
        today = report_day(self.user)
        for expr, offset in [('yesterday', 1), ('2 days ago', 2), ('3 days ago', 3),
                             ('دیروز', 1), ('پریروز', 2), ('سه روز پیش', 3)]:
            day, detail = parse_work_date_prefix(expr + ': I finished this', self.user)
            self.assertEqual(day, today - timedelta(days=offset), expr)
            self.assertEqual(detail, 'I finished this')
        with self.assertRaisesMessage(ValueError, 'work_date_out_of_range'):
            parse_work_date_prefix((today + timedelta(days=1)).isoformat() + ' Future', self.user)
        with self.assertRaisesMessage(ValueError, 'work_date_out_of_range'):
            parse_work_date_prefix((today - timedelta(days=366)).isoformat() + ' Old', self.user)

    def test_multiple_telegram_messages_form_one_dated_draft_only_after_done(self):
        from .work_reports import report_day
        from datetime import timedelta
        from .operating_models import TelegramPulsarSession
        previous_day = (report_day(self.user) - timedelta(days=2)).isoformat()
        started = handle_report_message(self.user, '/report ' + previous_day)
        self.assertIn('Send messages for this day', started[0]['text'])
        a = handle_report_message(self.user, 'I fixed the first module')
        b = handle_report_message(self.user, 'I tested the second module')
        self.assertIn('(1 messages)', a[0]['text'])
        self.assertIn('(2 messages)', b[0]['text'])
        self.assertFalse(DailyWorkReport.objects.exists())
        with patch('core.work_reports.interpret', return_value=self.raw):
            preview = handle_report_message(self.user, '/done', source_key='tg:done:1')
        self.assertIn('Work date: ' + previous_day, preview[0]['text'])
        self.assertIn('Confirm', str(preview))
        report = DailyWorkReport.objects.get()
        self.assertEqual(report.report_date.isoformat(), previous_day)
        self.assertEqual(report.original_text, 'I fixed the first module\nI tested the second module')
        self.assertEqual(TelegramPulsarSession.objects.get(user=self.user).state['mode'], 'daily_report')

    def test_multimessage_cancel_discards_pending_parts(self):
        from .operating_models import TelegramPulsarSession
        handle_report_message(self.user, '/reportmulti yesterday')
        handle_report_message(self.user, 'I drafted an initial outline')
        cancelled = handle_report_message(self.user, '/cancel')
        self.assertIn('Report cancelled', cancelled[0]['text'])
        self.assertEqual(TelegramPulsarSession.objects.get(user=self.user).state, {})
        self.assertFalse(DailyWorkReport.objects.exists())

    def test_platform_api_accepts_explicit_historical_work_date(self):
        from .work_reports import report_day
        from datetime import timedelta
        date_value = (report_day(self.user) - timedelta(days=2)).isoformat()
        with patch('core.work_reports.interpret', return_value=self.raw):
            response = self.client.post('/api/platform/work-reports/', json.dumps({
                'text': 'I retested lessons', 'report_date': date_value,
            }), content_type='application/json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['report']['date'], date_value)
        with patch('core.work_reports.interpret', return_value=self.raw):
            future = self.client.post('/api/platform/work-reports/', json.dumps({
                'text': 'I retested lessons', 'report_date': (report_day(self.user) + timedelta(days=2)).isoformat(),
            }), content_type='application/json')
        self.assertEqual(future.status_code, 400)

    def test_date_filter_retrieves_older_report_and_rejects_invalid_filters(self):
        report = self.propose()
        DailyWorkReport.objects.filter(pk=report.pk).update(report_date='2025-01-01')
        DailyWorkReport.objects.bulk_create([DailyWorkReport(user=self.user, report_date='2026-10-08', source='platform', source_key=f'later-{i}', original_text='Later draft') for i in range(101)])
        data = self.client.get('/api/platform/work-reports/?date=2025-01-01&status=pending').json()
        self.assertEqual([r['id'] for r in data['reports']], [str(report.pk)])
        self.assertEqual(self.client.get('/api/platform/work-reports/?date=bad').status_code, 400)
        self.assertEqual(self.client.get('/api/platform/work-reports/?status=bad').status_code, 400)


    @override_settings(GRAVITAS_TELEGRAM_BOT_TOKEN='fixture', GRAVITAS_TELEGRAM_WEBHOOK_SECRET='fixture', PUBLIC_BASE_URL='https://example.test')
    def test_bot_commands_are_configured_before_optional_appearance_failure(self):
        import io
        import requests
        from django.core.management import call_command
        from types import SimpleNamespace
        methods = []
        def post(url, **kwargs):
            method = url.rsplit('/', 1)[-1]; methods.append(method)
            if method == 'setMyName':
                raise requests.Timeout()
            if method == 'setMyCommands':
                commands = {c['command'] for c in kwargs['json']['commands']}
                self.assertTrue({'report', 'reportedit'}.issubset(commands))
            return SimpleNamespace(ok=True, json=lambda: {'ok': True}, raise_for_status=lambda: None)
        with patch('core.management.commands.configure_telegram_notifications.requests.post', side_effect=post):
            call_command('configure_telegram_notifications', stdout=io.StringIO(), stderr=io.StringIO())
        self.assertEqual(methods[:2], ['setWebhook', 'setMyCommands'])
