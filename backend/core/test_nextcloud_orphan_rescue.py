"""Coverage for safe native identity and DAV recovery checks."""
import subprocess
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase

from . import cloud
from .models import NextcloudIdentity


class OrphanRecoveryContractTests(SimpleTestCase):
    def test_guarded_recovery_shell_parses_and_does_not_delete_source(self):
        script = Path(__file__).resolve().parents[2] / 'ops' / 'nextcloud' / 'rescue-orphan-managed-identity.sh'
        source = script.read_text(encoding='utf-8')
        result = subprocess.run(['bash', '-n', str(script)], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        for required in (
            'flock -w 120 9',
            'occ user:info "$USER_ID"',
            'USER_ROW_COUNT=',
            'pg_dump -U nextcloud -Fc nextcloud',
            'tar -tzf',
            'mv -- "$HOME_DIR" "$QUARANTINE"',
            'cp -a -n -- "$QUARANTINE/." "$HOME_DIR/"',
            'occ files:scan "$USER_ID"',
            'ENCRYPTION_JSON=',
        ):
            self.assertIn(required, source)
        self.assertNotIn('rm -rf', source)
        self.assertNotIn('user:delete', source)
        self.assertNotIn('DROP TABLE', source)

    def test_nextcloud_workflow_only_targets_confirmed_identity(self):
        content = (Path(__file__).resolve().parents[2] / '.github' / 'workflows' / 'nextcloud.yml').read_text()
        self.assertIn('gravitas-nextcloud-rescue-orphan gravitas-u-1190', content)
        self.assertLess(content.index('Recover the confirmed orphaned native identity'),
                        content.index('Install continuous Notes and Deck mirror'))


class VerifyManagedNextcloudDavTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(
            username='verify-native-user', email='verify-native@example.com', password='local-pass',
        )
        self.identity = NextcloudIdentity.objects.create(
            user=user, username=f'gravitas-u-{user.pk}',
            encrypted_password=cloud._encrypt('stable-native-password'),
        )

    @patch('core.management.commands.verify_managed_nextcloud_dav.cloud._request')
    def test_dav_verification_requires_exact_managed_identity(self, request):
        call_command('verify_managed_nextcloud_dav', username=self.identity.username)
        request.assert_called_once()
        args, kwargs = request.call_args
        self.assertEqual(args[0], 'PROPFIND')
        self.assertIn('/remote.php/dav/files/', args[1])
        self.assertEqual(kwargs['auth'], (self.identity.username, 'stable-native-password'))
        self.assertEqual(kwargs['expected'], {207})
        self.assertEqual(kwargs['headers']['Depth'], '0')

    @patch('core.management.commands.verify_managed_nextcloud_dav.cloud._request')
    def test_dav_verification_fails_if_remote_credentials_are_rejected(self, request):
        request.side_effect = cloud.CloudError('Cloud storage returned HTTP 401')
        with self.assertRaises(CommandError):
            call_command('verify_managed_nextcloud_dav', username=self.identity.username)

    def test_missing_or_nonmanaged_identity_is_refused(self):
        for username in ('admin', 'gravitas-u-99999999', 'gravitas-u-1/../../'):
            with self.assertRaises(CommandError):
                call_command('verify_managed_nextcloud_dav', username=username)
