import json
from django.core.management.base import BaseCommand
from django.db import transaction
from core.task_dates import recover_task_dates
from core.task_document_dates import recover_document_dates


class Command(BaseCommand):
    help = 'Audit lifecycle dates; --apply recovers history and source-linked document estimates.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        with transaction.atomic():
            history = recover_task_dates(apply=options['apply'])
            documents = recover_document_dates(apply=options['apply'])
            self.stdout.write(json.dumps({'history': history, 'documents': documents}, sort_keys=True))
