from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .layer_access import set_module_grant
from .layer_models import ModuleGrant
from .models import KnowledgeResource, ProjectMembership, ResearchProject
from .platform_access import grant_role
from .platform_runtime_v3 import ensure_platform_workspaces
from .workspace_api import provision_personal_workspace


@override_settings(SECURE_SSL_REDIRECT=False)
class ResourceListLayerGateTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            username='list-owner@example.com',
            email='list-owner@example.com',
            password='test-pass-123',
        )
        self.spaces = ensure_platform_workspaces(self.owner)
        self.user = User.objects.create_user(
            username='list-user@example.com',
            email='list-user@example.com',
            password='test-pass-123',
        )
        self.personal = provision_personal_workspace(self.user)

    def test_stale_core_grant_is_hidden_without_hiding_personal_rows(self):
        personal = KnowledgeResource.objects.create(
            workspace=self.personal,
            owner=self.user,
            kind=KnowledgeResource.Kind.NOTE,
            title='My note',
        )
        core = KnowledgeResource.objects.create(
            workspace=self.spaces['core'],
            owner=self.owner,
            kind=KnowledgeResource.Kind.NOTE,
            title='Internal note',
        )
        grant_role(core, self.user, 'view', granted_by=self.owner)

        self.client.force_login(self.user)
        response = self.client.get('/api/platform/resources/')
        self.assertEqual(response.status_code, 200, response.content)
        ids = {item['id'] for item in response.json()['items']}
        self.assertIn(personal.pk, ids)
        self.assertNotIn(core.pk, ids)

        core_only = self.client.get('/api/platform/resources/?workspace=core')
        self.assertEqual(core_only.status_code, 200, core_only.content)
        self.assertEqual(core_only.json()['items'], [])

    def test_explicit_research_suspension_hides_project_resource_from_list(self):
        project = ResearchProject.objects.create(
            workspace=self.spaces['research'],
            owner=self.owner,
            title='Suspended research',
        )
        ProjectMembership.objects.create(
            project=project,
            user=self.user,
            role=ProjectMembership.Role.EDITOR,
        )
        resource = KnowledgeResource.objects.create(
            workspace=self.spaces['research'],
            project=project,
            owner=self.owner,
            kind=KnowledgeResource.Kind.NOTE,
            title='Research note',
        )
        grant_role(resource, self.user, 'view', granted_by=self.owner)
        set_module_grant(
            self.user,
            ModuleGrant.Module.RESEARCH,
            enabled=False,
            access_level=ModuleGrant.AccessLevel.PARTICIPATE,
        )

        self.client.force_login(self.user)
        response = self.client.get('/api/platform/resources/?workspace=research')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn(resource.pk, [item['id'] for item in response.json()['items']])
