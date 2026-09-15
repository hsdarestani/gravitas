from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .layer_access import module_access, set_module_grant
from .layer_models import ModuleGrant
from .models import ResearchProject, WorkspaceMembership
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(
    GRAVITAS_DEFAULT_QUOTA_BYTES=1024 * 1024 * 100,
    GRAVITAS_MAX_UPLOAD_BYTES=1024 * 1024 * 10,
    SECURE_SSL_REDIRECT=False,
)
class ExistingAccountBootstrapTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='existing-admin@example.com',
            email='existing-admin@example.com',
            password='test-pass-123',
        )
        self.member = User.objects.create_user(
            username='existing-member@example.com',
            email='existing-member@example.com',
            password='test-pass-123',
        )

        # The first bootstrap creates the canonical Core membership for the
        # internal administrator, matching an existing production team account.
        self.client.force_login(self.admin)
        response = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(response.status_code, 200, response.content)
        self.spaces = ensure_platform_workspaces(self.admin)

    def test_core_member_inherits_lms_and_research_layers(self):
        self.assertFalse(
            ModuleGrant.objects.filter(
                user=self.admin,
                module__in=[ModuleGrant.Module.LMS, ModuleGrant.Module.RESEARCH],
            ).exists()
        )
        self.assertTrue(module_access(self.admin, ModuleGrant.Module.CORE))
        self.assertTrue(module_access(self.admin, ModuleGrant.Module.LMS))
        self.assertTrue(module_access(self.admin, ModuleGrant.Module.RESEARCH))

        data = self.client.get('/api/platform/bootstrap/').json()
        self.assertTrue(data['layers']['3']['enabled'])
        self.assertTrue(data['layers']['4']['enabled'])
        self.assertTrue(data['layers']['5']['enabled'])
        self.assertTrue(data['access']['lms'])

    def test_explicit_lms_suspension_still_wins_for_core_member(self):
        set_module_grant(
            self.admin,
            ModuleGrant.Module.LMS,
            enabled=False,
            source=ModuleGrant.Source.ADMIN,
        )
        self.assertFalse(module_access(self.admin, ModuleGrant.Module.LMS))
        self.assertTrue(module_access(self.admin, ModuleGrant.Module.RESEARCH))
        self.assertTrue(module_access(self.admin, ModuleGrant.Module.CORE))

    def test_optional_research_summary_failure_does_not_break_bootstrap(self):
        ResearchProject.objects.create(
            workspace=self.spaces['research'],
            owner=self.admin,
            title='Legacy production research row',
        )

        with patch('core.platform_runtime_v3.can_view', side_effect=RuntimeError('legacy summary row')):
            response = self.client.get('/api/platform/bootstrap/')

        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data['ok'])
        self.assertTrue(data['access']['core'])
        self.assertTrue(data['access']['research'])
        self.assertTrue(data['access']['lms'])
        self.assertIn('research_summary_unavailable', data['warnings'])
        self.assertIn('research', data['workspaces'])

    def test_bootstrap_does_not_mutate_shared_research_memberships(self):
        legacy = WorkspaceMembership.objects.create(
            workspace=self.spaces['research'],
            user=self.member,
            role=WorkspaceMembership.Role.MEMBER,
        )

        self.client.force_login(self.admin)
        response = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(WorkspaceMembership.objects.filter(pk=legacy.pk).exists())
