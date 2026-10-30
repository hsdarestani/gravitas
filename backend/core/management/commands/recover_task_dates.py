import json
from django.core.management.base import BaseCommand
from django.db import transaction
from core.task_dates import recover_task_dates


class Command(BaseCommand):
    help = 'Audit task lifecycle dates; --apply recovers dates from recorded evidence.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        with transaction.atomic():
            self.stdout.write(json.dumps(recover_task_dates(apply=options['apply']), sort_keys=True))
