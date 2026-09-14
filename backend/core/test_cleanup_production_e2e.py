from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from core import cloud
from core.models import NextcloudIdentity, Organization, Workspace
from core.operating_models import StrategicObjective
from core.workspace_api import provision_personal_workspace


class CleanupProductionE2EUsersTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.auth_user = User.objects.create_user(
            username='auth-e2e-123456@example.com',
            email='auth-e2e-123456@example.com',
            first_name='Production E2E',
        )
        self.browser_user = User.objects.create_user(
            username='browser-e2e-123456-1@example.com',
            email='browser-e2e-123456-1@example.com',
            first_name='Browser Production E2E',
        )
        self.workspace_user = User.objects.create_user(
            username='workspace-a-123456@example.com',
            email='workspace-a-123456@example.com',
            first_name='Workspace E2E',
        )
        self.operating_user = User.objects.create_user(
            username='operating-e2e-123456-1@example.com',
            email='operating-e2e-123456-1@example.com',
            first_name='Operating Production E2E',
        )
        self.lookalike = User.objects.create_user(
            username='auth-e2e-999@example.com',
            email='auth-e2e-999@example.com',
            first_name='Real Person',
        )
        self.real = User.objects.create_user(
            username='person@example.com',
            email='person@example.com',
            first_name='Production E2E',
        )

    def test_scope_only_deletes_matching_test_family(self):
        out = StringIO()
        call_command('cleanup_production_e2e_users', scope='auth', stdout=out)
        User = get_user_model()
        self.assertFalse(User.objects.filter(pk=self.auth_user.pk).exists())
        self.assertFalse(User.objects.filter(pk=self.browser_user.pk).exists())
        self.assertTrue(User.objects.filter(pk=self.workspace_user.pk).exists())
        self.assertTrue(User.objects.filter(pk=self.operating_user.pk).exists())
        self.assertTrue(User.objects.filter(pk=self.lookalike.pk).exists())
        self.assertTrue(User.objects.filter(pk=self.real.pk).exists())
        self.assertIn('deleted=2', out.getvalue())

    def test_all_scope_deletes_only_strict_e2e_patterns(self):
        call_command('cleanup_production_e2e_users', scope='all', stdout=StringIO())
        User = get_user_model()
        for user in (self.auth_user, self.browser_user, self.workspace_user, self.operating_user):
            self.assertFalse(User.objects.filter(pk=user.pk).exists())
        self.assertTrue(User.objects.filter(pk=self.lookalike.pk).exists())
        self.assertTrue(User.objects.filter(pk=self.real.pk).exists())

    def test_operating_scope_removes_protected_owned_data_and_personal_workspace(self):
        personal = provision_personal_workspace(self.operating_user)
        org = Organization.objects.create(name='Cleanup Test Org', slug='cleanup-test-org', created_by=self.real)
        team = Workspace.objects.create(name='Cleanup Test Core', kind=Workspace.Kind.TEAM, organization=org)
        objective = StrategicObjective.objects.create(
            workspace=team,
            title='Production traceability objective',
            owner=self.operating_user,
            quarter='E2E',
        )

        call_command('cleanup_production_e2e_users', scope='operating', stdout=StringIO())

        User = get_user_model()
        self.assertFalse(User.objects.filter(pk=self.operating_user.pk).exists())
        self.assertFalse(Workspace.objects.filter(pk=personal.pk).exists())
        self.assertFalse(StrategicObjective.objects.filter(pk=objective.pk).exists())
        self.assertTrue(Workspace.objects.filter(pk=team.pk).exists())

    def test_nextcloud_identity_is_deleted_before_test_user(self):
        identity = NextcloudIdentity.objects.create(
            user=self.workspace_user,
            username=f'gravitas-u-{self.workspace_user.pk}',
            encrypted_password='test-ciphertext',
        )

        with patch('core.management.commands.cleanup_production_e2e_users.cloud.delete_identity') as delete_identity:
            call_command('cleanup_production_e2e_users', scope='workspace', stdout=StringIO())

        delete_identity.assert_called_once()
        self.assertEqual(delete_identity.call_args.args[0].pk, identity.pk)
        self.assertFalse(get_user_model().objects.filter(pk=self.workspace_user.pk).exists())

    def test_already_absent_nextcloud_identity_allows_local_cleanup(self):
        NextcloudIdentity.objects.create(
            user=self.workspace_user,
            username=f'gravitas-u-{self.workspace_user.pk}',
            encrypted_password='test-ciphertext',
        )
        out = StringIO()

        with patch(
            'core.management.commands.cleanup_production_e2e_users.cloud.delete_identity',
            side_effect=cloud.CloudError('Could not delete cloud identity'),
        ), patch(
            'core.management.commands.cleanup_production_e2e_users._nextcloud_identity_state',
            return_value=('missing', 'OCS 998: The requested user could not be found'),
        ):
            call_command('cleanup_production_e2e_users', scope='workspace', stdout=out)

        self.assertFalse(get_user_model().objects.filter(pk=self.workspace_user.pk).exists())
        self.assertIn('Nextcloud identity already absent', out.getvalue())
        self.assertIn('deleted=1', out.getvalue())

    def test_nextcloud_failure_preserves_user_reports_cause_and_continues(self):
        NextcloudIdentity.objects.create(
            user=self.workspace_user,
            username=f'gravitas-u-{self.workspace_user.pk}',
            encrypted_password='test-ciphertext',
        )
        second = get_user_model().objects.create_user(
            username='workspace-b-654321@example.com',
            email='workspace-b-654321@example.com',
            first_name='Workspace E2E',
        )
        err = StringIO()

        def delete_identity(identity):
            if identity.user_id == self.workspace_user.pk:
                raise cloud.CloudError('Cloud storage returned HTTP 500')

        # Give the second test user an identity as well so the command proves a
        # failed first deletion does not prevent later cloud cleanup.
        NextcloudIdentity.objects.create(
            user=second,
            username=f'gravitas-u-{second.pk}',
            encrypted_password='test-ciphertext',
        )

        with patch(
            'core.management.commands.cleanup_production_e2e_users.cloud.delete_identity',
            side_effect=delete_identity,
        ):
            with self.assertRaises(CommandError) as raised:
                call_command('cleanup_production_e2e_users', scope='workspace', stdout=StringIO(), stderr=err)

        self.assertIn('Cloud storage returned HTTP 500', str(raised.exception))
        self.assertIn('failures=1', str(raised.exception))
        self.assertTrue(get_user_model().objects.filter(pk=self.workspace_user.pk).exists())
        self.assertFalse(get_user_model().objects.filter(pk=second.pk).exists())

    def test_dry_run_deletes_nothing(self):
        call_command('cleanup_production_e2e_users', scope='all', dry_run=True, stdout=StringIO())
        User = get_user_model()
        self.assertTrue(User.objects.filter(pk=self.auth_user.pk).exists())
        self.assertTrue(User.objects.filter(pk=self.workspace_user.pk).exists())
