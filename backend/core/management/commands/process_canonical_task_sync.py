from django.core.management.base import BaseCommand
from core.canonical_task_outbox import process_task_sync_outbox


class Command(BaseCommand):
    help = "Reconcile durable task save commits with conflict-aware native Nextcloud files."

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=5)

    def handle(self, *args, **options):
        result = process_task_sync_outbox(limit=max(1, options['limit']))
        self.stdout.write(
            "canonical_task_synced={synced} deferred={deferred} "
            "conflicts={conflict} skipped={skipped}".format(**result)
        )
