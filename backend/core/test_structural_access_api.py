import json
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.http import JsonResponse
from django.test import TestCase, override_settings
from django.utils import timezone

from . import cloud, nextcloud_bridge
from .layer_access import set_module_grant
from .layer_models import ModuleGrant
from .models import KnowledgeResource, ProjectMembership, ResearchProject
from .platform_access import content_type_for
from .platform_models import AccessGrant, ProjectApplication, ResearchRequest
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(
    SECURE_SSL_REDIRECT=False,
    GRAVITAS_DEFAULT_QUOTA_BYTES=100 * 1024 * 1024,
    GRAVITAS_MAX_UPLOAD_BYTES=10 * 1024 * 1024,
)
class StructuralAccessApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            username='struct-owner@example.com',
            email='struct-owner@example.com',
            password='test-pass-123',
        )
        self.collaborator = User.objects.create_user(
            username='struct-collaborator@example.com',
            email='struct-collaborator@example.com',
            password='test-pass-123',
        )
        self.other = User.objects.create_user(
            username='struct-other@example.com',
            email='struct-other@example.com',
            password='test-pass-123',
        )
        self.spaces = ensure_platform_workspaces(self.owner)
        self.project = ResearchProject.objects.create(
            workspace=self.spaces['research'],
            owner=self.owner,
            title='Structural contract project',
        )
        ProjectMembership.objects.create(
            project=self.project,
            user=self.owner,
            role=ProjectMembership.Role.OWNER,
        )
        self.client.force_login(self.owner)

    def patch_json(self, path, payload):
        return self.client.patch(path, data=json.dumps(payload), content_type='application/json')

    def post_json(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json')

    def test_explicit_unknown_workspace_never_falls_back_to_personal_note(self):
        response = self.post_json('/api/platform/resources/', {
            'workspace_id': 999999,
            'kind': 'note',
            'title': 'Must not become personal',
            'body': 'Wrong destination.',
        })
        self.assertEqual(response.status_code, 404, response.content)
        self.assertEqual(response.json()['error'], 'workspace_not_found')
        self.assertFalse(KnowledgeResource.objects.filter(title='Must not become personal').exists())

    def test_explicit_unknown_workspace_never_falls_back_during_upload(self):
        upload = SimpleUploadedFile('contract.txt', b'contract', content_type='text/plain')
        response = self.client.post('/api/platform/files/upload/', {
            'workspace_id': '999999',
            'kind': 'file',
            'file': upload,
        })
        self.assertEqual(response.status_code, 404, response.content)
        self.assertEqual(response.json()['error'], 'workspace_not_found')
        self.assertFalse(KnowledgeResource.objects.filter(original_name='contract.txt').exists())

    @patch('core.structural_access_api.base_project_nextcloud_sync')
    def test_acl_reconcile_requires_project_manager_not_viewer(self, base_sync):
        base_sync.return_value = JsonResponse({'ok': True})
        ProjectMembership.objects.create(
            project=self.project,
            user=self.collaborator,
            role=ProjectMembership.Role.VIEWER,
        )
        self.client.force_login(self.collaborator)
        denied = self.client.post(f'/api/platform/projects/{self.project.pk}/nextcloud/sync/')
        self.assertEqual(denied.status_code, 403, denied.content)
        base_sync.assert_not_called()

        self.client.force_login(self.owner)
        allowed = self.client.post(f'/api/platform/projects/{self.project.pk}/nextcloud/sync/')
        self.assertEqual(allowed.status_code, 200, allowed.content)
        base_sync.assert_called_once()

    def test_explicit_research_suspension_still_blocks_canonical_shadow_route(self):
        ProjectMembership.objects.create(
            project=self.project,
            user=self.collaborator,
            role=ProjectMembership.Role.EDITOR,
        )
        request_item = ResearchRequest.objects.create(
            workspace=self.project.workspace,
            project=self.project,
            requested_by=self.owner,
            title='Suspended participant request',
        )
        set_module_grant(
            self.collaborator,
            ModuleGrant.Module.RESEARCH,
            enabled=False,
            access_level=ModuleGrant.AccessLevel.EDIT,
        )
        self.client.force_login(self.collaborator)

        response = self.patch_json(
            f'/api/platform/research-requests/{request_item.pk}/',
            {'brief': 'This mutation must remain blocked.'},
        )
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()['error'], 'research_access_required')
        request_item.refresh_from_db()
        self.assertEqual(request_item.brief, '')

    @patch('core.structural_access_api.nextcloud_bridge.add_project_user')
    def test_assigning_research_request_upgrades_viewer_and_native_membership(self, add_project_user):
        ProjectMembership.objects.create(
            project=self.project,
            user=self.collaborator,
            role=ProjectMembership.Role.VIEWER,
        )
        request_item = ResearchRequest.objects.create(
            workspace=self.project.workspace,
            project=self.project,
            requested_by=self.owner,
            title='Validate evidence package',
        )

        response = self.patch_json(
            f'/api/platform/research-requests/{request_item.pk}/',
            {'assignee_id': self.collaborator.pk},
        )
        self.assertEqual(response.status_code, 200, response.content)
        request_item.refresh_from_db()
        self.assertEqual(request_item.assignee_id, self.collaborator.pk)
        membership = ProjectMembership.objects.get(project=self.project, user=self.collaborator)
        self.assertEqual(membership.role, ProjectMembership.Role.EDITOR)
        grant = AccessGrant.objects.get(
            content_type=content_type_for(self.project),
            object_id=self.project.pk,
            user=self.collaborator,
        )
        self.assertEqual(grant.role, 'edit')
        add_project_user.assert_called_once_with(self.project, self.collaborator)

    @patch('core.structural_access_api.nextcloud_bridge.add_project_user')
    def test_accepting_application_provisions_native_project_access(self, add_project_user):
        application = ProjectApplication.objects.create(
            project=self.project,
            applicant_user=self.collaborator,
            applicant_name='Collaborator',
            applicant_email=self.collaborator.email,
        )
        response = self.patch_json(
            f'/api/platform/projects/{self.project.pk}/applications/{application.pk}/',
            {'status': ProjectApplication.Status.ACCEPTED},
        )
        self.assertEqual(response.status_code, 200, response.content)
        application.refresh_from_db()
        self.assertEqual(application.status, ProjectApplication.Status.ACCEPTED)
        self.assertEqual(
            ProjectMembership.objects.get(project=self.project, user=self.collaborator).role,
            ProjectMembership.Role.EDITOR,
        )
        self.assertEqual(
            AccessGrant.objects.get(
                content_type=content_type_for(self.project),
                object_id=self.project.pk,
                user=self.collaborator,
            ).role,
            'edit',
        )
        add_project_user.assert_called_once_with(self.project, self.collaborator)

    @patch('core.structural_access_api.nextcloud_bridge.add_project_user')
    def test_failed_native_membership_rolls_back_application_acceptance(self, add_project_user):
        add_project_user.side_effect = cloud.CloudError('offline')
        application = ProjectApplication.objects.create(
            project=self.project,
            applicant_user=self.other,
            applicant_name='Other',
            applicant_email=self.other.email,
        )
        response = self.patch_json(
            f'/api/platform/projects/{self.project.pk}/applications/{application.pk}/',
            {'status': ProjectApplication.Status.ACCEPTED},
        )
        self.assertEqual(response.status_code, 503, response.content)
        application.refresh_from_db()
        self.assertEqual(application.status, ProjectApplication.Status.SUBMITTED)
        self.assertFalse(ProjectMembership.objects.filter(project=self.project, user=self.other).exists())
        self.assertFalse(AccessGrant.objects.filter(
            content_type=content_type_for(self.project),
            object_id=self.project.pk,
            user=self.other,
        ).exists())

    def test_expired_object_grant_is_not_written_to_nextcloud_acl(self):
        resource = KnowledgeResource.objects.create(
            workspace=self.project.workspace,
            project=self.project,
            owner=self.owner,
            kind=KnowledgeResource.Kind.NOTE,
            title='Restricted note',
        )
        ct = content_type_for(resource)
        AccessGrant.objects.create(
            content_type=ct,
            object_id=resource.pk,
            user=self.collaborator,
            role='edit',
            expires_at=timezone.now() - timedelta(minutes=5),
        )
        AccessGrant.objects.create(
            content_type=ct,
            object_id=resource.pk,
            user=self.other,
            role='view',
            expires_at=timezone.now() + timedelta(hours=1),
        )

        roles = nextcloud_bridge._explicit_roles(resource)
        self.assertNotIn(self.collaborator.pk, roles)
        self.assertIn(self.other.pk, roles)
        self.assertEqual(roles[self.other.pk][1], 'view')
