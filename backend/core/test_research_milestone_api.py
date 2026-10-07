import json

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import ProjectMembership, ResearchProject
from .operating_models import OperatingMilestone
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(SECURE_SSL_REDIRECT=False)
class ResearchMilestoneApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(username='milestone-owner@example.com', email='milestone-owner@example.com', password='test-pass-123')
        self.editor = User.objects.create_user(username='milestone-editor@example.com', email='milestone-editor@example.com', password='test-pass-123')
        self.outsider = User.objects.create_user(username='milestone-outsider@example.com', email='milestone-outsider@example.com', password='test-pass-123')
        spaces = ensure_platform_workspaces(self.owner)
        self.core = spaces['core']
        self.research = spaces['research']
        self.project = ResearchProject.objects.create(workspace=self.research, owner=self.owner, title='Milestone research project')
        ProjectMembership.objects.create(project=self.project, user=self.editor, role=ProjectMembership.Role.EDITOR)

    def post_json(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json')

    def patch_json(self, path, payload):
        return self.client.patch(path, data=json.dumps(payload), content_type='application/json')

    def test_editor_can_create_update_and_delete_core_backed_project_milestone(self):
        self.client.force_login(self.editor)
        created = self.post_json(
            f'/api/platform/projects/{self.project.pk}/milestones/',
            {
                'title': 'Evidence review complete',
                'due_date': '2026-10-01',
                'definition_of_done': 'Review signed off and evidence recorded.',
                'health': 'yellow',
                'status': 'active',
            },
        )
        self.assertEqual(created.status_code, 201, created.content)
        milestone_id = created.json()['milestone']['id']
        item = OperatingMilestone.objects.get(pk=milestone_id)
        self.assertEqual(item.workspace_id, self.core.pk)
        self.assertEqual(item.project_id, self.project.pk)
        self.assertTrue(created.json()['milestone']['can_edit'])

        updated = self.patch_json(
            f'/api/platform/projects/{self.project.pk}/milestones/{milestone_id}/',
            {'title': 'Evidence review approved', 'health': 'green', 'status': 'done'},
        )
        self.assertEqual(updated.status_code, 200, updated.content)
        self.assertEqual(updated.json()['milestone']['title'], 'Evidence review approved')
        self.assertEqual(updated.json()['milestone']['status'], 'done')

        deleted = self.client.delete(f'/api/platform/projects/{self.project.pk}/milestones/{milestone_id}/')
        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.assertFalse(OperatingMilestone.objects.filter(pk=milestone_id).exists())

    def test_outsider_cannot_see_or_mutate_project_milestones(self):
        self.client.force_login(self.outsider)
        listed = self.client.get(f'/api/platform/projects/{self.project.pk}/milestones/')
        self.assertEqual(listed.status_code, 404, listed.content)
        created = self.post_json(f'/api/platform/projects/{self.project.pk}/milestones/', {'title': 'Hidden'})
        self.assertEqual(created.status_code, 403, created.content)
