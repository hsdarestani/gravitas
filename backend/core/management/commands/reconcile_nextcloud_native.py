import json

from django.core.management.base import BaseCommand, CommandError

from core.models import NextcloudIdentity
from core.nextcloud_deck import sync_tasks_to_deck
from core.nextcloud_deck_access import ensure_core_deck_access
from core.nextcloud_notes import reconcile_notes


class Command(BaseCommand):
    help = 'Bidirectionally reconcile Gravitas with native Nextcloud Notes and Deck.'

    def add_arguments(self, parser):
        parser.add_argument('--notes-only', action='store_true')
        parser.add_argument('--deck-only', action='store_true')

    def handle(self, *args, **options):
        notes_only = bool(options['notes_only'])
        deck_only = bool(options['deck_only'])
        if notes_only and deck_only:
            raise CommandError('--notes-only and --deck-only are mutually exclusive')

        summary = {
            'notes': {'users': 0, 'errors': 0, 'changes': {}},
            'deck': None,
        }
        failed = False

        if not deck_only:
            aggregate = {
                'created': 0,
                'pushed': 0,
                'pulled': 0,
                'adopted': 0,
                'deleted': 0,
                'conflicts': 0,
                'errors': 0,
            }
            identities = NextcloudIdentity.objects.select_related('user').order_by('user_id')
            for identity in identities.iterator():
                summary['notes']['users'] += 1
                try:
                    result = reconcile_notes(identity.user)
                    for key, value in (result.get('counts') or {}).items():
                        aggregate[key] = aggregate.get(key, 0) + int(value or 0)
                except Exception as exc:  # one account must never block all others
                    summary['notes']['errors'] += 1
                    aggregate['errors'] += 1
                    self.stderr.write(f'Notes mirror failed for user {identity.user_id}: {exc}')
            summary['notes']['changes'] = aggregate
            failed = failed or bool(summary['notes']['errors'] or aggregate.get('errors'))

        if not notes_only:
            try:
                summary['deck'] = sync_tasks_to_deck()
                summary['deck']['access'] = ensure_core_deck_access(summary['deck']['board']['id'])
            except Exception as exc:
                # The timer will retry, but a failed oneshot must remain visible
                # to systemd/monitoring instead of looking like a healthy sync.
                summary['deck'] = {'ok': False, 'error': str(exc)}
                self.stderr.write(f'Deck mirror failed: {exc}')
                failed = True

        self.stdout.write(json.dumps(summary, sort_keys=True, default=str))
        if failed:
            raise CommandError('One or more Nextcloud mirror operations failed; the timer will retry.')
