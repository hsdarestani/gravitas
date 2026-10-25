import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from .operating_models import KeyResult, OperatingTask, StrategicObjective, TelegramPulsarSession
from .platform_runtime_v3 import ensure_platform_workspaces
from .telegram_pulsar import handle_callback, handle_message, handle_document


User = get_user_model()


class TelegramPulsarTaskBuilderTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='pulsar-telegram@example.test',
            email='pulsar-telegram@example.test',
            password='Strong-pass-123!',
            first_name='Sajjad',
        )
        self.core = ensure_platform_workspaces(self.user)['core']
        objective = StrategicObjective.objects.create(
            workspace=self.core,
            title='Ship learning and research workflows',
            owner=self.user,
        )
        self.kr = KeyResult.objects.create(
            objective=objective,
            title='Deliver active learning workflows',
            owner=self.user,
            baseline_value=0,
            target_value=10,
            current_value=0,
            unit='items',
        )

    @patch('core.telegram_pulsar.configured', return_value=True)
    @patch('core.telegram_pulsar.complete')
    def test_natural_message_builds_preview_and_confirm_creates_core_task(self, complete, configured):
        complete.return_value = json.dumps({
            'intent': 'create_tasks',
            'reply': '',
            'tasks': [{
                'title': 'Finalize the remaining course outlines',
                'description': 'Complete the course outlines previously agreed with the team.',
                'definition_of_done': 'All remaining course outlines are complete and ready for review.',
                'priority': 'p1',
                'due_date': '2026-10-10',
                'owner_id': self.user.pk,
                'key_result_id': self.kr.pk,
                'key_result_suggestions': [self.kr.pk],
                'project_id': None,
                'dependency_id': None,
                'related_course_ids': [],
                'confidence': {'key_result_id': 0.98},
            }],
        })

        messages = handle_message(self.user, 'نهایی کردن طرح درس‌هایی که عنوانشون رو گفته بودم')
        self.assertEqual(len(messages), 1)
        self.assertIn('Finalize the remaining course outlines', messages[0]['text'])
        self.assertIn('reply_markup', messages[0])

        session = TelegramPulsarSession.objects.get(user=self.user)
        self.assertEqual(session.state['mode'], 'confirm')

        created_messages = handle_callback(self.user, 'pulsar:create')
        self.assertTrue(created_messages)
        task = OperatingTask.objects.get(title='Finalize the remaining course outlines')
        self.assertEqual(task.owner, self.user)
        self.assertEqual(task.initiative.key_result, self.kr)
        self.assertEqual(task.status, 'active')
        self.assertEqual(task.due_date.isoformat(), '2026-10-10')

        session.refresh_from_db()
        self.assertEqual(session.state, {})

    @patch('core.telegram_pulsar.configured', return_value=True)
    @patch('core.telegram_pulsar.complete')
    def test_multiple_tasks_are_numbered_before_any_creation(self, complete, configured):
        complete.return_value = json.dumps({
            'intent': 'create_tasks',
            'reply': '',
            'tasks': [
                {
                    'title': 'Record workflow example videos',
                    'definition_of_done': 'Workflow example videos are recorded and ready for review.',
                    'priority': 'p2',
                    'owner_id': self.user.pk,
                    'key_result_id': None,
                    'key_result_suggestions': [self.kr.pk],
                    'confidence': {'key_result_id': 0.2},
                },
                {
                    'title': 'Share workflows and tools with the team',
                    'definition_of_done': 'The agreed workflows and tool references are shared with the team.',
                    'priority': 'p2',
                    'owner_id': self.user.pk,
                    'key_result_id': None,
                    'key_result_suggestions': [self.kr.pk],
                    'confidence': {'key_result_id': 0.2},
                },
            ],
        })

        messages = handle_message(
            self.user,
            'ضبط چند ویدیو از مثال‌های ورک‌فلو\nاشتراک‌گذاری ورک‌فلوها و ابزار',
        )
        self.assertIn('1. Record workflow example videos', messages[0]['text'])
        self.assertIn('2. Share workflows and tools with the team', messages[0]['text'])
        self.assertEqual(OperatingTask.objects.count(), 0)

        session = TelegramPulsarSession.objects.get(user=self.user)
        self.assertEqual(session.state['mode'], 'select_tasks')

        next_messages = handle_message(self.user, '1')
        self.assertIn('KR', next_messages[0]['text'])
        session.refresh_from_db()
        self.assertEqual(session.state['mode'], 'confirm')
        self.assertIn('KR نامشخص', next_messages[0]['text'])

    def test_project_inventory_is_database_backed_includes_done_and_duplicates(self):
        from .models import ResearchProject
        from .operating_models import WorkStatus

        project = ResearchProject.objects.create(
            workspace=self.core, owner=self.user, title='Topic 01',
        )
        other_project = ResearchProject.objects.create(
            workspace=self.core, owner=self.user, title='Unrelated project',
        )
        rows = [
            OperatingTask.objects.create(
                workspace=self.core, project=project, owner=self.user,
                title='Educational Simulations', status=WorkStatus.DONE,
                definition_of_done='Verified lab pilots',
            ),
            OperatingTask.objects.create(
                workspace=self.core, project=project, owner=self.user,
                title='Educational Simulations', status=WorkStatus.ACTIVE,
                definition_of_done='Duplicate',
            ),
            OperatingTask.objects.create(
                workspace=self.core, project=project, owner=self.user,
                title='Production Deployment', status=WorkStatus.BLOCKED,
                definition_of_done='Safely deployed',
            ),
        ]
        OperatingTask.objects.create(
            workspace=self.core, project=other_project, owner=self.user,
            title='Must not show unrelated project task',
            definition_of_done='Private to another project',
        )
        # Most recent scientific tasks can fall outside a capped context catalog.
        for i in range(41):
            OperatingTask.objects.create(
                workspace=self.core, owner=self.user,
                title=f'Old unrelated task {i}', definition_of_done='Other work',
            )
        session = TelegramPulsarSession.objects.create(
            user=self.user, state={'mode': 'confirm', 'draft': {'title': 'Preserve me'}},
        )
        with patch('core.telegram_pulsar._interpret', side_effect=AssertionError('LLM not needed')):
            response = handle_message(
                self.user, f'Please review the existing tasks in Research Project #{project.pk}',
            )
            command_response = handle_message(self.user, f'/projecttasks {project.pk}')
        for result in (response, command_response):
            text = result[0]['text']
            for task in rows:
                self.assertIn(f'#{task.pk}', text)
                self.assertIn(task.status, text)
            self.assertIn('Potential duplicate titles:', text)
            self.assertIn('Read-only inventory', text)
            self.assertNotIn('Must not show unrelated', text)
            self.assertNotIn('Old unrelated task', text)
        session.refresh_from_db()
        self.assertEqual(session.state['mode'], 'confirm')
        self.assertEqual(OperatingTask.objects.filter(project=project).count(), 3)

    def test_project_inventory_denies_unshared_project_and_paginates(self):
        from .models import ResearchProject

        other = User.objects.create_user(
            username='other-proj-owner@example.test', password='example-password',
        )
        foreign_project = ResearchProject.objects.create(
            workspace=self.core, owner=other, title='Confidential',
        )
        denied = handle_message(self.user, f'/projecttasks {foreign_project.pk}')
        self.assertIn('permission', denied[0]['text'])
        self.assertNotIn('Confidential', denied[0]['text'])

        project = ResearchProject.objects.create(
            workspace=self.core, owner=self.user, title='Topic 01',
        )
        for i in range(20):
            OperatingTask.objects.create(
                workspace=self.core, project=project, owner=self.user,
                title=f'Lab item {i:02d}', definition_of_done='Test',
            )
        first = handle_message(self.user, f'/projecttasks {project.pk}')
        second = handle_message(self.user, f'/projecttasks {project.pk} 2')
        self.assertIn('page 1/2', first[0]['text'])
        self.assertIn(f'/projecttasks {project.pk} 2', first[0]['text'])
        self.assertIn('page 2/2', second[0]['text'])
        self.assertEqual(OperatingTask.objects.filter(project=project).count(), 20)

    @patch('core.telegram_pulsar.configured', return_value=True)
    @patch('core.telegram_pulsar.complete')
    def test_general_pulsar_chat_does_not_create_task(self, complete, configured):
        complete.return_value = json.dumps({
            'intent': 'chat',
            'reply': 'می‌تونم در تعریف تسک، پیدا کردن KR و برنامه‌ریزی کمکت کنم.',
            'tasks': [],
        })
        messages = handle_message(self.user, 'سلام، چه کارهایی می‌تونی بکنی؟')
        self.assertIn('تعریف تسک', messages[0]['text'])
        self.assertEqual(OperatingTask.objects.count(), 0)

    @patch('core.telegram_pulsar.configured', return_value=True)
    @patch('core.telegram_pulsar.complete')
    def test_missing_kr_never_blocks_creation_and_does_not_require_due_date(self, complete, configured):
        complete.return_value = json.dumps({
            'intent': 'create_tasks',
            'reply': '',
            'tasks': [{'title': 'Prepare reviewable research notes',
                       'definition_of_done': 'The research notes are delivered to the team.',
                       'owner_id': self.user.pk, 'key_result_id': None, 'due_date': None}],
        })
        messages = handle_message(self.user, 'Prepare reviewable research notes')
        self.assertIn('No KR match', messages[0]['text'])
        self.assertEqual(TelegramPulsarSession.objects.get(user=self.user).state['mode'], 'confirm')
        handle_callback(self.user, 'pulsar:create')
        task = OperatingTask.objects.get(title='Prepare reviewable research notes')
        self.assertIsNone(task.initiative_id)
        self.assertIsNone(task.due_date)

    @patch('core.telegram_pulsar.configured', return_value=True)
    @patch('core.telegram_pulsar.complete')
    def test_consecutive_new_messages_are_queued_not_lost(self, complete, configured):
        def answer(**kwargs):
            text = kwargs['user']
            title = 'Draft first learning outline' if 'first' in text else 'Draft second learning outline'
            return json.dumps({'intent': 'create_tasks', 'tasks': [
                {'title': title, 'definition_of_done': 'A reviewable outline is delivered.',
                 'owner_id': self.user.pk, 'key_result_id': None},
            ]})
        complete.side_effect = answer
        handle_message(self.user, 'first')
        queued = handle_message(self.user, 'second')
        self.assertIn('queued', queued[0]['text'])
        handle_callback(self.user, 'pulsar:create')
        self.assertEqual(OperatingTask.objects.count(), 1)
        self.assertEqual(TelegramPulsarSession.objects.get(user=self.user).state['draft']['title'], 'Draft second learning outline')
        handle_callback(self.user, 'pulsar:create')
        self.assertEqual(OperatingTask.objects.count(), 2)

    @patch('core.telegram_pulsar.configured', return_value=True)
    @patch('core.telegram_pulsar.complete')
    @patch('core.work_reports.interpret')
    def test_existing_work_routes_to_confirmable_report(self, interpret, complete, configured):
        from .work_report_models import DailyWorkReport
        interpret.return_value = {'summary': 'Documented results', 'updates': [],
                                  'unmatched_work': 'Documented results'}
        complete.return_value = json.dumps({'intent': 'log_update', 'tasks': [], 'reply': ''})
        preview = handle_message(self.user, 'I documented the results', source_key='chat:1')
        self.assertIn('Confirm', preview[0]['reply_markup']['inline_keyboard'][0][0]['text'])
        self.assertEqual(DailyWorkReport.objects.count(), 1)
        handle_message(self.user, 'I documented the results', source_key='chat:1')
        self.assertEqual(DailyWorkReport.objects.count(), 1)
        self.assertEqual(OperatingTask.objects.count(), 0)

    def test_question_during_armed_daily_checkin_does_not_create_report(self):
        from .telegram_work_reports import handle_report_message
        from .work_report_models import DailyWorkReport
        from .telegram_pulsar import is_information_request

        self.assertTrue(is_information_request('where is research intelligence'))
        self.assertTrue(is_information_request('Where is the task board?'))
        self.assertTrue(is_information_request('کجا می‌توانم تسک‌ها را ببینم؟'))
        self.assertFalse(is_information_request('Create a task to review research intelligence'))
        self.assertFalse(is_information_request('/report Research is complete'))

        checkin = handle_report_message(self.user, '/report')
        self.assertIn('What did you work on today', checkin[0]['text'])
        self.assertEqual(TelegramPulsarSession.objects.get(user=self.user).state['mode'], 'daily_checkin')

        intercepted = handle_report_message(
            self.user, 'where is research intelligence', source_key='chat:22'
        )
        self.assertIsNone(intercepted)
        self.assertEqual(TelegramPulsarSession.objects.get(user=self.user).state, {})

        with patch('core.telegram_pulsar.complete') as model:
            answer = handle_message(self.user, 'where is research intelligence', source_key='chat:22')
        self.assertIn('Research Workspace', answer[0]['text'])
        self.assertIn('research-intelligence-title', answer[0]['text'])
        self.assertNotIn('reply_markup', answer[0])
        model.assert_not_called()
        self.assertEqual(DailyWorkReport.objects.count(), 0)
        self.assertEqual(OperatingTask.objects.count(), 0)

    @patch('core.telegram_pulsar.configured', return_value=True)
    @patch('core.telegram_pulsar.complete')
    def test_informational_question_is_safe_even_if_model_claims_task(self, complete, configured):
        complete.return_value = json.dumps({
            'intent': 'create_tasks',
            'tasks': [{'title': 'Where to find project milestones'}],
            'reply': '',
        })
        from .telegram_pulsar import is_information_request
        self.assertTrue(is_information_request('Where can I find the milestones?'))
        response = handle_message(self.user, 'Where can I find the milestones?', source_key='chat:23')
        self.assertNotIn('reply_markup', response[0])
        self.assertIn('question', response[0]['text'])
        self.assertEqual(OperatingTask.objects.count(), 0)
        self.assertFalse(TelegramPulsarSession.objects.filter(user=self.user, state__has_key='draft').exists())

    @patch('core.telegram_pulsar.configured', return_value=False)
    def test_unavailable_ai_fails_closed_instead_of_turning_text_into_task(self, configured):
        response = handle_message(self.user, 'Maybe we should research better models')
        self.assertNotIn('reply_markup', response[0])
        self.assertIn('cannot interpret', response[0]['text'])
        self.assertFalse(TelegramPulsarSession.objects.filter(user=self.user, state__has_key='draft').exists())
        self.assertEqual(OperatingTask.objects.count(), 0)

    @patch('core.telegram_pulsar.configured', return_value=True)
    @patch('core.telegram_pulsar.complete')
    def test_question_does_not_overwrite_pending_task_draft(self, complete, configured):
        complete.return_value = json.dumps({
            'intent': 'create_tasks',
            'tasks': [{'title': 'Review AI research tools',
                       'definition_of_done': 'Review delivered',
                       'owner_id': self.user.pk}],
        })
        handle_message(self.user, 'Review AI research tools')
        before = TelegramPulsarSession.objects.get(user=self.user).state.copy()
        reply = handle_message(self.user, 'where is research intelligence')
        after = TelegramPulsarSession.objects.get(user=self.user).state
        self.assertEqual(before, after)
        self.assertIn('Research Workspace', reply[0]['text'])
        self.assertNotIn('reply_markup', reply[0])
        self.assertEqual(OperatingTask.objects.count(), 0)

    @patch('core.telegram_pulsar.configured', return_value=True)
    @patch('core.telegram_pulsar.complete')
    def test_multi_command_combines_related_telegram_messages_one_ai_context(self, complete, configured):
        from .telegram_pulsar import handle_message
        started = handle_message(self.user, '/multi')
        self.assertIn('/done', started[0]['text'])
        handle_message(self.user, 'Prepare a report of research tools')
        added = handle_message(self.user, 'Include only confirmed tools and sources')
        self.assertIn('2 messages', added[0]['text'])
        complete.assert_not_called()
        combined = 'Prepare a report of research tools\nInclude only confirmed tools and sources'

        def answer(**kwargs):
            self.assertIn(combined, kwargs['user'])
            return json.dumps({
                'intent': 'create_tasks',
                'tasks': [{
                    'title': 'Prepare validated tool report',
                    'description': 'Research tools with verified sources',
                    'definition_of_done': 'A report is shared',
                    'owner_id': self.user.pk,
                    'key_result_id': None,
                }],
            })

        complete.side_effect = answer
        result = handle_message(self.user, '/done', source_key='chat:combined:3')
        self.assertIn('Prepare validated tool report', result[0]['text'])
        self.assertEqual(complete.call_count, 1)
        self.assertEqual(OperatingTask.objects.count(), 0)
        self.assertEqual(TelegramPulsarSession.objects.get(user=self.user).state['mode'], 'confirm')

    @patch('core.telegram_pulsar.configured', return_value=True)
    def test_multi_command_does_not_discard_existing_task_draft(self, configured):
        with patch('core.telegram_pulsar.complete', return_value=json.dumps({
            'intent': 'create_tasks',
            'tasks': [{'title': 'Draft a review outline',
                       'definition_of_done': 'Outline complete',
                       'owner_id': self.user.pk}],
        })):
            handle_message(self.user, 'Draft a review outline')
        before = TelegramPulsarSession.objects.get(user=self.user).state.copy()
        warning = handle_message(self.user, '/multi')
        self.assertIn('current draft', warning[0]['text'])
        self.assertEqual(before, TelegramPulsarSession.objects.get(user=self.user).state)

    def test_evidence_upload_attaches_to_selected_task_and_retries_safely(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import MagicMock
        from django.test import override_settings
        from .operating_models import OperatingTaskAttachment

        task = OperatingTask.objects.create(
            workspace=self.core, owner=self.user, title='Collect evidence',
            definition_of_done='The evidence document is attached.',
        )
        session, _ = TelegramPulsarSession.objects.get_or_create(user=self.user)
        session.state = {'mode': 'await_attachment', 'task_id': task.pk, 'language': 'en', 'queue': []}
        session.save(update_fields=['state', 'updated_at'])
        transport = MagicMock()
        transport.__enter__.return_value = transport
        transport.iter_content.return_value = [b'%PDF-1.4 test evidence']
        payload = {'file_id': 'telegram-asset-id', 'file_name': 'result.pdf',
                   'file_size': 22, 'mime_type': 'application/pdf'}
        with tempfile.TemporaryDirectory() as folder:
            with (
                override_settings(CORE_UPLOAD_ROOT=folder),
                patch('core.task_notifications._telegram_api',
                      return_value={'result': {'file_path': 'documents/result.pdf'}}),
                patch('core.telegram_pulsar.requests.get', return_value=transport),
            ):
                answer = handle_document(self.user, payload, source_key='chat:12')
                self.assertIn('Attached result.pdf', answer[0]['text'])
                self.assertEqual(OperatingTaskAttachment.objects.filter(task=task).count(), 1)
                attachment = OperatingTaskAttachment.objects.get(task=task)
                self.assertTrue(Path(attachment.storage_path).exists())
                repeat = handle_document(self.user, payload, source_key='chat:12')
                self.assertIn('Already attached', repeat[0]['text'])
                self.assertEqual(OperatingTaskAttachment.objects.filter(task=task).count(), 1)
        done = handle_callback(self.user, 'pulsar:attachments_done')
        self.assertIn('Attachments finished', done[0]['text'])
