from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from core.models import WorkspaceMembership
from core.platform_runtime_v3 import ensure_platform_workspaces
from core.workspace_api import provision_personal_workspace


class GrantProductionE2ECoreAccessTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='admin@example.com',
            email='admin@example.com',
            password='Admin-Test-Pass-4827!',
            first_name='Core Admin',
        )
        self.core = ensure_platform_workspaces(self.admin)['core']
        self.e2e = User.objects.create_user(
            username='operating-e2e-123456-1@example.com',
            email='operating-e2e-123456-1@example.com',
            password='Operating-E2E-Password-2026!',
            first_name='Operating Production E2E',
        )
        provision_personal_workspace(self.e2e)

    def test_grants_member_access_to_strict_operating_identity(self):
        call_command(
            'grant_production_e2e_core_access',
            self.e2e.email,
            stdout=StringIO(),
        )
        membership = WorkspaceMembership.objects.get(workspace=self.core, user=self.e2e)
        self.assertEqual(membership.role, WorkspaceMembership.Role.MEMBER)

    def test_rejects_non_operating_e2e_email(self):
        User = get_user_model()
        other = User.objects.create_user(
            username='person@example.com',
            email='person@example.com',
            first_name='Operating Production E2E',
        )
        with self.assertRaises(CommandError):
            call_command('grant_production_e2e_core_access', other.email, stdout=StringIO())
        self.assertFalse(WorkspaceMembership.objects.filter(workspace=self.core, user=other).exists())

    def test_rejects_lookalike_name(self):
        User = get_user_model()
        lookalike = User.objects.create_user(
            username='operating-e2e-654321-2@example.com',
            email='operating-e2e-654321-2@example.com',
            first_name='Real Person',
        )
        with self.assertRaises(CommandError):
            call_command('grant_production_e2e_core_access', lookalike.email, stdout=StringIO())
        self.assertFalse(WorkspaceMembership.objects.filter(workspace=self.core, user=lookalike).exists())
