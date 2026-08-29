import re

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from core import cloud

User = get_user_model()

SCOPES = {
    'auth': [
        (re.compile(r'^auth-e2e-\d+@example\.com$'), {'Production E2E'}),
        (re.compile(r'^browser-e2e-\d+-\d+@example\.com$'), {'Browser Production E2E'}),
    ],
    'workspace': [
        (re.compile(r'^workspace-a-\d+@example\.com$'), {'Workspace E2E'}),
        (re.compile(r'^workspace-b-\d+@example\.com$'), {'Workspace E2E'}),
    ],
    'operating': [
        (re.compile(r'^operating-e2e-\d+-\d+@example\.com$'), {'Operating Production E2E'}),
    ],
}


def matches_scope(user, scope):
    email = (user.email or '').strip().lower()
    name = (user.first_name or '').strip()
    for pattern, allowed_names in SCOPES[scope]:
        if pattern.fullmatch(email) and name in allowed_names:
            return True
    return False


class Command(BaseCommand):
    help = 'Delete strictly identified Gravitas production E2E accounts and their Nextcloud identities.'

    def add_arguments(self, parser):
        parser.add_argument('--scope', choices=['auth', 'workspace', 'operating', 'all'], default='all')
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        scopes = list(SCOPES) if options['scope'] == 'all' else [options['scope']]
        candidates = User.objects.filter(email__iendswith='@example.com', is_superuser=False, is_staff=False).order_by('pk')
        matched = [user for user in candidates if any(matches_scope(user, scope) for scope in scopes)]

        if options['dry_run']:
            for user in matched:
                self.stdout.write(f'Would delete {user.pk} {user.email}')
            self.stdout.write(self.style.SUCCESS(f'dry-run matched={len(matched)}'))
            return

        deleted = 0
        for user in matched:
            identity = getattr(user, 'gravitas_nextcloud', None)
            if identity:
                try:
                    cloud.delete_identity(identity)
                except Exception as exc:
                    raise CommandError(
                        f'Nextcloud cleanup failed for test user {user.pk} ({user.email}); '
                        'Django account was kept so cleanup can be retried.'
                    ) from exc
            email = user.email
            pk = user.pk
            user.delete()
            deleted += 1
            self.stdout.write(f'Deleted E2E user {pk} {email}')

        self.stdout.write(self.style.SUCCESS(f'cleanup complete scope={options["scope"]} deleted={deleted}'))
