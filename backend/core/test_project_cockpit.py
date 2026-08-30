from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase

from core.models import (
    KnowledgeResource,
    Organization,
    ProjectMembership,
    ResearchProject,
    Workspace,
)
from core.platform_models import EntityLink, ObjectPolicy, ProjectAuditEvent


class ResearchProjectCockpitTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            username='cockpit-owner@example.test',
            email='cockpit-owner@example.test',
            password='pw',
            first_name='Project',
            last_name='Owner',
        )
        self.viewer = User.objects.create_user(
            username='cockpit-viewer@example.test',
            email='cockpit-viewer@example.test',
            password='pw',
            first_name='Research',
            last_name='Viewer',
        )
        self.outsider = User.objects.create_user(
            username='cockpit-outsider@example.test',
            email='cockpit-outsider@example.test',
            password='pw',
            first_name='Outside',
            last_name='Person',
        )
        self.candidate = User.objects.create_user(
            username='alice-candidate@example.test',
            email='alice-candidate@example.test',
            password='pw',
            first_name='Alice',
            last_name='Candidate',
        )
        self.org = Organization.objects.create(
            name='Research V5 Test',
            slug='research-v5-test',
            created_by=self.owner,
        )
        self.workspace = Workspace.objects.create(
            name='Research',
            kind=Workspace.Kind.TEAM,
            organization=self.org,
        )
        self.project = ResearchProject.objects.create(
            workspace=self.workspace,
            owner=self.owner,
            title='Evidence Synthesis',
            description='Connect evidence, data and outputs.',
        )
        ProjectMembership.objects.create(
            project=self.project,
            user=self.owner,
            role=ProjectMembership.Role.OWNER,
        )
        ProjectMembership.objects.create(
            project=self.project,
            user=self.viewer,
            role=ProjectMembership.Role.VIEWER,
        )
        self.note = KnowledgeResource.objects.create(
            workspace=self.workspace,
            project=self.project,
            owner=self.owner,
            kind=KnowledgeResource.Kind.NOTE,
            title='Primary finding',
            body='Finding body',
        )
        self.dataset = KnowledgeResource.objects.create(
            workspace=self.workspace,
            project=self.project,
            owner=self.owner,
            kind=KnowledgeResource.Kind.DATASET,
            title='Trial dataset',
        )
        EntityLink.objects.create(
            source_content_type=ContentType.objects.get_for_model(self.note),
            source_object_id=self.note.pk,
            target_content_type=ContentType.objects.get_for_model(self.dataset),
            target_object_id=self.dataset.pk,
            relation='supports',
            created_by=self.owner,
        )
        ProjectAuditEvent.objects.create(
            project=self.project,
            actor=self.owner,
            action='resource_created',
            object_type='KnowledgeResource',
            object_id=str(self.note.pk),
            detail={'title': self.note.title, 'secret_internal_value': 'must-not-leak'},
        )

    def test_owner_gets_connected_project_cockpit(self):
        self.client.force_login(self.owner)
        response = self.client.get(f'/api/platform/projects/{self.project.pk}/cockpit/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['ok'])
        self.assertEqual(data['project']['id'], self.project.pk)
        self.assertEqual(data['counts']['notes'], 1)
        self.assertEqual(data['counts']['datasets'], 1)
        self.assertEqual(data['counts']['connections'], 1)
        self.assertEqual(data['connections'][0]['relation'], 'supports')
        self.assertEqual(data['connections'][0]['source']['title'], 'Primary finding')
        self.assertEqual(data['connections'][0]['target']['title'], 'Trial dataset')
        self.assertNotIn('secret_internal_value', data['activity'][0]['detail'])

    def test_project_viewer_can_use_cockpit_but_not_people_directory(self):
        self.client.force_login(self.viewer)
        cockpit = self.client.get(f'/api/platform/projects/{self.project.pk}/cockpit/')
        self.assertEqual(cockpit.status_code, 200)
        self.assertEqual(cockpit.json()['project']['permissions']['role'], 'view')
        candidates = self.client.get(
            f'/api/platform/projects/{self.project.pk}/access-candidates/?q=alice'
        )
        self.assertEqual(candidates.status_code, 403)

    def test_outsider_cannot_open_project_cockpit(self):
        self.client.force_login(self.outsider)
        response = self.client.get(f'/api/platform/projects/{self.project.pk}/cockpit/')
        self.assertEqual(response.status_code, 404)

    def test_private_child_is_not_exposed_to_viewer_or_connections(self):
        private = KnowledgeResource.objects.create(
            workspace=self.workspace,
            project=self.project,
            owner=self.owner,
            kind=KnowledgeResource.Kind.NOTE,
            title='Manager-only note',
        )
        ObjectPolicy.objects.create(
            content_type=ContentType.objects.get_for_model(private),
            object_id=private.pk,
            visibility=ObjectPolicy.Visibility.PRIVATE,
            created_by=self.owner,
        )
        EntityLink.objects.create(
            source_content_type=ContentType.objects.get_for_model(private),
            source_object_id=private.pk,
            target_content_type=ContentType.objects.get_for_model(self.note),
            target_object_id=self.note.pk,
            relation='related',
            created_by=self.owner,
        )
        self.client.force_login(self.viewer)
        data = self.client.get(
            f'/api/platform/projects/{self.project.pk}/cockpit/'
        ).json()
        titles = {item['title'] for item in data['resources']}
        self.assertNotIn('Manager-only note', titles)
        linked_titles = {
            endpoint['title']
            for link in data['connections']
            for endpoint in (link['source'], link['target'])
        }
        self.assertNotIn('Manager-only note', linked_titles)

    def test_manager_can_search_registered_people_for_project_access(self):
        self.client.force_login(self.owner)
        response = self.client.get(
            f'/api/platform/projects/{self.project.pk}/access-candidates/?q=alice'
        )
        self.assertEqual(response.status_code, 200)
        items = response.json()['items']
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['email'], self.candidate.email)
        self.assertFalse(items[0]['is_member'])
