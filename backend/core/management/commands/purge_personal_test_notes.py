import json
import re
from collections import defaultdict

from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from core import cloud
from core.models import KnowledgeActivity, KnowledgeResource, NextcloudIdentity
from core.platform_models import AccessGrant, AccessRequest, EntityLink, ObjectPolicy, ShareLink
from core.space_models import NoteSpaceLink


CONFIRM_PHRASE = 'PURGE-PERSONAL-TEST-NOTES'
UNTITLED_RE = re.compile(r'^Untitled(?: \(\d+\))?$')
PERSONAL_NOTES_PATH = 'Space/Personal/Notes'


class Command(BaseCommand):
    help = (
        'Remove obvious placeholder/test notes named Untitled (or Untitled (N)) '
        'from Space/Personal/Notes while preserving real titled personal notes.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Actually delete data. Without this flag the command is a dry run.')
        parser.add_argument('--confirm', default='', help=f'Required with --apply: {CONFIRM_PHRASE}')
        parser.add_argument('--skip-cloud', action='store_true', help='Skip Nextcloud cleanup and only clean the database.')

    def handle(self, *args, **options):
        apply_changes = bool(options['apply'])
        if apply_changes and options['confirm'] != CONFIRM_PHRASE:
            raise CommandError(f'--apply requires --confirm {CONFIRM_PHRASE}')

        candidate_ids = list(
            NoteSpaceLink.objects.filter(
                category__nextcloud_path=PERSONAL_NOTES_PATH,
                resource__kind=KnowledgeResource.Kind.NOTE,
            )
            .values_list('resource_id', flat=True)
            .distinct()
        )
        candidates = KnowledgeResource.objects.filter(id__in=candidate_ids).only('id', 'title', 'owner_id', 'storage_path')
        target_ids = [row.id for row in candidates if UNTITLED_RE.fullmatch((row.title or '').strip())]
        targets = KnowledgeResource.objects.filter(id__in=target_ids)

        summary = {
            'mode': 'APPLY' if apply_changes else 'DRY-RUN',
            'personal_test_notes': len(target_ids),
        }
        self.stdout.write(json.dumps(summary, sort_keys=True))

        if not apply_changes:
            self.stdout.write(self.style.WARNING('Dry run only. No rows or cloud files were changed.'))
            return

        warnings = []
        if not options['skip_cloud'] and target_ids:
            warnings.extend(self._purge_cloud(target_ids))

        if target_ids:
            content_type = ContentType.objects.get_for_model(KnowledgeResource, for_concrete_model=False)
            with transaction.atomic():
                ObjectPolicy.objects.filter(content_type=content_type, object_id__in=target_ids).delete()
                AccessGrant.objects.filter(content_type=content_type, object_id__in=target_ids).delete()
                ShareLink.objects.filter(content_type=content_type, object_id__in=target_ids).delete()
                AccessRequest.objects.filter(content_type=content_type, object_id__in=target_ids).delete()
                EntityLink.objects.filter(
                    Q(source_content_type=content_type, source_object_id__in=target_ids)
                    | Q(target_content_type=content_type, target_object_id__in=target_ids)
                ).delete()
                KnowledgeActivity.objects.filter(resource_id__in=target_ids).delete()
                targets.delete()

        self.stdout.write(self.style.SUCCESS(f'Purged {len(target_ids)} personal placeholder/test note(s).'))
        if warnings:
            self.stdout.write(self.style.WARNING(f'Cloud cleanup completed with {len(warnings)} warning(s):'))
            for warning in warnings[:20]:
                self.stdout.write(self.style.WARNING(f'  - {warning}'))

    def _purge_cloud(self, target_ids):
        warnings = []
        resources = list(
            KnowledgeResource.objects.filter(id__in=target_ids).values('id', 'owner_id', 'storage_path')
        )
        owner_ids = {row['owner_id'] for row in resources}
        identities = {
            row.user_id: row
            for row in NextcloudIdentity.objects.filter(user_id__in=owner_ids)
        }
        paths_by_user = defaultdict(set)

        for row in resources:
            if row['storage_path']:
                paths_by_user[row['owner_id']].add(row['storage_path'])

        for row in NoteSpaceLink.objects.filter(resource_id__in=target_ids).values(
            'resource__owner_id', 'note_path', 'attachments_path'
        ):
            user_id = row['resource__owner_id']
            if row['note_path']:
                paths_by_user[user_id].add(row['note_path'])
            if row['attachments_path']:
                paths_by_user[user_id].add(row['attachments_path'])

        for user_id, paths in paths_by_user.items():
            identity = identities.get(user_id)
            if not identity:
                continue
            for path in sorted(paths, key=lambda value: (value.count('/'), len(value)), reverse=True):
                try:
                    cloud.delete(identity, path)
                except Exception as exc:  # noqa: BLE001 - database cleanup must still finish
                    warnings.append(f'user {user_id}: could not delete {path}: {exc}')

        return warnings
