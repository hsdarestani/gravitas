import re
from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db.models.deletion import ProtectedError
from django.utils import timezone

from core import cloud
from core.models import NewsletterSubscriber, Workspace
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


def email_matches_scope(email, scope):
    value = (email or '').strip().lower()
    return any(pattern.fullmatch(value) for pattern, _allowed_names in SCOPES[scope])


def matching_scopes(user):
    return [scope for scope in SCOPES if matches_scope(user, scope)]


def _nextcloud_identity_state(identity):
    """Return (present|missing|unknown, diagnostic) for one OCS account.

    Account deletion is intentionally idempotent. A browser/API delete can
    remove the remote Nextcloud user and then fail later while deleting local
    Django data. The follow-up cleanup still has the local NextcloudIdentity
    row in that case; treating OCS "user not found" as another failure leaves
    an otherwise deletable E2E account behind forever.

    This probe is only used after delete_identity reported an OCS-level delete
    failure, so the normal successful path still performs one DELETE request.
    """
    endpoint = (
        f'{settings.NEXTCLOUD_INTERNAL_URL}/ocs/v1.php/cloud/users/'
        f'{quote(identity.username, safe="")}'
    )
    try:
        response = cloud._request(
            'GET',
            endpoint,
            auth=cloud._admin_auth(),
            expected={200},
            headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
        )
        meta = response.json()['ocs']['meta']
        code = int(meta.get('statuscode', 0))
        message = str(meta.get('message', '') or '').strip()
    except Exception as exc:
        return 'unknown', f'identity probe failed: {type(exc).__name__}: {exc}'

    diagnostic = f'OCS {code}' + (f': {message}' if message else '')
    if code in {100, 200}:
        return 'present', diagnostic

    missing_markers = ('not found', 'could not be found', 'does not exist', 'unknown user')
    if code == 998 or any(marker in message.lower() for marker in missing_markers):
        return 'missing', diagnostic
    return 'unknown', diagnostic


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
        parser.add_argument(
            '--min-age-minutes',
            type=int,
            default=0,
            help='Only delete matching E2E accounts at least this many minutes old.',
        )

    def handle(self, *args, **options):
        min_age_minutes = options['min_age_minutes']
        if min_age_minutes < 0:
            raise CommandError('--min-age-minutes must be zero or greater')

        scopes = list(SCOPES) if options['scope'] == 'all' else [options['scope']]
        candidates = User.objects.filter(email__iendswith='@example.com', is_superuser=False, is_staff=False)
        if min_age_minutes:
            cutoff = timezone.now() - timedelta(minutes=min_age_minutes)
            candidates = candidates.filter(date_joined__lte=cutoff)
        candidates = candidates.order_by('pk')
        matched = [user for user in candidates if any(matches_scope(user, scope) for scope in scopes)]

        if options['dry_run']:
            for user in matched:
                self.stdout.write(f'Would delete {user.pk} {user.email}')
            self.stdout.write(self.style.SUCCESS(f'dry-run matched={len(matched)}'))
            return

        deleted = 0
        failures = []
        for user in matched:
            user_scopes = [scope for scope in matching_scopes(user) if scope in scopes]
            identity = getattr(user, 'gravitas_nextcloud', None)
            if identity:
                try:
                    cloud.delete_identity(identity)
                except cloud.CloudError as exc:
                    # delete_identity deliberately rejects non-success OCS
                    # codes. If a prior account-delete attempt already removed
                    # the remote user, Nextcloud answers the repeat DELETE with
                    # "not found". Probe once and accept only that exact state;
                    # every other failure remains visible and retryable.
                    state = 'unknown'
                    diagnostic = ''
                    if str(exc) == 'Could not delete cloud identity':
                        state, diagnostic = _nextcloud_identity_state(identity)
                    if state == 'missing':
                        self.stdout.write(
                            f'Nextcloud identity already absent for E2E user {user.pk} '
                            f'({identity.username}); continuing local cleanup [{diagnostic}]'
                        )
                    else:
                        detail = f' [{diagnostic}]' if diagnostic else ''
                        message = (
                            f'Nextcloud cleanup failed for test user {user.pk} ({user.email}): {exc}{detail}; '
                            'Django account was kept so cleanup can be retried.'
                        )
                        failures.append(message)
                        self.stderr.write(message)
                        # One locked/temporarily unavailable identity must not
                        # leave every later E2E account behind. Keep this user
                        # intact and continue; the command still exits non-zero.
                        continue

            delete_e2e_owned_data(user, user_scopes)
            email = user.email
            pk = user.pk
            # Newsletter subscription is keyed by email rather than FK'd to
            # the account, so deleting the User alone would leave E2E rows in
            # Platform Admin. Remove the strictly matched test subscriber first.
            NewsletterSubscriber.objects.filter(email__iexact=email).delete()
            try:
                user.delete()
            except ProtectedError as exc:
                message = f'E2E user {pk} ({email}) still owns protected data after cleanup: {exc}'
                failures.append(message)
                self.stderr.write(message)
                continue
            except Exception as exc:
                message = (
                    f'E2E user {pk} ({email}) local cleanup failed: '
                    f'{type(exc).__name__}: {exc}'
                )
                failures.append(message)
                self.stderr.write(message)
                continue
            deleted += 1
            self.stdout.write(f'Deleted E2E user {pk} {email}')

        # Sweep orphaned E2E newsletter rows from older runs where the User
        # was already deleted before this cleanup learned about email-keyed
        # subscribers. The regexes are intentionally strict @example.com test
        # families; real subscribers can never match this sweep.
        subscriber_ids = [
            item.pk
            for item in NewsletterSubscriber.objects.filter(email__iendswith='@example.com').only('pk', 'email')
            if any(email_matches_scope(item.email, scope) for scope in scopes)
        ]
        orphan_newsletters_deleted = 0
        if subscriber_ids:
            orphan_newsletters_deleted, _ = NewsletterSubscriber.objects.filter(pk__in=subscriber_ids).delete()

        if failures:
            raise CommandError(
                f'cleanup incomplete scope={options["scope"]} deleted={deleted} '
                f'newsletter_rows_deleted={orphan_newsletters_deleted} failures={len(failures)}; '
                + ' | '.join(failures[:10])
            )

        self.stdout.write(self.style.SUCCESS(
            f'cleanup complete scope={options["scope"]} deleted={deleted} '
            f'newsletter_rows_deleted={orphan_newsletters_deleted}'
        ))
