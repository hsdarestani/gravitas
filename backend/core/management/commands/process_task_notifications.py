from django.core.management.base import BaseCommand

from core.task_notifications import deliver_pending, enqueue_due_reminders
from core.lms_api import publish_scheduled_course_revisions
from core.pulsar_runtime.scheduler import wake_due_runs


class Command(BaseCommand):
    help = 'Queue task deadline reminders and deliver pending email/Telegram task notifications.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100)

    def handle(self, *args, **options):
        pulsar = wake_due_runs(limit=max(1, options['limit']))
        queued = enqueue_due_reminders()
        result = deliver_pending(limit=max(1, options['limit']))
        published_courses = publish_scheduled_course_revisions()
        self.stdout.write(
            self.style.SUCCESS(
                f"pulsar_runs_awakened={pulsar['awakened']} "
                f"pulsar_notifications_queued={pulsar['notifications_queued']} "
                f"task notifications queued={queued} sent={result['sent']} "
                f"failed={result['failed']} skipped={result['skipped']} "
                f"course_revisions_published={published_courses}"
            )
        )
