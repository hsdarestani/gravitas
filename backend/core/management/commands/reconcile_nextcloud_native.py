import json

from django.core.management.base import BaseCommand

from core.models import NextcloudIdentity
from core.nextcloud_deck import DeckError, sync_tasks_to_deck
from core.nextcloud_notes import NotesError, reconcile_notes


class Command(BaseCommand):
    help = 'Bidirectionally reconcile Gravitas with native Nextcloud Notes and Deck.'

    def add_arguments(self, parser):
        parser.add_argument('--notes-only', action='store_true')
        parser.add_argument('--deck-only', action='store_true')

    def handle(self, *args, **options):
        notes_only = bool(options['notes_only'])
        deck_only = bool(options['deck_only'])
        if notes_only and deck_only:
            raise ValueError('--notes-only and --deck-only are mutually exclusive')

        summary = {
            'notes': {'users': 0, 'errors': 0, 'changes': {}},
            'deck': None,
        }

        if not deck_only:
            aggregate = {'created': 0, 'pushed': 0, 'pulled': 0, 'adopted': 0, 'conflicts': 0, 'errors': 0}
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

        if not notes_only:
            try:
                summary['deck'] = sync_tasks_to_deck()
            except (DeckError, NotesError, Exception) as exc:
                # The timer runs frequently. Keep the command observable but do
                # not prevent the next run from reconciling Notes because Deck
                # is temporarily unavailable (or vice versa).
                summary['deck'] = {'ok': False, 'error': str(exc)}
                self.stderr.write(f'Deck mirror failed: {exc}')

        self.stdout.write(json.dumps(summary, sort_keys=True, default=str))
