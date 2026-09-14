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
    def ocs_response(statuscode=100, message='OK', *, http_status=200):
        response = MagicMock(status_code=http_status)
        response.json.return_value = {
            'ocs': {
                'meta': {
                    'status': 'ok' if statuscode in {100, 200} else 'failure',
                    'statuscode': statuscode,
                    'message': message,
                },
                'data': {},
            },
        }
        return response

    @classmethod
    def successful_ocs_response(cls):
        return cls.ocs_response()

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
    def test_transport_failure_never_commits_a_new_local_secret_or_creates_user(
        self, request, _admin_auth, _token_urlsafe,
    ):
        identity = self.identity('not-a-valid-fernet-token')
        request.side_effect = cloud.CloudError('Cloud storage returned HTTP 429')

        with self.assertRaises(CommandError):
            call_command('repair_nextcloud_identity_credentials')

        identity.refresh_from_db()
        self.assertEqual(identity.encrypted_password, 'not-a-valid-fernet-token')
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args[0], 'PUT')

    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud.make_folder')
    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud.set_quota')
    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud._admin_auth', return_value=('admin', 'secret'))
    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud._request')
    def test_missing_native_user_is_recreated_with_stable_identity_and_stored_password(
        self, request, _admin_auth, set_quota, make_folder,
    ):
        identity = self.identity(cloud._encrypt('stored-native-password'))
        original_ciphertext = identity.encrypted_password
        request.side_effect = [
            self.ocs_response(998, 'The requested user could not be found'),
            self.successful_ocs_response(),
        ]

        call_command('repair_nextcloud_identity_credentials')

        identity.refresh_from_db()
        self.assertEqual(identity.encrypted_password, original_ciphertext)
        self.assertEqual(request.call_count, 2)
        reset_call, create_call = request.call_args_list
        self.assertEqual(reset_call.args[0], 'PUT')
        self.assertEqual(create_call.args[0], 'POST')
        self.assertTrue(create_call.args[1].endswith('/ocs/v1.php/cloud/users'))
        self.assertEqual(create_call.kwargs['data']['userid'], identity.username)
        self.assertEqual(create_call.kwargs['data']['password'], 'stored-native-password')
        self.assertEqual(create_call.kwargs['data']['displayName'], self.user.email)
        set_quota.assert_called_once()
        self.assertEqual(set_quota.call_args.args[0].pk, identity.pk)
        make_folder.assert_called_once()
        self.assertEqual(make_folder.call_args.args[0].pk, identity.pk)
        self.assertEqual(make_folder.call_args.args[1], 'Gravitas')

    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud.make_folder')
    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud.set_quota')
    @patch('core.management.commands.repair_nextcloud_identity_credentials.secrets.token_urlsafe', return_value='fresh-native-password')
    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud._admin_auth', return_value=('admin', 'secret'))
    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud._request')
    def test_missing_native_user_with_unreadable_secret_rotates_after_create_before_dav(
        self, request, _admin_auth, _token_urlsafe, set_quota, make_folder,
    ):
        identity = self.identity('not-a-valid-fernet-token')
        request.side_effect = [
            self.ocs_response(998, 'The requested user could not be found'),
            self.successful_ocs_response(),
        ]

        observed_passwords = []

        def capture_identity(repaired_identity, _path):
            observed_passwords.append(cloud._decrypt(repaired_identity.encrypted_password))

        make_folder.side_effect = capture_identity

        call_command('repair_nextcloud_identity_credentials')

        identity.refresh_from_db()
        self.assertEqual(cloud._decrypt(identity.encrypted_password), 'fresh-native-password')
        self.assertEqual(request.call_args_list[1].kwargs['data']['password'], 'fresh-native-password')
        self.assertEqual(observed_passwords, ['fresh-native-password'])
        set_quota.assert_called_once()
        make_folder.assert_called_once()

    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud.make_folder')
    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud.set_quota')
    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud._admin_auth', return_value=('admin', 'secret'))
    @patch('core.management.commands.repair_nextcloud_identity_credentials.cloud._request')
    def test_reset_failure_is_not_masked_when_recreate_reports_existing_user(
        self, request, _admin_auth, set_quota, make_folder,
    ):
        identity = self.identity(cloud._encrypt('stored-native-password'))
        request.side_effect = [
            self.ocs_response(102, 'Could not update user'),
            self.ocs_response(102, 'User already exists'),
        ]

        with self.assertRaises(CommandError):
            call_command('repair_nextcloud_identity_credentials')

        self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args_list[1].args[0], 'POST')
        set_quota.assert_not_called()
        make_folder.assert_not_called()
