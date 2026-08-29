from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase


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

    def test_dry_run_deletes_nothing(self):
        call_command('cleanup_production_e2e_users', scope='all', dry_run=True, stdout=StringIO())
        User = get_user_model()
        self.assertTrue(User.objects.filter(pk=self.auth_user.pk).exists())
        self.assertTrue(User.objects.filter(pk=self.workspace_user.pk).exists())
