import json
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured
from django.test import TestCase, override_settings
from django.utils import timezone

from . import cloud
from .layer_access import set_module_grant
from .layer_models import ModuleGrant
from .models import KnowledgeResource, ProjectMembership, ResearchProject
from .platform_access import content_type_for, grant_role, policy_for
from .platform_models import AccessGrant, ObjectPolicy, ShareLink
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(
    SECURE_SSL_REDIRECT=False,
    GRAVITAS_DEFAULT_QUOTA_BYTES=100 * 1024 * 1024,
    GRAVITAS_MAX_UPLOAD_BYTES=10 * 1024 * 1024,
)
class SharingConsistencyApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            username='share-owner@example.com',
            email='share-owner@example.com',
            password='test-pass-123',
        )
        self.member = User.objects.create_user(
            username='share-member@example.com',
            email='share-member@example.com',
            password='test-pass-123',
        )
        self.other = User.objects.create_user(
            username='share-other@example.com',
            email='share-other@example.com',
            password='test-pass-123',
        )
        self.spaces = ensure_platform_workspaces(self.owner)
        self.project = ResearchProject.objects.create(
            workspace=self.spaces['research'],
            owner=self.owner,
            title='Sharing consistency project',
        )
        ProjectMembership.objects.create(
            project=self.project,
            user=self.owner,
            role=ProjectMembership.Role.OWNER,
        )
        self.resource = KnowledgeResource.objects.create(
            workspace=self.project.workspace,
            project=self.project,
            owner=self.owner,
            kind=KnowledgeResource.Kind.NOTE,
            title='Project note',
            body='Evidence.',
        )
        self.client.force_login(self.owner)

    def post_share(self, payload):
        return self.client.post(
            '/api/platform/share/',
            data=json.dumps(payload),
            content_type='application/json',
        )

    def delete_share(self, payload):
        return self.client.delete(
            '/api/platform/share/',
            data=json.dumps(payload),
            content_type='application/json',
        )

    @patch('core.sharing_consistency_api._native_add')
    def test_failed_project_grant_restores_preexisting_membership_and_grant(self, native_add):
        ProjectMembership.objects.create(
            project=self.project,
            user=self.member,
            role=ProjectMembership.Role.VIEWER,
        )
        existing = grant_role(self.project, self.member, 'view', granted_by=self.owner)
        native_add.side_effect = cloud.CloudError('native add failed')

        response = self.post_share({
            'type': 'project',
            'id': self.project.pk,
            'action': 'grant',
            'email': self.member.email,
            'role': 'edit',
        })
        self.assertEqual(response.status_code, 503, response.content)
        self.assertEqual(
            ProjectMembership.objects.get(project=self.project, user=self.member).role,
            ProjectMembership.Role.VIEWER,
        )
        existing.refresh_from_db()
        self.assertEqual(existing.role, 'view')

    @patch('core.sharing_consistency_api._native_remove')
    def test_failed_project_revoke_rolls_back_local_revocation(self, native_remove):
        ProjectMembership.objects.create(
            project=self.project,
            user=self.member,
            role=ProjectMembership.Role.EDITOR,
        )
        grant = grant_role(self.project, self.member, 'edit', granted_by=self.owner)
        native_remove.side_effect = cloud.CloudError('native remove failed')

        response = self.delete_share({
            'type': 'project',
            'id': self.project.pk,
            'action': 'revoke',
            'grant_id': grant.pk,
        })
        self.assertEqual(response.status_code, 503, response.content)
        self.assertTrue(ProjectMembership.objects.filter(project=self.project, user=self.member).exists())
        self.assertTrue(AccessGrant.objects.filter(pk=grant.pk, role='edit').exists())

    def test_project_grant_with_expiry_is_rejected_instead_of_becoming_permanent(self):
        response = self.post_share({
            'type': 'project',
            'id': self.project.pk,
            'action': 'grant',
            'email': self.member.email,
            'role': 'view',
            'expires_at': (timezone.now() + timedelta(hours=2)).isoformat(),
        })
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()['error'], 'project_access_expiry_not_supported')
        self.assertFalse(ProjectMembership.objects.filter(project=self.project, user=self.member).exists())
        self.assertFalse(AccessGrant.objects.filter(
            content_type=content_type_for(self.project),
            object_id=self.project.pk,
            user=self.member,
        ).exists())

    @patch('core.sharing_consistency_api._sync_optional')
    def test_failed_resource_grant_restores_existing_direct_grant(self, sync_acl):
        ProjectMembership.objects.create(
            project=self.project,
            user=self.member,
            role=ProjectMembership.Role.VIEWER,
        )
        existing = grant_role(self.resource, self.member, 'view', granted_by=self.owner)
        sync_acl.side_effect = cloud.CloudError('acl failed')

        response = self.post_share({
            'type': 'resource',
            'id': self.resource.pk,
            'action': 'grant',
            'email': self.member.email,
            'role': 'edit',
        })
        self.assertEqual(response.status_code, 503, response.content)
        existing.refresh_from_db()
        self.assertEqual(existing.role, 'view')

    @patch('core.sharing_consistency_api._sync_optional')
    def test_failed_link_acl_sync_rolls_back_link_and_policy(self, sync_acl):
        policy = policy_for(
            self.resource,
            create=True,
            created_by=self.owner,
            default_visibility=ObjectPolicy.Visibility.PRIVATE,
        )
        policy.visibility = ObjectPolicy.Visibility.PRIVATE
        policy.save(update_fields=['visibility', 'updated_at'])
        sync_acl.side_effect = cloud.CloudError('acl failed')

        response = self.post_share({
            'type': 'resource',
            'id': self.resource.pk,
            'action': 'link',
            'role': 'view',
        })
        self.assertEqual(response.status_code, 503, response.content)
        self.assertFalse(ShareLink.objects.filter(
            content_type=content_type_for(self.resource),
            object_id=self.resource.pk,
        ).exists())
        policy.refresh_from_db()
        self.assertEqual(policy.visibility, ObjectPolicy.Visibility.PRIVATE)

    def test_expired_direct_grants_are_not_returned_as_active_access(self):
        ProjectMembership.objects.create(
            project=self.project,
            user=self.member,
            role=ProjectMembership.Role.VIEWER,
        )
        expired = grant_role(
            self.resource,
            self.member,
            'edit',
            granted_by=self.owner,
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        active = grant_role(
            self.resource,
            self.other,
            'view',
            granted_by=self.owner,
            expires_at=timezone.now() + timedelta(hours=1),
        )
        response = self.client.get(f'/api/platform/share/?type=resource&id={self.resource.pk}')
        self.assertEqual(response.status_code, 200, response.content)
        ids = {item['id'] for item in response.json()['grants']}
        self.assertNotIn(expired.pk, ids)
        self.assertIn(active.pk, ids)

    def test_research_suspension_blocks_project_sharing_even_for_project_manager(self):
        ProjectMembership.objects.create(
            project=self.project,
            user=self.member,
            role=ProjectMembership.Role.OWNER,
        )
        set_module_grant(
            self.member,
            ModuleGrant.Module.RESEARCH,
            enabled=False,
            access_level=ModuleGrant.AccessLevel.MANAGE,
        )
        self.client.force_login(self.member)
        response = self.client.get(f'/api/platform/share/?type=project&id={self.project.pk}')
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()['error'], 'research_access_required')

    @patch('core.sharing_consistency_api.nextcloud_bridge.add_project_user')
    def test_disabled_nextcloud_does_not_break_local_project_grant(self, add_user):
        add_user.side_effect = ImproperlyConfigured('integration disabled')
        response = self.post_share({
            'type': 'project',
            'id': self.project.pk,
            'action': 'grant',
            'email': self.member.email,
            'role': 'edit',
        })
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(
            ProjectMembership.objects.get(project=self.project, user=self.member).role,
            ProjectMembership.Role.EDITOR,
        )
        self.assertEqual(
            AccessGrant.objects.get(
                content_type=content_type_for(self.project),
                object_id=self.project.pk,
                user=self.member,
            ).role,
            'edit',
        )
