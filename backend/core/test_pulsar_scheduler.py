import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from .models import PulsarRun
from .operating_models import (
    TaskInAppNotification,
    TaskNotificationOutbox,
    TaskNotificationPreference,
)
from .pulsar_runtime.scheduler import (
    cancel_scheduled_run,
    schedule_reminder,
    wake_due_runs,
)


class PulsarSchedulerTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='pulsar-scheduler@example.test',
            email='pulsar-scheduler@example.test',
            password='Strong-pass-123!',
        )
        TaskNotificationPreference.objects.create(
            user=self.user,
            email_enabled=False,
            telegram_enabled=False,
            due_reminders_enabled=True,
        )

    def test_schedule_and_wake_reminder_exactly_once(self):
        run = schedule_reminder(
            self.user,
            message='Review the research synthesis.',
            due_at=timezone.now() + timedelta(minutes=30),
            surface='research',
            skill='research',
        )
        self.assertEqual(run.status, PulsarRun.Status.WAITING_TIME)
        self.assertEqual(run.thread.status, run.thread.Status.WAITING)

        result = wake_due_runs(
            now=timezone.now() + timedelta(hours=1),
        )
        self.assertEqual(result['awakened'], 1)
        self.assertEqual(result['notifications_queued'], 1)

        run.refresh_from_db()
        self.assertEqual(run.status, PulsarRun.Status.COMPLETED)
        self.assertIsNone(run.wait_until)
        self.assertEqual(run.output_text, 'scheduled_reminder_enqueued')
        notification = TaskInAppNotification.objects.get(
            recipient=self.user,
            event_type='pulsar.reminder',
        )
        self.assertIn('Review the research synthesis.', notification.body)
        self.assertEqual(
            notification.payload['pulsar_run_id'],
            run.run_id,
        )

        second = wake_due_runs(
            now=timezone.now() + timedelta(hours=2),
        )
        self.assertEqual(second['awakened'], 0)
        self.assertEqual(
            TaskInAppNotification.objects.filter(
                recipient=self.user,
                event_type='pulsar.reminder',
            ).count(),
            1,
        )

    def test_reminder_uses_existing_email_and_telegram_outbox(self):
        pref = TaskNotificationPreference.objects.get(user=self.user)
        pref.email_enabled = True
        pref.telegram_enabled = True
        pref.telegram_chat_id = 99887766
        pref.save()

        run = schedule_reminder(
            self.user,
            message='Continue the lesson.',
            due_at=timezone.now() + timedelta(minutes=5),
            surface='lms',
            skill='learning',
        )
        result = wake_due_runs(
            now=timezone.now() + timedelta(minutes=10),
        )
        self.assertEqual(result['awakened'], 1)
        self.assertEqual(result['notifications_queued'], 3)
        self.assertEqual(
            TaskNotificationOutbox.objects.filter(
                recipient=self.user,
                event_type='pulsar.reminder',
            ).count(),
            2,
        )
        channels = set(
            TaskNotificationOutbox.objects.filter(
                recipient=self.user,
                event_type='pulsar.reminder',
            ).values_list('channel', flat=True)
        )
        self.assertEqual(channels, {'email', 'telegram'})
        run.refresh_from_db()
        self.assertEqual(run.status, PulsarRun.Status.COMPLETED)

    def test_cancel_scheduled_run_is_owner_scoped(self):
        run = schedule_reminder(
            self.user,
            message='Cancel me.',
            due_at=timezone.now() + timedelta(days=1),
        )
        other = get_user_model().objects.create_user(
            username='other-scheduler@example.test',
            email='other-scheduler@example.test',
            password='Strong-pass-123!',
        )
        self.assertIsNone(
            cancel_scheduled_run(other, run.run_id)
        )
        cancelled = cancel_scheduled_run(
            self.user,
            run.run_id,
        )
        self.assertIsNotNone(cancelled)
        self.assertEqual(
            cancelled.status,
            PulsarRun.Status.CANCELLED,
        )

    def test_reminder_api_create_list_and_cancel(self):
        self.client.force_login(self.user)
        due_at = timezone.now() + timedelta(hours=2)
        response = self.client.post(
            '/api/platform/pulsar/reminders/',
            json.dumps({
                'message': 'Check the course notes.',
                'title': 'Course follow up',
                'due_at': due_at.isoformat(),
                'surface': 'lms',
                'skill': 'learning',
                'thread_id': 'course-followup',
                'metadata': {'course_id': 41},
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        payload = response.json()['reminder']
        self.assertEqual(payload['status'], 'waiting_time')
        self.assertEqual(payload['thread_key'], 'course-followup')
        run_id = payload['run_id']

        response = self.client.get('/api/platform/pulsar/reminders/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()['reminders'][0]['run_id'],
            run_id,
        )

        response = self.client.delete(
            f'/api/platform/pulsar/reminders/{run_id}/',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'cancelled')

    def test_past_due_time_is_rejected(self):
        self.client.force_login(self.user)
        response = self.client.post(
            '/api/platform/pulsar/reminders/',
            json.dumps({
                'message': 'Too late',
                'due_at': (
                    timezone.now() - timedelta(minutes=1)
                ).isoformat(),
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()['error'],
            'reminder_due_at_must_be_future',
        )
