from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import WorkspaceMembership
from .platform_runtime_v3 import ensure_platform_workspaces
from .workspace_api import provision_personal_workspace


@override_settings(SECURE_SSL_REDIRECT=False)
class RegisteredUserAccessQueueTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='admin@example.com',
            email='admin@example.com',
            password='Admin-Test-Pass-4827!',
            first_name='Core Admin',
        )
        self.spaces = ensure_platform_workspaces(self.admin)
        self.client.force_login(self.admin)

        self.signup = User.objects.create_user(
            username='new-signup@example.com',
            email='new-signup@example.com',
            password='Signup-Test-Pass-4827!',
            first_name='New Signup',
        )
        provision_personal_workspace(self.signup)

    def test_plain_signup_appears_in_registered_users_queue(self):
        response = self.client.get('/api/platform/team/')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        ids = {item['id'] for item in data['registered_users']}
        self.assertIn(self.signup.pk, ids)
        self.assertEqual(data['counts']['registered_users'], 1)
        self.assertNotIn(self.signup.pk, {item['id'] for item in data['members']})
        self.assertNotIn(self.signup.pk, {item['id'] for item in data['researchers']})

    def test_adding_registered_user_to_core_removes_it_from_queue(self):
        response = self.client.post(
            '/api/platform/team/',
            data='{"name":"New Signup","email":"new-signup@example.com","role":"member","send_setup":false}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(WorkspaceMembership.objects.filter(
            workspace=self.spaces['core'], user=self.signup, role='member'
        ).exists())

        data = self.client.get('/api/platform/team/').json()
        self.assertNotIn(self.signup.pk, {item['id'] for item in data['registered_users']})
        self.assertIn(self.signup.pk, {item['id'] for item in data['members']})

    def test_superusers_are_not_exposed_as_pending_regular_accounts(self):
        User = get_user_model()
        hidden = User.objects.create_superuser(
            username='hidden-root@example.com',
            email='hidden-root@example.com',
            password='Root-Test-Pass-4827!',
        )
        data = self.client.get('/api/platform/team/').json()
        self.assertNotIn(hidden.pk, {item['id'] for item in data['registered_users']})
