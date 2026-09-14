from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from . import cloud
from .models import NextcloudIdentity


class NextcloudIdentityCredentialRepairTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='credential-user',
            email='credential@example.com',
            password='local-account-password',
        )

    def identity(self, encrypted_password):
        return NextcloudIdentity.objects.create(
            user=self.user,
            username=f'gravitas-u-{self.user.pk}',
            encrypted_password=encrypted_password,
        )

    @staticmethod
    def successful_ocs_response():
        response = MagicMock(status_code=200)
        response.json.return_value = {
            'ocs': {
                'meta': {'status': 'ok', 'statuscode': 100, 'message': 'OK'},
                'data': {},
            },
        }
        return response

    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud._admin_auth', return_value=('admin', 'secret'))
    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud._request')
    def test_reasserts_stored_password_without_changing_local_secret(self, request, _admin_auth):
        identity = self.identity(cloud._encrypt('stored-native-password'))
        original_ciphertext = identity.encrypted_password
        request.return_value = self.successful_ocs_response()

        call_command('repair_nextcloud_identity_credentials')

        identity.refresh_from_db()
        self.assertEqual(identity.encrypted_password, original_ciphertext)
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args[0], 'PUT')
        self.assertTrue(request.call_args.args[1].endswith(f'/cloud/users/{identity.username}'))
        self.assertEqual(
            request.call_args.kwargs['data'],
            {'key': 'password', 'value': 'stored-native-password'},
        )
        self.assertEqual(request.call_args.kwargs['auth'], ('admin', 'secret'))

    @patch('core.management.commands.repair_nextcloud_identity_credentials.secrets.token_urlsafe', return_value='fresh-native-password')
    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud._admin_auth', return_value=('admin', 'secret'))
    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud._request')
    def test_rotates_unreadable_local_secret_only_after_remote_reset_succeeds(
        self, request, _admin_auth, _token_urlsafe,
    ):
        identity = self.identity('not-a-valid-fernet-token')
        request.return_value = self.successful_ocs_response()

        call_command('repair_nextcloud_identity_credentials')

        identity.refresh_from_db()
        self.assertEqual(cloud._decrypt(identity.encrypted_password), 'fresh-native-password')
        self.assertEqual(
            request.call_args.kwargs['data'],
            {'key': 'password', 'value': 'fresh-native-password'},
        )

    @patch('core.management.commands.repair_nextcloud_identity_credentials.secrets.token_urlsafe', return_value='fresh-native-password')
    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud._admin_auth', return_value=('admin', 'secret'))
    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud._request')
    def test_remote_failure_never_commits_a_new_local_secret(self, request, _admin_auth, _token_urlsafe):
        identity = self.identity('not-a-valid-fernet-token')
        request.side_effect = cloud.CloudError('Cloud storage returned HTTP 429')

        with self.assertRaises(CommandError):
            call_command('repair_nextcloud_identity_credentials')

        identity.refresh_from_db()
        self.assertEqual(identity.encrypted_password, 'not-a-valid-fernet-token')
