import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import WorkspaceMembership


@override_settings(
    GRAVITAS_DEFAULT_QUOTA_BYTES=1024 * 1024 * 100,
    GRAVITAS_MAX_UPLOAD_BYTES=1024 * 1024 * 10,
    SECURE_SSL_REDIRECT=False,
    PUBLIC_BASE_URL='https://gravitas.test',
)
class CoreTeamApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='admin@example.com',
            email='admin@example.com',
            password='Admin-Test-Pass-4827!',
            first_name='Core Admin',
        )
        self.researcher = User.objects.create_user(
            username='researcher@example.com',
            email='researcher@example.com',
            password='Research-Test-Pass-7194!',
            first_name='External Researcher',
        )
        self.client.force_login(self.admin)
        response = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(response.status_code, 200, response.content)
        self.core_id = response.json()['workspaces']['core']['id']
        self.assertEqual(response.json()['access']['core_role'], 'admin')

    def post_json(self, url, payload):
        return self.client.post(url, data=json.dumps(payload), content_type='application/json')

    def patch_json(self, url, payload):
        return self.client.patch(url, data=json.dumps(payload), content_type='application/json')

    def test_core_admin_can_list_team(self):
        response = self.client.get('/api/platform/team/')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data['viewer']['role'], 'admin')
        self.assertEqual(data['counts']['core_members'], 1)
        self.assertEqual(data['members'][0]['id'], self.admin.pk)
        self.assertEqual(data['members'][0]['role'], 'admin')

    def test_external_researcher_cannot_manage_team(self):
        self.client.force_login(self.researcher)
        self.client.get('/api/platform/bootstrap/')
        response = self.client.get('/api/platform/team/')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error'], 'core_admin_required')

    def test_core_member_cannot_manage_team(self):
        WorkspaceMembership.objects.create(
            workspace_id=self.core_id,
            user=self.researcher,
            role=WorkspaceMembership.Role.MEMBER,
        )
        self.client.force_login(self.researcher)
        response = self.client.get('/api/platform/team/')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error'], 'core_admin_required')

    def test_admin_can_create_member_and_existing_account_is_reused(self):
        response = self.post_json('/api/platform/team/', {
            'name': 'New Member',
            'email': 'new-member@example.com',
            'role': 'member',
            'password': 'Member-Temp-Pass-4827!',
            'send_setup': False,
        })
        self.assertEqual(response.status_code, 201, response.content)
        User = get_user_model()
        user = User.objects.get(email='new-member@example.com')
        self.assertTrue(user.check_password('Member-Temp-Pass-4827!'))
        self.assertTrue(WorkspaceMembership.objects.filter(
            workspace_id=self.core_id, user=user, role='member'
        ).exists())

        existing_count = User.objects.count()
        response = self.post_json('/api/platform/team/', {
            'name': 'External Researcher Promoted',
            'email': self.researcher.email,
            'role': 'member',
            'send_setup': False,
        })
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(User.objects.count(), existing_count)
        self.assertTrue(WorkspaceMembership.objects.filter(
            workspace_id=self.core_id, user=self.researcher
        ).exists())

    def test_admin_can_edit_role_and_account_state(self):
        membership = WorkspaceMembership.objects.create(
            workspace_id=self.core_id,
            user=self.researcher,
            role=WorkspaceMembership.Role.MEMBER,
        )
        response = self.patch_json(f'/api/platform/team/{self.researcher.pk}/', {
            'name': 'Research Lead',
            'email': 'lead@example.com',
            'role': 'admin',
            'is_active': True,
        })
        self.assertEqual(response.status_code, 200, response.content)
        membership.refresh_from_db()
        self.researcher.refresh_from_db()
        self.assertEqual(membership.role, 'admin')
        self.assertEqual(self.researcher.email, 'lead@example.com')
        self.assertEqual(self.researcher.username, 'lead@example.com')
        self.assertEqual(self.researcher.first_name, 'Research Lead')

        response = self.patch_json(f'/api/platform/team/{self.researcher.pk}/', {
            'name': 'Research Lead',
            'email': 'lead@example.com',
            'role': 'admin',
            'is_active': False,
        })
        self.assertEqual(response.status_code, 200, response.content)
        self.researcher.refresh_from_db()
        self.assertFalse(self.researcher.is_active)

    def test_remove_from_core_preserves_user_account(self):
        WorkspaceMembership.objects.create(
            workspace_id=self.core_id,
            user=self.researcher,
            role=WorkspaceMembership.Role.MEMBER,
        )
        response = self.client.delete(
            f'/api/platform/team/{self.researcher.pk}/',
            data='{}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(WorkspaceMembership.objects.filter(
            workspace_id=self.core_id, user=self.researcher
        ).exists())
        self.assertTrue(get_user_model().objects.filter(pk=self.researcher.pk).exists())

    def test_admin_cannot_remove_own_core_access(self):
        response = self.client.delete(
            f'/api/platform/team/{self.admin.pk}/',
            data='{}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'cannot_remove_your_own_admin_access')
        self.assertTrue(WorkspaceMembership.objects.filter(
            workspace_id=self.core_id, user=self.admin, role='admin'
        ).exists())

    def test_last_admin_cannot_be_demoted_or_deactivated(self):
        response = self.patch_json(f'/api/platform/team/{self.admin.pk}/', {
            'name': self.admin.first_name,
            'email': self.admin.email,
            'role': 'member',
            'is_active': True,
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'cannot_remove_your_own_admin_access')

        response = self.patch_json(f'/api/platform/team/{self.admin.pk}/', {
            'name': self.admin.first_name,
            'email': self.admin.email,
            'role': 'admin',
            'is_active': False,
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'cannot_remove_your_own_admin_access')

    def test_admin_can_set_temporary_password(self):
        WorkspaceMembership.objects.create(
            workspace_id=self.core_id,
            user=self.researcher,
            role=WorkspaceMembership.Role.MEMBER,
        )
        response = self.post_json(f'/api/platform/team/{self.researcher.pk}/password-reset/', {
            'mode': 'temporary',
            'password': 'Fresh-Temporary-Pass-9372!',
        })
        self.assertEqual(response.status_code, 200, response.content)
        self.researcher.refresh_from_db()
        self.assertTrue(self.researcher.check_password('Fresh-Temporary-Pass-9372!'))

    @patch('core.team_api._send_password_setup')
    def test_admin_can_send_password_reset_email(self, send_password_setup):
        WorkspaceMembership.objects.create(
            workspace_id=self.core_id,
            user=self.researcher,
            role=WorkspaceMembership.Role.MEMBER,
        )
        response = self.post_json(f'/api/platform/team/{self.researcher.pk}/password-reset/', {
            'mode': 'email',
        })
        self.assertEqual(response.status_code, 200, response.content)
        send_password_setup.assert_called_once_with(self.researcher)
