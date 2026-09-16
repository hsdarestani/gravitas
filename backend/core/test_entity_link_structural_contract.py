import json

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import KnowledgeResource, ProjectMembership, ResearchProject
from .platform_access import content_type_for
from .platform_models import EntityLink
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(SECURE_SSL_REDIRECT=False)
class EntityLinkStructuralContractTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='entity-link-owner@example.com',
            email='entity-link-owner@example.com',
            password='test-pass-123',
        )
        spaces = ensure_platform_workspaces(self.user)
        self.project = ResearchProject.objects.create(
            workspace=spaces['research'],
            owner=self.user,
            title='Editable project',
        )
        self.target_project = ResearchProject.objects.create(
            workspace=spaces['research'],
            owner=self.user,
            title='Visible target project',
        )
        ProjectMembership.objects.create(
            project=self.project,
            user=self.user,
            role=ProjectMembership.Role.OWNER,
        )
        ProjectMembership.objects.create(
            project=self.target_project,
            user=self.user,
            role=ProjectMembership.Role.OWNER,
        )
        self.client.force_login(self.user)

    def delete_link(self, link_id, source_type, source_id, target_type, target_id):
        return self.client.delete(
            '/api/platform/links/',
            data=json.dumps({
                'link_id': link_id,
                'source_type': source_type,
                'source_id': source_id,
                'target_type': target_type,
                'target_id': target_id,
            }),
            content_type='application/json',
        )

    def test_delete_does_not_confuse_equal_primary_keys_across_models(self):
        # Generic foreign keys are (content_type, object_id), not object_id
        # alone. Give a Resource the same numeric id as the editable Project to
        # reproduce the collision the legacy DELETE query was vulnerable to.
        source_resource = KnowledgeResource.objects.create(
            pk=self.project.pk,
            workspace=self.project.workspace,
            project=self.project,
            owner=self.user,
            kind=KnowledgeResource.Kind.NOTE,
            title='Resource with colliding id',
        )
        target_resource = KnowledgeResource.objects.create(
            workspace=self.project.workspace,
            project=self.project,
            owner=self.user,
            kind=KnowledgeResource.Kind.NOTE,
            title='Unrelated resource target',
        )
        unrelated = EntityLink.objects.create(
            source_content_type=content_type_for(source_resource),
            source_object_id=source_resource.pk,
            target_content_type=content_type_for(target_resource),
            target_object_id=target_resource.pk,
            relation='related',
            created_by=self.user,
        )

        response = self.delete_link(
            unrelated.pk,
            'project',
            self.project.pk,
            'project',
            self.target_project.pk,
        )
        self.assertEqual(response.status_code, 404, response.content)
        self.assertEqual(response.json()['error'], 'link_not_found')
        self.assertTrue(EntityLink.objects.filter(pk=unrelated.pk).exists())

    def test_delete_removes_the_exact_generic_object_pair(self):
        link = EntityLink.objects.create(
            source_content_type=content_type_for(self.project),
            source_object_id=self.project.pk,
            target_content_type=content_type_for(self.target_project),
            target_object_id=self.target_project.pk,
            relation='related',
            created_by=self.user,
        )
        response = self.delete_link(
            link.pk,
            'project',
            self.project.pk,
            'project',
            self.target_project.pk,
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(EntityLink.objects.filter(pk=link.pk).exists())
