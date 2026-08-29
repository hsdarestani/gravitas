import re

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db.models.deletion import ProtectedError

from core import cloud
from core.models import Workspace
from core.operating_models import (
    Initiative,
    KeyResult,
    OperatingCycle,
    OperatingMeeting,
    OperatingMilestone,
    OperatingProcess,
    OperatingRisk,
    OperatingTask,
    OperatingWorkPackage,
    StrategicObjective,
)

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


def matching_scopes(user):
    return [scope for scope in SCOPES if matches_scope(user, scope)]


def delete_e2e_owned_data(user, scopes):
    """Remove only data owned by a strictly identified E2E account.

    Operating E2E intentionally exercises real Core objects. Those models use
    PROTECT for ownership, so an interrupted test cannot be cleaned by deleting
    the User first. Delete the test-owned execution graph leaf-to-root, while
    preserving canonical processes (their optional owner is simply cleared).
    """
    if 'operating' in scopes:
        OperatingTask.objects.filter(owner=user).delete()
        OperatingRisk.objects.filter(owner=user).delete()
        OperatingWorkPackage.objects.filter(owner=user).delete()
        OperatingMilestone.objects.filter(owner=user).delete()
        Initiative.objects.filter(owner=user).delete()
        KeyResult.objects.filter(owner=user).delete()
        StrategicObjective.objects.filter(owner=user).delete()
        OperatingMeeting.objects.filter(owner=user).delete()
        OperatingCycle.objects.filter(owner=user).delete()
        OperatingProcess.objects.filter(owner=user).update(owner=None)

    # Every self-registered E2E account receives a private workspace. Remove
    # only personal workspaces owned by the test identity; shared Core/Research
    # workspaces are never selected here.
    Workspace.objects.filter(owner=user, kind=Workspace.Kind.PERSONAL).delete()


class Command(BaseCommand):
    help = 'Delete strictly identified Gravitas production E2E accounts, owned test data and Nextcloud identities.'

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
            user_scopes = [scope for scope in matching_scopes(user) if scope in scopes]
            identity = getattr(user, 'gravitas_nextcloud', None)
            if identity:
                try:
                    cloud.delete_identity(identity)
                except Exception as exc:
                    raise CommandError(
                        f'Nextcloud cleanup failed for test user {user.pk} ({user.email}); '
                        'Django account was kept so cleanup can be retried.'
                    ) from exc

            delete_e2e_owned_data(user, user_scopes)
            email = user.email
            pk = user.pk
            try:
                user.delete()
            except ProtectedError as exc:
                raise CommandError(
                    f'E2E user {pk} ({email}) still owns protected data after cleanup: {exc}'
                ) from exc
            deleted += 1
            self.stdout.write(f'Deleted E2E user {pk} {email}')

        self.stdout.write(self.style.SUCCESS(f'cleanup complete scope={options["scope"]} deleted={deleted}'))
