import json

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .layer_access import set_module_grant
from .layer_models import ModuleGrant
from .models import ProjectMembership, ResearchProject
from .platform_access import content_type_for
from .platform_models import AccessGrant
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(SECURE_SSL_REDIRECT=False)
class SharingRecipientLayerGateTests(TestCase):
    def test_suspended_research_account_is_not_provisioned_by_share(self):
        User = get_user_model()
        owner = User.objects.create_user(
            username='share-owner@example.com',
            email='share-owner@example.com',
            password='test-pass-123',
        )
        spaces = ensure_platform_workspaces(owner)
        suspended = User.objects.create_user(
            username='share-suspended@example.com',
            email='share-suspended@example.com',
            password='test-pass-123',
        )
        set_module_grant(
            suspended,
            ModuleGrant.Module.RESEARCH,
            enabled=False,
            access_level=ModuleGrant.AccessLevel.PARTICIPATE,
        )
        project = ResearchProject.objects.create(
            workspace=spaces['research'],
            owner=owner,
            title='Suspension boundary',
        )
        ProjectMembership.objects.create(
            project=project,
            user=owner,
            role=ProjectMembership.Role.OWNER,
        )

        self.client.force_login(owner)
        response = self.client.post(
            '/api/platform/share/',
            data=json.dumps({
                'type': 'project',
                'id': project.pk,
                'action': 'grant',
                'email': suspended.email,
                'role': 'edit',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()['error'], 'research_access_suspended')
        self.assertFalse(ProjectMembership.objects.filter(project=project, user=suspended).exists())
        self.assertFalse(AccessGrant.objects.filter(
            content_type=content_type_for(project),
            object_id=project.pk,
            user=suspended,
        ).exists())
