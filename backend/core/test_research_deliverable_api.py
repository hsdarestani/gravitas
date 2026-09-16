import json

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import ProjectMembership, ResearchProject
from .platform_models import ProjectDeliverable
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(SECURE_SSL_REDIRECT=False)
class ResearchDeliverableApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(username='deliverable-owner@example.com', email='deliverable-owner@example.com', password='test-pass-123')
        self.editor = User.objects.create_user(username='deliverable-editor@example.com', email='deliverable-editor@example.com', password='test-pass-123')
        self.viewer = User.objects.create_user(username='deliverable-viewer@example.com', email='deliverable-viewer@example.com', password='test-pass-123')
        spaces = ensure_platform_workspaces(self.owner)
        self.project = ResearchProject.objects.create(workspace=spaces['research'], owner=self.owner, title='Deliverable project')
        ProjectMembership.objects.create(project=self.project, user=self.editor, role=ProjectMembership.Role.EDITOR)
        ProjectMembership.objects.create(project=self.project, user=self.viewer, role=ProjectMembership.Role.VIEWER)
        self.item = ProjectDeliverable.objects.create(project=self.project, title='Draft output', created_by=self.owner)

    def patch_json(self, path, payload):
        return self.client.patch(path, data=json.dumps(payload), content_type='application/json')

    def test_editor_can_update_and_delete_deliverable(self):
        self.client.force_login(self.editor)
        path = f'/api/platform/projects/{self.project.pk}/deliverables/{self.item.pk}/'
        updated = self.patch_json(path, {'title': 'Reviewed output', 'status': 'approved', 'client_visible': True})
        self.assertEqual(updated.status_code, 200, updated.content)
        self.assertEqual(updated.json()['item']['title'], 'Reviewed output')
        self.assertEqual(updated.json()['item']['status'], 'approved')
        self.assertTrue(updated.json()['item']['client_visible'])

        deleted = self.client.delete(path)
        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.assertFalse(ProjectDeliverable.objects.filter(pk=self.item.pk).exists())

    def test_viewer_cannot_mutate_deliverable(self):
        self.client.force_login(self.viewer)
        path = f'/api/platform/projects/{self.project.pk}/deliverables/{self.item.pk}/'
        response = self.patch_json(path, {'title': 'Forbidden'})
        self.assertEqual(response.status_code, 403, response.content)
