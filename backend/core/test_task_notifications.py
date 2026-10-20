import json
from datetime import timedelta
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone

from .operating_models import TaskNotificationOutbox, TaskNotificationPreference
from .task_notifications import deliver_pending


User = get_user_model()


@override_settings(
    SECURE_SSL_REDIRECT=False,
    GRAVITAS_TELEGRAM_BOT_TOKEN='test-token',
    GRAVITAS_TELEGRAM_BOT_USERNAME='gravitas_test_bot',
    GRAVITAS_TELEGRAM_WEBHOOK_SECRET='webhook-secret',
)
class TaskNotificationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='notify@example.test',
            email='notify@example.test',
            password='Strong-pass-123!',
            first_name='Notify',
        )

    def test_settings_expose_secure_telegram_connect_link(self):
        self.client.force_login(self.user)
        response = self.client.get('/api/task-notifications/settings/')
        self.assertEqual(response.status_code, 200, response.content)
        settings = response.json()['settings']
        self.assertTrue(settings['email_enabled'])
        self.assertTrue(settings['task_changes_enabled'])
        self.assertFalse(settings['telegram_connected'])
        self.assertTrue(settings['telegram_connect_url'].startswith('https://t.me/gravitas_test_bot?start='))

    @patch('core.task_notifications.requests.post')
    def test_telegram_webhook_binds_private_chat_to_account(self, post):
        post.return_value = Mock(
            raise_for_status=Mock(),
            json=Mock(return_value={'ok': True, 'result': {}}),
        )
        pref = TaskNotificationPreference.objects.create(
            user=self.user,
            telegram_link_code='connect-code',
            telegram_link_expires_at=timezone.now() + timedelta(minutes=10),
        )
        response = self.client.post(
            '/api/task-notifications/telegram/webhook/',
            data=json.dumps({
                'message': {
                    'text': '/start connect-code',
                    'chat': {'id': 123456789, 'type': 'private', 'username': 'notify_person'},
                },
            }),
            content_type='application/json',
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN='webhook-secret',
        )
        self.assertEqual(response.status_code, 200, response.content)
        pref.refresh_from_db()
        self.assertEqual(pref.telegram_chat_id, 123456789)
        self.assertEqual(pref.telegram_username, 'notify_person')
        self.assertTrue(pref.telegram_enabled)
        self.assertIsNotNone(pref.telegram_connected_at)

    @patch('core.telegram_pulsar.handle_message')
    @patch('core.task_notifications.requests.post')
    def test_connected_telegram_message_routes_to_pulsar(self, post, handle_message):
        post.return_value = Mock(
            ok=True,
            status_code=200,
            json=Mock(return_value={'ok': True, 'result': {}}),
        )
        handle_message.return_value = [{'text': 'Pulsar reply'}]
        TaskNotificationPreference.objects.create(
            user=self.user,
            telegram_chat_id=123456789,
            telegram_enabled=True,
        )
        response = self.client.post(
            '/api/task-notifications/telegram/webhook/',
            data=json.dumps({
                'message': {
                    'text': 'برای من یه تسک بساز',
                    'message_id': 42,
                    'chat': {'id': 123456789, 'type': 'private', 'username': 'notify_person'},
                },
            }),
            content_type='application/json',
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN='webhook-secret',
        )
        self.assertEqual(response.status_code, 200, response.content)
        handle_message.assert_called_once_with(self.user, 'برای من یه تسک بساز', source_key='123456789:42')
        payloads = [call.kwargs.get('json') for call in post.call_args_list]
        self.assertTrue(any(payload and payload.get('text') == 'Pulsar reply' for payload in payloads))

    @patch('core.telegram_pulsar.handle_message')
    @patch('core.task_notifications._telegram_api')
    def test_natural_language_task_survives_typing_indicator_failure(self, api, handle_message):
        # No /new is needed. An optional Telegram typing failure must never
        # stop the natural-language interpreter or its response.
        sent = []
        def request(method, payload):
            if method == 'sendChatAction':
                raise RuntimeError('telegram_http_429')
            sent.append((method, payload))
            return {'ok': True}
        api.side_effect = request
        handle_message.return_value = [{'text': 'Review and confirm this task.'}]
        TaskNotificationPreference.objects.create(
            user=self.user, telegram_chat_id=123456789, telegram_enabled=True,
        )
        message = 'Build a reusable Claude Skill from the approved workflow'
        response = self.client.post(
            '/api/task-notifications/telegram/webhook/',
            data=json.dumps({
                'message': {
                    'text': message,
                    'message_id': 75,
                    'chat': {'id': 123456789, 'type': 'private'},
                },
            }),
            content_type='application/json',
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN='webhook-secret',
        )
        self.assertEqual(response.status_code, 200, response.content)
        handle_message.assert_called_once_with(
            self.user, message, source_key='123456789:75',
        )
        self.assertEqual(
            [payload['text'] for method, payload in sent if method == 'sendMessage'],
            ['Review and confirm this task.'],
        )

    @patch('core.telegram_pulsar.handle_callback')
    @patch('core.task_notifications.requests.post')
    def test_telegram_callback_routes_to_pulsar(self, post, handle_callback):
        post.return_value = Mock(
            ok=True,
            status_code=200,
            json=Mock(return_value={'ok': True, 'result': {}}),
        )
        handle_callback.return_value = [{'text': 'Created'}]
        TaskNotificationPreference.objects.create(
            user=self.user,
            telegram_chat_id=123456789,
            telegram_enabled=True,
        )
        response = self.client.post(
            '/api/task-notifications/telegram/webhook/',
            data=json.dumps({
                'callback_query': {
                    'id': 'callback-1',
                    'data': 'pulsar:create',
                    'message': {
                        'chat': {'id': 123456789, 'type': 'private'},
                    },
                },
            }),
            content_type='application/json',
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN='webhook-secret',
        )
        self.assertEqual(response.status_code, 200, response.content)
        handle_callback.assert_called_once_with(self.user, 'pulsar:create')
        payloads = [call.kwargs.get('json') for call in post.call_args_list]
        self.assertTrue(any(payload and payload.get('callback_query_id') == 'callback-1' for payload in payloads))
        self.assertTrue(any(payload and payload.get('text') == 'Created' for payload in payloads))

    @patch('core.telegram_work_reports.handle_report_callback')
    @patch('core.task_notifications._telegram_api')
    def test_work_report_callback_survives_telegram_ack_failure(self, telegram_api, handle_report_callback):
        # Telegram can reject an old callback ID even though the report action
        # remains valid. The action must still run and its result be delivered.
        sent = []
        def api(method, payload):
            if method == 'answerCallbackQuery':
                raise RuntimeError('query is too old')
            sent.append((method, payload))
            return {'ok': True}
        telegram_api.side_effect = api
        handle_report_callback.side_effect = [
            [{'text': 'Report confirmed.'}],
            [{'text': 'Describe your correction.'}],
            [{'text': 'Report cancelled.'}],
        ]
        TaskNotificationPreference.objects.create(
            user=self.user, telegram_chat_id=123456789, telegram_enabled=True,
        )
        expected_actions = []
        for code in ('c', 'e', 'x'):
            action = f'wr:{code}:12345678123456781234567812345678:1'
            response = self.client.post(
                '/api/task-notifications/telegram/webhook/',
                data=json.dumps({
                    'callback_query': {
                        'id': f'expired-callback-{code}',
                        'data': action,
                        'message': {'chat': {'id': 123456789, 'type': 'private'}},
                    },
                }),
                content_type='application/json',
                HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN='webhook-secret',
            )
            self.assertEqual(response.status_code, 200, response.content)
            expected_actions.append(action)
        self.assertEqual(
            [call.args[1] for call in handle_report_callback.call_args_list],
            expected_actions,
        )
        sent_texts = [payload['text'] for method, payload in sent if method == 'sendMessage']
        self.assertEqual(
            sent_texts, ['Report confirmed.', 'Describe your correction.', 'Report cancelled.'],
        )
        self.assertFalse(any('could not complete' in text.lower() for text in sent_texts))

    @patch('core.task_notifications.requests.post')
    def test_worker_delivers_email_and_telegram(self, post):
        post.return_value = Mock(
            raise_for_status=Mock(),
            json=Mock(return_value={'ok': True, 'result': {}}),
        )
        TaskNotificationPreference.objects.create(
            user=self.user,
            telegram_chat_id=123456789,
            telegram_enabled=True,
            email_enabled=True,
        )
        common = {
            'recipient': self.user,
            'event_type': 'task.updated',
            'subject': 'Task updated: Example',
            'body': 'A teammate updated your task.\n\nOpen task: https://graviquest.com/workspace/core/tasks',
            'payload': {'url': 'https://graviquest.com/workspace/core/tasks'},
        }
        TaskNotificationOutbox.objects.create(
            **common,
            channel=TaskNotificationOutbox.Channel.EMAIL,
            event_key='event:test-email',
        )
        TaskNotificationOutbox.objects.create(
            **common,
            channel=TaskNotificationOutbox.Channel.TELEGRAM,
            event_key='event:test-telegram',
        )

        result = deliver_pending()
        self.assertEqual(result['sent'], 2)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [self.user.email])
        self.assertTrue(post.called)
        self.assertEqual(
            TaskNotificationOutbox.objects.filter(status=TaskNotificationOutbox.Status.SENT).count(),
            2,
        )

    def test_settings_can_disable_change_notifications(self):
        self.client.force_login(self.user)
        response = self.client.patch(
            '/api/task-notifications/settings/',
            data=json.dumps({
                'email_enabled': False,
                'task_changes_enabled': False,
                'due_reminders_enabled': True,
                'telegram_enabled': False,
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        pref = TaskNotificationPreference.objects.get(user=self.user)
        self.assertFalse(pref.email_enabled)
        self.assertFalse(pref.task_changes_enabled)
        self.assertTrue(pref.due_reminders_enabled)
        self.assertFalse(pref.telegram_enabled)
