from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.operating_models import OperatingTask, WorkStatus


CONFIRM_TOKEN = 'PURGE-OPEN-TASKS'


class Command(BaseCommand):
    help = 'Delete every open operating task while preserving completed/archived history.'

    def add_arguments(self, parser):
        parser.add_argument('--confirm', default='')
        parser.add_argument('--expected-count', type=int, default=None)

    def handle(self, *args, **options):
        if options['confirm'] != CONFIRM_TOKEN:
            raise CommandError(f'Pass --confirm {CONFIRM_TOKEN}')

        qs = OperatingTask.objects.exclude(
            status__in=[WorkStatus.DONE, WorkStatus.ARCHIVED]
        )
        count = qs.count()
        expected = options.get('expected_count')
        if expected is not None and count != expected:
            raise CommandError(
                f'Open task count changed: expected {expected}, found {count}. '
                'Nothing was deleted.'
            )

        ids = list(qs.values_list('id', flat=True))
        with transaction.atomic():
            deleted, detail = qs.delete()

        remaining = OperatingTask.objects.exclude(
            status__in=[WorkStatus.DONE, WorkStatus.ARCHIVED]
        ).count()
        if remaining:
            raise CommandError(f'Purge incomplete: {remaining} open tasks remain.')

        self.stdout.write(
            self.style.SUCCESS(
                f'Deleted {count} open tasks ({deleted} total cascaded rows). '
                f'Open tasks remaining: {remaining}.'
            )
        )
        self.stdout.write(f'Deleted task ids: {",".join(str(value) for value in ids)}')
