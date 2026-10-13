from django.core.management.base import BaseCommand, CommandError
from core.canonical_projects import dav_read
from core.canonical_journal import recover_journal
from core import cloud
from core.models import ResearchProject
from core.canonical_models import CanonicalProject, CanonicalWriteCommit
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
        self.stdout.write(f"db_commit_witness={CanonicalWriteCommit.objects.filter(pk=options['batch_id']).exists()}")
        # Read-only inspection. Never print note bodies, credentials or journals.
        # Exact byte/identity comparisons identify where automatic recovery is
        # blocked, without weakening the guarded recovery algorithm.
        for index, op in enumerate(manifest['operations']):
            kind = op.get('kind')
            if kind == 'acl':
                from core.canonical_acl import read_acl, normalize
                current = read_acl(op['path'])
                old = (op.get('before') or {}).get('rules', [])
                written = (op.get('written') or {}).get('rules', [])
                result = 'unchanged' if current['rules'] == normalize(old) else (
                    'written_revision' if current['rules'] == normalize(written) else 'manual_review')
            else:
                current = dav_read(op['path'])
                before = op.get('before')
                matches_before = bool(current and before
                    and current.get('file_id') and before.get('file_id') == current.get('file_id')
                    and current.get('content') == before.get('content'))
                matches_written = bool(current and op.get('written_etag')
                    and current.get('etag') == op['written_etag'])
                if current == before or matches_before:
                    result = 'already_original'
                elif matches_written:
                    result = 'written_revision'
                elif kind == 'delete' and current is None and op.get('deleted'):
                    result = 'deleted_revision'
                else:
                    result = 'manual_review'
            self.stdout.write(f"op={index} kind={kind} state={result} restored={bool(op.get('restored'))}")
        if not options['apply']:
            self.stdout.write('Inspection only; no files or journals were mutated.')
        if options['apply']:
            with transaction.atomic():
                CanonicalProject.objects.select_for_update().get(project=project)
                self.stdout.write(recover_journal(path))
