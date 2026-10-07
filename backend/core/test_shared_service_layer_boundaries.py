import json
from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .layer_access import module_access, set_module_grant
from .layer_models import ModuleGrant
from .models import KnowledgeResource, ProjectMembership, ResearchProject, WorkspaceMembership
from .operating_models import OperatingTask
from .platform_access import content_type_for, grant_role
from .platform_models import AccessGrant, ShareLink
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(
    SECURE_SSL_REDIRECT=False,
    GRAVITAS_DEFAULT_QUOTA_BYTES=100 * 1024 * 1024,
    GRAVITAS_MAX_UPLOAD_BYTES=10 * 1024 * 1024,
)
class SharedServiceLayerBoundaryTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            username='layer-owner@example.com',
            email='layer-owner@example.com',
            password='test-pass-123',
        )
        # The first bootstrap creates the canonical platform and makes only this
        # account a Core member.
        self.spaces = ensure_platform_workspaces(self.owner)
        self.outsider = User.objects.create_user(
            username='layer-outsider@example.com',
            email='layer-outsider@example.com',
            password='test-pass-123',
        )
        self.core_member = User.objects.create_user(
            username='layer-core@example.com',
            email='layer-core@example.com',
            password='test-pass-123',
        )
        WorkspaceMembership.objects.create(
            workspace=self.spaces['core'],
            user=self.core_member,
            role=WorkspaceMembership.Role.MEMBER,
        )
        self.core_resource = KnowledgeResource.objects.create(
            workspace=self.spaces['core'],
            owner=self.owner,
            kind=KnowledgeResource.Kind.NOTE,
            title='Internal Core note',
            body='Layer 5 only.',
        )
        self.client.force_login(self.owner)

    def post_share(self, payload):
        return self.client.post(
            '/api/platform/share/',
            data=json.dumps(payload),
            content_type='application/json',
        )

    def test_core_direct_grant_requires_real_core_membership(self):
        response = self.post_share({
            'type': 'resource',
            'id': self.core_resource.pk,
            'action': 'grant',
            'email': self.outsider.email,
            'role': 'view',
        })
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()['error'], 'core_membership_required')
        self.assertFalse(AccessGrant.objects.filter(
            content_type=content_type_for(self.core_resource),
            object_id=self.core_resource.pk,
            user=self.outsider,
        ).exists())

        allowed = self.post_share({
            'type': 'resource',
            'id': self.core_resource.pk,
            'action': 'grant',
            'email': self.core_member.email,
            'role': 'view',
        })
        self.assertEqual(allowed.status_code, 201, allowed.content)

    def test_stale_core_grant_cannot_bypass_resource_or_shared_with_me(self):
        grant_role(self.core_resource, self.outsider, 'view', granted_by=self.owner)
        self.client.force_login(self.outsider)

        detail = self.client.get(f'/api/platform/resources/{self.core_resource.pk}/')
        self.assertEqual(detail.status_code, 403, detail.content)
        self.assertEqual(detail.json()['error'], 'core_workspace_for_internal_team_only')

        shared = self.client.get('/api/platform/shared-with-me/')
        self.assertEqual(shared.status_code, 200, shared.content)
        ids = {(item['type'], item['id']) for item in shared.json()['items']}
        self.assertNotIn(('resource', self.core_resource.pk), ids)

    def test_stale_core_grant_cannot_cross_entity_link_service(self):
        other = KnowledgeResource.objects.create(
            workspace=self.spaces['core'],
            owner=self.owner,
            kind=KnowledgeResource.Kind.NOTE,
            title='Other internal note',
        )
        grant_role(self.core_resource, self.outsider, 'edit', granted_by=self.owner)
        grant_role(other, self.outsider, 'view', granted_by=self.owner)
        self.client.force_login(self.outsider)

        response = self.client.post(
            '/api/platform/links/',
            data=json.dumps({
                'source_type': 'resource',
                'source_id': self.core_resource.pk,
                'target_type': 'resource',
                'target_id': other.pk,
                'relation': 'related',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()['error'], 'core_workspace_for_internal_team_only')

    def test_core_objects_cannot_create_or_keep_public_share_links(self):
        policy = self.post_share({
            'type': 'resource',
            'id': self.core_resource.pk,
            'action': 'policy',
            'visibility': 'public',
        })
        self.assertEqual(policy.status_code, 409, policy.content)
        self.assertEqual(policy.json()['error'], 'core_objects_cannot_be_public')

        create_link = self.post_share({
            'type': 'resource',
            'id': self.core_resource.pk,
            'action': 'link',
            'role': 'view',
        })
        self.assertEqual(create_link.status_code, 409, create_link.content)
        self.assertEqual(create_link.json()['error'], 'core_objects_cannot_be_public')

        # Simulate a historical link created by an older build. Canonical public
        # routes must close it without deleting audit/history rows.
        self.core_resource.storage_path = 'Gravitas/Core/legacy-secret.pdf'
        self.core_resource.original_name = 'legacy-secret.pdf'
        self.core_resource.file_size = 12
        self.core_resource.save(update_fields=['storage_path', 'original_name', 'file_size', 'updated_at'])
        stale = ShareLink.objects.create(
            content_type=content_type_for(self.core_resource),
            object_id=self.core_resource.pk,
            role='view',
            allow_download=True,
            created_by=self.owner,
        )
        self.client.logout()
        page = self.client.get(f'/api/platform/shared/{stale.token}/')
        download = self.client.get(f'/api/platform/shared/{stale.token}/download/')
        self.assertEqual(page.status_code, 404, page.content)
        self.assertEqual(download.status_code, 404, download.content)

    def _create_research_task(self):
        project = ResearchProject.objects.create(
            workspace=self.spaces['research'],
            owner=self.owner,
            title='Cross-layer research execution',
        )
        ProjectMembership.objects.create(
            project=project,
            user=self.owner,
            role=ProjectMembership.Role.OWNER,
        )
        ProjectMembership.objects.create(
            project=project,
            user=self.outsider,
            role=ProjectMembership.Role.EDITOR,
        )
        self.client.force_login(self.owner)
        response = self.client.post(
            f'/api/platform/projects/{project.pk}/tasks/',
            data=json.dumps({
                'title': 'Research task stored in Core',
                'due_date': date(2026, 10, 1).isoformat(),
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        task = OperatingTask.objects.get(pk=response.json()['task']['id'])
        self.assertEqual(task.workspace_id, self.spaces['core'].pk)
        self.assertEqual(task.project_id, project.pk)
        return project, task

    def test_research_task_in_core_workspace_uses_research_entitlement(self):
        project, task = self._create_research_task()
        self.assertFalse(WorkspaceMembership.objects.filter(
            workspace=self.spaces['core'], user=self.outsider
        ).exists())

        self.client.force_login(self.outsider)
        response = self.client.get(f'/api/platform/tasks/{task.pk}/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['task']['project_id'], project.pk)

    def test_explicit_research_suspension_blocks_shared_task_and_shared_list(self):
        _project, task = self._create_research_task()
        grant_role(task, self.outsider, 'view', granted_by=self.owner)
        set_module_grant(
            self.outsider,
            ModuleGrant.Module.RESEARCH,
            enabled=False,
            access_level=ModuleGrant.AccessLevel.PARTICIPATE,
        )
        self.client.force_login(self.outsider)

        detail = self.client.get(f'/api/platform/tasks/{task.pk}/')
        self.assertEqual(detail.status_code, 403, detail.content)
        self.assertEqual(detail.json()['error'], 'research_access_required')

        shared = self.client.get('/api/platform/shared-with-me/')
        self.assertEqual(shared.status_code, 200, shared.content)
        self.assertNotIn(task.pk, [item['id'] for item in shared.json()['items'] if item['type'] == 'task'])

    def test_archived_project_grant_does_not_reopen_research_layer(self):
        archived = ResearchProject.objects.create(
            workspace=self.spaces['research'],
            owner=self.owner,
            title='Archived project',
            archived=True,
        )
        grant_role(archived, self.outsider, 'view', granted_by=self.owner)
        self.assertFalse(module_access(self.outsider, ModuleGrant.Module.RESEARCH))

    def test_research_public_link_remains_available(self):
        project = ResearchProject.objects.create(
            workspace=self.spaces['research'],
            owner=self.owner,
            title='Client-shareable research',
        )
        ProjectMembership.objects.create(
            project=project,
            user=self.owner,
            role=ProjectMembership.Role.OWNER,
        )
        response = self.post_share({
            'type': 'project',
            'id': project.pk,
            'action': 'link',
            'role': 'view',
        })
        self.assertEqual(response.status_code, 201, response.content)
        token = response.json()['link']['token']
        self.client.logout()
        public = self.client.get(f'/api/platform/shared/{token}/')
        self.assertEqual(public.status_code, 200, public.content)
        self.assertEqual(public.json()['type'], 'project')
