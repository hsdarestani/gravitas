from django.core.management.base import BaseCommand, CommandError
from core.canonical_projects import dav_read
from core.canonical_journal import recover_journal
from core import cloud
from core.models import ResearchProject
from core.canonical_models import CanonicalProject
from django.db import transaction
import json
import uuid


class Command(BaseCommand):
    help = 'Inspect a private canonical write journal; --apply conditionally recovers it.'

    def add_arguments(self, parser):
        parser.add_argument('project_id', type=int)
        parser.add_argument('batch_id', type=uuid.UUID)
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        project = ResearchProject.objects.get(pk=options['project_id'])
        path = cloud.project_mountpoint(project) + '/06_Archive/CanonicalTransactions/' + str(options['batch_id']) + '.json'
        remote = dav_read(path)
        if not remote:
            raise CommandError('Journal not found')
        manifest = json.loads(remote['content'])
        if manifest.get('project_id') != project.pk:
            raise CommandError('Journal project mismatch')
        self.stdout.write(f"state={manifest['state']} operations={len(manifest['operations'])}")
        if options['apply']:
            with transaction.atomic():
                CanonicalProject.objects.select_for_update().get(project=project)
                self.stdout.write(recover_journal(path))
