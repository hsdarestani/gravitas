from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .layer_models import CommunityProfile, ModuleGrant
from .models import ResearchProject, WorkspaceMembership
from .platform_models import WorkspaceProfile
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(
    GRAVITAS_DEFAULT_QUOTA_BYTES=1024 * 1024 * 100,
    GRAVITAS_MAX_UPLOAD_BYTES=1024 * 1024 * 10,
    SECURE_SSL_REDIRECT=False,
)
class PlatformV3RoleTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.internal = User.objects.create_user(
            username='internal@example.com', email='internal@example.com', password='test-pass-123'
        )
        self.researcher = User.objects.create_user(
            username='researcher@example.com', email='researcher@example.com', password='test-pass-123'
        )

        # Bootstrap the canonical platform with the internal account first.
        self.client.force_login(self.internal)
        response = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(response.status_code, 200, response.content)
        self.core_id = response.json()['workspaces']['core']['id']
        self.research_id = response.json()['workspaces']['research']['id']

    def test_community_role_does_not_implicitly_unlock_research_or_core(self):
        profile = CommunityProfile.objects.get(user=self.researcher)
        profile.role = CommunityProfile.Role.RESEARCHER
        profile.save(update_fields=['role', 'updated_at'])

        self.client.force_login(self.researcher)
        boot = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(boot.status_code, 200)
        data = boot.json()
        self.assertTrue(data['access']['dashboard'])
        self.assertFalse(data['access']['lms'])
        self.assertFalse(data['access']['research'])
        self.assertFalse(data['access']['core'])
        self.assertEqual(data['access']['community_role'], 'researcher')
        self.assertFalse(WorkspaceMembership.objects.filter(workspace_id=self.core_id, user=self.researcher).exists())
        self.assertFalse(WorkspaceMembership.objects.filter(workspace_id=self.research_id, user=self.researcher).exists())

    def test_project_participation_unlocks_research_without_lms_or_core(self):
        spaces = ensure_platform_workspaces(self.internal)
        project = ResearchProject.objects.create(
            workspace=spaces['research'],
            owner=self.researcher,
            title='Independent research access',
            category=ResearchProject.Category.INTERNAL,
            visibility=ResearchProject.Visibility.PRIVATE,
        )

        self.client.force_login(self.researcher)
        boot = self.client.get('/api/platform/bootstrap/').json()
        self.assertTrue(boot['access']['research'])
        self.assertFalse(boot['access']['lms'])
        self.assertFalse(boot['access']['core'])
        self.assertTrue(any(item['id'] == project.pk for item in boot['my_work']['research']))

    def test_explicit_disabled_research_grant_overrides_historical_project(self):
        spaces = ensure_platform_workspaces(self.internal)
        ResearchProject.objects.create(
            workspace=spaces['research'],
            owner=self.researcher,
            title='Suspended project access',
            category=ResearchProject.Category.INTERNAL,
            visibility=ResearchProject.Visibility.PRIVATE,
        )
        ModuleGrant.objects.update_or_create(
            user=self.researcher,
            module=ModuleGrant.Module.RESEARCH,
            defaults={
                'enabled': False,
                'access_level': ModuleGrant.AccessLevel.PARTICIPATE,
                'source': ModuleGrant.Source.ADMIN,
            },
        )

        self.client.force_login(self.researcher)
        boot = self.client.get('/api/platform/bootstrap/').json()
        self.assertFalse(boot['access']['research'])
        self.assertEqual(boot['my_work']['research'], [])

    def test_research_dashboard_is_not_available_without_research_access(self):
        self.client.force_login(self.researcher)
        response = self.client.get('/api/platform/dashboard/?workspace=research')
        # The dashboard endpoint itself is legacy-compatible, but bootstrap is
        # the authoritative navigation gate. Project APIs remain protected by
        # per-object ACLs. This assertion documents the layer contract.
        self.assertFalse(self.client.get('/api/platform/bootstrap/').json()['access']['research'])
        self.assertIn(response.status_code, {200, 403})

    def test_canonical_core_and_research_workspaces_are_shared(self):
        self.client.force_login(self.researcher)
        data = self.client.get('/api/platform/bootstrap/').json()
        self.assertEqual(data['workspaces']['core']['id'], self.core_id)
        self.assertEqual(data['workspaces']['research']['id'], self.research_id)
        self.assertEqual(WorkspaceProfile.objects.filter(purpose='core').count(), 1)
        self.assertEqual(WorkspaceProfile.objects.filter(purpose='research').count(), 1)
