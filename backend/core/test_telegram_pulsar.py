import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from .operating_models import KeyResult, OperatingTask, StrategicObjective, TelegramPulsarSession
from .platform_runtime_v3 import ensure_platform_workspaces
from .telegram_pulsar import handle_callback, handle_message


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
        self.assertEqual(session.state['mode'], 'ask_kr')

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
