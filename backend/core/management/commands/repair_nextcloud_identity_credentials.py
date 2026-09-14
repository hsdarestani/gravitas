import secrets
from urllib.parse import quote

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core import cloud
from core.models import NextcloudIdentity


class Command(BaseCommand):
    help = (
        'Re-assert Gravitas-managed per-user Nextcloud passwords from the encrypted '
        'identity store before native Notes/DAV reconciliation.'
    )

    def handle(self, *args, **options):
        endpoint = f'{settings.NEXTCLOUD_INTERNAL_URL}/ocs/v1.php/cloud/users'
        headers = {'OCS-APIRequest': 'true', 'Accept': 'application/json'}
        repaired = 0
        rotated = 0
        failures = []

        identities = NextcloudIdentity.objects.select_related('user').order_by('user_id')
        for identity in identities.iterator():
            new_encrypted_password = None
            try:
                password = cloud._decrypt(identity.encrypted_password)
            except cloud.CloudError:
                # If SECRET_KEY was intentionally rotated, the old encrypted
                # credential is no longer recoverable. Generate a fresh secret,
                # set it in Nextcloud first, and persist it only after the remote
                # update succeeds so the two sides cannot drift further apart.
                password = secrets.token_urlsafe(36)
                new_encrypted_password = cloud._encrypt(password)

            try:
                response = cloud._request(
                    'PUT',
                    f'{endpoint}/{quote(identity.username, safe="")}',
                    auth=cloud._admin_auth(),
                    expected={200},
                    headers=headers,
                    data={'key': 'password', 'value': password},
                )
                cloud._ocs_data(response, 'Could not repair cloud identity credentials')
            except Exception as exc:
                failures.append((identity.user_id, identity.username, str(exc)))
                continue

            if new_encrypted_password is not None:
                NextcloudIdentity.objects.filter(pk=identity.pk).update(
                    encrypted_password=new_encrypted_password,
                    updated_at=timezone.now(),
                )
                identity.encrypted_password = new_encrypted_password
                rotated += 1
            repaired += 1

        self.stdout.write(
            self.style.SUCCESS(
                f'Nextcloud identity credential repair complete repaired={repaired} rotated={rotated} failures={len(failures)}'
            )
        )
        if failures:
            # Never print passwords. User id + native username are sufficient
            # for an operator to identify the damaged identity.
            for user_id, username, error in failures[:20]:
                self.stderr.write(f'credential repair failed user={user_id} identity={username}: {error}')
            if len(failures) > 20:
                self.stderr.write(f'... and {len(failures) - 20} more credential repair failures')
            raise CommandError('One or more Nextcloud identity credentials could not be repaired.')
