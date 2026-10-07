import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import KnowledgeResource, NextcloudIdentity, StoragePlan, WorkspaceMembership
from .workspace_api import provision_personal_workspace


@override_settings(
    GRAVITAS_DEFAULT_QUOTA_BYTES=5 * 1024 ** 3,
    GRAVITAS_MAX_UPLOAD_BYTES=250 * 1024 ** 2,
    SECURE_SSL_REDIRECT=False,
)
class TeamStorageApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='storage-admin@example.com',
            email='storage-admin@example.com',
            password='Storage-Admin-Test-4827!',
            first_name='Storage Admin',
        )
        self.user = User.objects.create_user(
            username='storage-user@example.com',
            email='storage-user@example.com',
            password='Storage-User-Test-7194!',
            first_name='Storage User',
        )
        self.client.force_login(self.admin)
        bootstrap = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(bootstrap.status_code, 200, bootstrap.content)
        self.core_id = bootstrap.json()['workspaces']['core']['id']

    def patch_json(self, url, payload):
        return self.client.patch(url, data=json.dumps(payload), content_type='application/json')

    def test_admin_can_list_per_user_storage(self):
        response = self.client.get('/api/platform/team/storage/')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        row = next(item for item in data['users'] if item['user_id'] == self.user.pk)
        self.assertEqual(row['quota_bytes'], 5 * 1024 ** 3)
        self.assertEqual(row['used_bytes'], 0)
        self.assertFalse(row['nextcloud']['provisioned'])
        self.assertEqual(data['max_upload_bytes'], 250 * 1024 ** 2)

    def test_core_member_cannot_manage_storage(self):
        WorkspaceMembership.objects.create(
            workspace_id=self.core_id,
            user=self.user,
            role=WorkspaceMembership.Role.MEMBER,
        )
        self.client.force_login(self.user)
        response = self.client.get('/api/platform/team/storage/')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error'], 'core_admin_required')

    def test_admin_can_change_quota_and_nextcloud_is_updated(self):
        StoragePlan.objects.update_or_create(
            user=self.user,
            defaults={'tier': 'free', 'quota_bytes': 5 * 1024 ** 3},
        )
        NextcloudIdentity.objects.create(
            user=self.user,
            username=f'gravitas-u-{self.user.pk}',
            encrypted_password='test-only',
        )
        new_quota = 20 * 1024 ** 3
        with patch('core.team_storage_api.cloud.set_quota') as set_quota:
            response = self.patch_json(
                f'/api/platform/team/{self.user.pk}/storage/',
                {'quota_bytes': new_quota},
            )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['storage']['quota_bytes'], new_quota)
        self.assertTrue(response.json()['storage']['nextcloud']['provisioned'])
        set_quota.assert_called_once()
        self.assertEqual(StoragePlan.objects.get(user=self.user).quota_bytes, new_quota)

    def test_quota_cannot_be_lower_than_existing_usage(self):
        workspace = provision_personal_workspace(self.user)
        KnowledgeResource.objects.create(
            workspace=workspace,
            owner=self.user,
            kind=KnowledgeResource.Kind.FILE,
            title='Large dataset',
            original_name='large.bin',
            file_size=2 * 1024 ** 3,
        )
        response = self.patch_json(
            f'/api/platform/team/{self.user.pk}/storage/',
            {'quota_bytes': 1024 ** 3},
        )
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()['error'], 'quota_below_usage')
