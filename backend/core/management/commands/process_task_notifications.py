from django.core.management.base import BaseCommand

from core.task_notifications import deliver_pending, enqueue_due_reminders


class Command(BaseCommand):
    help = 'Queue task deadline reminders and deliver pending email/Telegram task notifications.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100)

    def handle(self, *args, **options):
        queued = enqueue_due_reminders()
        result = deliver_pending(limit=max(1, options['limit']))
        self.stdout.write(
            self.style.SUCCESS(
                f"task notifications queued={queued} sent={result['sent']} "
                f"failed={result['failed']} skipped={result['skipped']}"
            )
        )
