import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured
from django.http import JsonResponse
from django.test import TestCase, override_settings

from . import cloud, nextcloud_bridge
from .layer_access import set_module_grant
from .layer_models import CommunityProfile, ModuleGrant
from .models import NextcloudIdentity, ProjectMembership, ResearchProject
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(
    SECURE_SSL_REDIRECT=False,
    NEXTCLOUD_PUBLIC_URL='https://cloud.example.test',
    PUBLIC_BASE_URL='https://gravitas.example.test',
)
class ResearchNextcloudEntitlementSyncTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='native-admin@example.com',
            email='native-admin@example.com',
            password='test-pass-123',
        )
        self.spaces = ensure_platform_workspaces(self.admin)
        self.user = User.objects.create_user(
            username='native-researcher@example.com',
            email='native-researcher@example.com',
            password='test-pass-123',
        )
        self.project = ResearchProject.objects.create(
            workspace=self.spaces['research'],
            owner=self.admin,
            title='Native entitlement boundary',
        )
        ProjectMembership.objects.create(
            project=self.project,
            user=self.admin,
            role=ProjectMembership.Role.OWNER,
        )
        ProjectMembership.objects.create(
            project=self.project,
            user=self.user,
            role=ProjectMembership.Role.EDITOR,
        )
        CommunityProfile.objects.get_or_create(
            user=self.user,
            defaults={
                'role': CommunityProfile.Role.RESEARCHER,
                'status': CommunityProfile.Status.ACTIVE,
            },
        )

    def _set_research(self, enabled):
        return set_module_grant(
            self.user,
            ModuleGrant.Module.RESEARCH,
            enabled=enabled,
            access_level=ModuleGrant.AccessLevel.PARTICIPATE,
            source=ModuleGrant.Source.ADMIN,
            granted_by=self.admin,
        )

    def test_project_users_respects_module_account_and_community_state(self):
        users = {item.pk for item in nextcloud_bridge.project_users(self.project)}
        self.assertIn(self.user.pk, users)

        self._set_research(False)
        users = {item.pk for item in nextcloud_bridge.project_users(self.project)}
        self.assertNotIn(self.user.pk, users)

        self._set_research(True)
        profile = CommunityProfile.objects.get(user=self.user)
        profile.status = CommunityProfile.Status.SUSPENDED
        profile.save(update_fields=['status', 'updated_at'])
        users = {item.pk for item in nextcloud_bridge.project_users(self.project)}
        self.assertNotIn(self.user.pk, users)

        profile.status = CommunityProfile.Status.ACTIVE
        profile.save(update_fields=['status', 'updated_at'])
        self.user.is_active = False
        self.user.save(update_fields=['is_active'])
        users = {item.pk for item in nextcloud_bridge.project_users(self.project)}
        self.assertNotIn(self.user.pk, users)

    def test_reconcile_removes_suspended_user_from_native_group(self):
        identity = NextcloudIdentity.objects.create(
            user=self.user,
            username='gravitas-native-researcher',
            encrypted_password='not-used-by-this-test',
        )
        self._set_research(False)
        group_id = cloud.project_group_id(self.project)

        with patch('core.nextcloud_bridge.cloud.remove_user_from_group') as remove_group, patch(
            'core.nextcloud_bridge.ensure_project_space'
        ) as ensure_space:
            result = nextcloud_bridge.reconcile_user_research_access(self.user)

        self.assertFalse(result['enabled'])
        self.assertEqual(result['projects'], 1)
        remove_group.assert_called_once_with(identity.username, group_id)
        ensure_space.assert_called_once_with(self.project)

    def test_add_project_user_refuses_explicitly_suspended_research_account(self):
        self._set_research(False)
        with self.assertRaisesMessage(nextcloud_bridge.NextcloudBridgeError, 'research_access_disabled'):
            nextcloud_bridge.add_project_user(self.project, self.user)

    def test_admin_research_suspend_and_reactivate_reconcile_native_access(self):
        self.client.force_login(self.admin)
        url = f'/api/platform/admin/users/{self.user.pk}/'

        with patch('core.layer_admin_api.nextcloud_bridge.reconcile_user_research_access') as reconcile:
            suspended = self.client.patch(
                url,
                data=json.dumps({
                    'modules': {
                        'research': {
                            'enabled': False,
                            'access_level': 'participate',
                        }
                    }
                }),
                content_type='application/json',
            )
        self.assertEqual(suspended.status_code, 200, suspended.content)
        grant = ModuleGrant.objects.get(user=self.user, module=ModuleGrant.Module.RESEARCH)
        self.assertFalse(grant.enabled)
        reconcile.assert_called_once_with(self.user)

        with patch('core.layer_admin_api.nextcloud_bridge.reconcile_user_research_access') as reconcile:
            restored = self.client.patch(
                url,
                data=json.dumps({
                    'modules': {
                        'research': {
                            'enabled': True,
                            'access_level': 'participate',
                        }
                    }
                }),
                content_type='application/json',
            )
        self.assertEqual(restored.status_code, 200, restored.content)
        grant.refresh_from_db()
        self.assertTrue(grant.enabled)
        reconcile.assert_called_once_with(self.user)

    def test_admin_community_or_account_suspension_reconciles_native_access(self):
        self.client.force_login(self.admin)
        url = f'/api/platform/admin/users/{self.user.pk}/'

        with patch('core.layer_admin_api.nextcloud_bridge.reconcile_user_research_access') as reconcile:
            response = self.client.patch(
                url,
                data=json.dumps({'community_status': CommunityProfile.Status.SUSPENDED}),
                content_type='application/json',
            )
        self.assertEqual(response.status_code, 200, response.content)
        reconcile.assert_called_once_with(self.user)

        # Restore the community state first, then make the Django account
        # inactive. Both transitions are native entitlement boundaries.
        profile = CommunityProfile.objects.get(user=self.user)
        profile.status = CommunityProfile.Status.ACTIVE
        profile.save(update_fields=['status', 'updated_at'])
        with patch('core.layer_admin_api.nextcloud_bridge.reconcile_user_research_access') as reconcile:
            response = self.client.patch(
                url,
                data=json.dumps({'account_active': False}),
                content_type='application/json',
            )
        self.assertEqual(response.status_code, 200, response.content)
        reconcile.assert_called_once_with(self.user)

    def test_native_sync_failure_rolls_back_research_grant(self):
        self._set_research(True)
        self.client.force_login(self.admin)
        url = f'/api/platform/admin/users/{self.user.pk}/'

        with patch(
            'core.layer_admin_api.nextcloud_bridge.reconcile_user_research_access',
            side_effect=cloud.CloudError('native unavailable'),
        ) as reconcile:
            response = self.client.patch(
                url,
                data=json.dumps({
                    'modules': {
                        'research': {'enabled': False, 'access_level': 'participate'}
                    }
                }),
                content_type='application/json',
            )

        self.assertEqual(response.status_code, 503, response.content)
        self.assertEqual(response.json()['error'], 'nextcloud_research_sync_failed')
        grant = ModuleGrant.objects.get(user=self.user, module=ModuleGrant.Module.RESEARCH)
        self.assertTrue(grant.enabled)
        # First attempt failed inside the transaction; the second call is the
        # compensation pass after the DB transaction restored the old grant.
        self.assertEqual(reconcile.call_count, 2)

    def test_unconfigured_nextcloud_does_not_block_local_admin_change(self):
        self._set_research(True)
        self.client.force_login(self.admin)
        url = f'/api/platform/admin/users/{self.user.pk}/'
        with patch(
            'core.layer_admin_api.nextcloud_bridge.reconcile_user_research_access',
            side_effect=ImproperlyConfigured('Nextcloud disabled'),
        ):
            response = self.client.patch(
                url,
                data=json.dumps({
                    'modules': {
                        'research': {'enabled': False, 'access_level': 'participate'}
                    }
                }),
                content_type='application/json',
            )
        self.assertEqual(response.status_code, 200, response.content)
        grant = ModuleGrant.objects.get(user=self.user, module=ModuleGrant.Module.RESEARCH)
        self.assertFalse(grant.enabled)

    def test_nextcloud_status_hides_projects_for_suspended_research_user(self):
        self._set_research(False)
        self.client.force_login(self.user)
        base_payload = {
            'ok': True,
            'nextcloud': {'url': 'https://gravitas.example.test/nextcloud/'},
            'projects': [{'id': self.project.pk, 'title': self.project.title}],
        }
        with patch(
            'core.nextcloud_public_api.nextcloud_api.nextcloud_status',
            return_value=JsonResponse(base_payload),
        ):
            response = self.client.get('/api/platform/nextcloud/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['projects'], [])

    def test_nextcloud_status_preserves_projects_for_core_control_plane(self):
        self.client.force_login(self.admin)
        base_payload = {
            'ok': True,
            'nextcloud': {'url': 'https://gravitas.example.test/nextcloud/'},
            'projects': [{'id': self.project.pk, 'title': self.project.title}],
        }
        with patch(
            'core.nextcloud_public_api.nextcloud_api.nextcloud_status',
            return_value=JsonResponse(base_payload),
        ):
            response = self.client.get('/api/platform/nextcloud/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()['projects']), 1)
