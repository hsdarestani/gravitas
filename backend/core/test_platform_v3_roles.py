from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import WorkspaceMembership
from .platform_models import WorkspaceProfile


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

    def test_researcher_does_not_receive_core_workspace(self):
        self.client.force_login(self.internal)
        internal_boot = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(internal_boot.status_code, 200)
        internal_data = internal_boot.json()
        core_id = internal_data['workspaces']['core']['id']
        research_id = internal_data['workspaces']['research']['id']
        self.assertTrue(internal_data['access']['core'])
        self.assertTrue(WorkspaceMembership.objects.filter(workspace_id=core_id, user=self.internal).exists())

        self.client.force_login(self.researcher)
        researcher_boot = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(researcher_boot.status_code, 200)
        researcher_data = researcher_boot.json()
        self.assertFalse(researcher_data['access']['core'])
        self.assertTrue(researcher_data['access']['research'])
        self.assertEqual(researcher_data['workspaces']['core']['id'], core_id)
        self.assertEqual(researcher_data['workspaces']['research']['id'], research_id)
        self.assertFalse(WorkspaceMembership.objects.filter(workspace_id=core_id, user=self.researcher).exists())
        self.assertFalse(WorkspaceMembership.objects.filter(workspace_id=research_id, user=self.researcher).exists())

        # V3 keeps one canonical pair instead of creating a Core/Research pair per user.
        self.assertEqual(WorkspaceProfile.objects.filter(purpose='core').count(), 1)
        self.assertEqual(WorkspaceProfile.objects.filter(purpose='research').count(), 1)

    def test_external_researcher_can_use_research_but_not_core(self):
        self.client.force_login(self.internal)
        self.client.get('/api/platform/bootstrap/')

        self.client.force_login(self.researcher)
        response = self.client.get('/api/platform/dashboard/?workspace=core')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error'], 'core_workspace_for_internal_team_only')

        response = self.client.post(
            '/api/platform/content/',
            data='{"title":"Should not exist"}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

        response = self.client.get('/api/platform/dashboard/?workspace=research')
        self.assertEqual(response.status_code, 200, response.content)

        response = self.client.post(
            '/api/platform/projects/',
            data='{"title":"External researcher project","category":"internal","visibility":"private"}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(
            response.json()['project']['workspace_id'],
            self.client.get('/api/platform/bootstrap/').json()['workspaces']['research']['id'],
        )
