import secrets
from urllib.parse import quote

import requests
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core import cloud
from core.models import NextcloudIdentity, StoragePlan


def _ocs_meta(response):
    """Return the OCS status code/message without hiding recoverable errors."""
    try:
        payload = response.json()['ocs']
        meta = payload.get('meta') or {}
        return int(meta.get('statuscode', 100)), str(meta.get('message') or '')
    except (KeyError, TypeError, ValueError, requests.JSONDecodeError) as exc:
        raise cloud.CloudError('Invalid response from cloud provisioning') from exc


def _display_name(user):
    return user.get_full_name() or user.first_name or user.email or user.username


class Command(BaseCommand):
    help = (
        'Reconcile Gravitas-managed per-user Nextcloud credentials and recreate '
        'missing native users before Notes/DAV reconciliation.'
    )

    def handle(self, *args, **options):
        endpoint = f'{settings.NEXTCLOUD_INTERNAL_URL}/ocs/v1.php/cloud/users'
        headers = {'OCS-APIRequest': 'true', 'Accept': 'application/json'}
        repaired = 0
        recreated = 0
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
                # but never persist it locally until Nextcloud has accepted it.
                password = secrets.token_urlsafe(36)
                new_encrypted_password = cloud._encrypt(password)

            user_endpoint = f'{endpoint}/{quote(identity.username, safe="")}'
            reset_error = None
            try:
                response = cloud._request(
                    'PUT',
                    user_endpoint,
                    auth=cloud._admin_auth(),
                    expected={200},
                    headers=headers,
                    data={'key': 'password', 'value': password},
                )
                reset_code, reset_message = _ocs_meta(response)
                if reset_code in {100, 200}:
                    if new_encrypted_password is not None:
                        NextcloudIdentity.objects.filter(pk=identity.pk).update(
                            encrypted_password=new_encrypted_password,
                            updated_at=timezone.now(),
                        )
                        identity.encrypted_password = new_encrypted_password
                        rotated += 1
                    repaired += 1
                    continue
                reset_error = f'password reset OCS {reset_code}: {reset_message or "unknown error"}'
            except Exception as exc:
                # HTTP/network/admin-auth failures are not evidence that the user
                # is missing. Creating another account would only mask the real
                # infrastructure error and can amplify rate limiting.
                failures.append((identity.user_id, identity.username, str(exc)))
                continue

            # A successful HTTP request with an OCS-level reset failure is the
            # legacy case seen in production: Gravitas still owns an identity row
            # whose native Nextcloud user was deleted. Recreate exactly the same
            # stable username. If the native account actually exists, Nextcloud's
            # create response says so and we keep the original reset failure.
            try:
                create_response = cloud._request(
                    'POST',
                    endpoint,
                    auth=cloud._admin_auth(),
                    expected={200, 201},
                    headers=headers,
                    data={
                        'userid': identity.username,
                        'password': password,
                        'displayName': _display_name(identity.user),
                    },
                )
                create_code, create_message = _ocs_meta(create_response)
                if create_code not in {100, 200}:
                    detail = create_message or 'unknown error'
                    failures.append(
                        (
                            identity.user_id,
                            identity.username,
                            f'{reset_error}; recreate OCS {create_code}: {detail}',
                        )
                    )
                    continue

                # The remote identity now definitely owns `password`. Persist a
                # replacement ciphertext only after that fact is true, then make
                # the in-memory object authoritative before DAV folder creation.
                if new_encrypted_password is not None:
                    NextcloudIdentity.objects.filter(pk=identity.pk).update(
                        encrypted_password=new_encrypted_password,
                        updated_at=timezone.now(),
                    )
                    identity.encrypted_password = new_encrypted_password
                    rotated += 1

                plan, _ = StoragePlan.objects.get_or_create(
                    user=identity.user,
                    defaults={
                        'tier': 'free',
                        'quota_bytes': settings.GRAVITAS_DEFAULT_QUOTA_BYTES,
                    },
                )
                cloud.set_quota(identity, plan.quota_bytes)
                cloud.make_folder(identity, 'Gravitas')
                recreated += 1
            except Exception as exc:
                failures.append(
                    (
                        identity.user_id,
                        identity.username,
                        f'{reset_error}; recreate failed: {exc}',
                    )
                )

        self.stdout.write(
            self.style.SUCCESS(
                'Nextcloud identity credential repair complete '
                f'repaired={repaired} recreated={recreated} rotated={rotated} '
                f'failures={len(failures)}'
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
