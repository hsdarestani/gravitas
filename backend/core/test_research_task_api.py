from django.contrib.auth import get_user_model
from django.test import TestCase

from core.models import ProjectMembership, ResearchProject, WorkspaceMembership
from core.operating_models import OperatingTask, OperatingProcess
from core.platform_access import INHERIT_VISIBILITY, policy_for
from core.platform_models import ResearchProjectProfile
from core.platform_runtime_v3 import ensure_platform_workspaces


class ResearchProjectTaskApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            username='research-task-owner@example.test',
            email='research-task-owner@example.test',
            password='pw',
        )
        self.editor = User.objects.create_user(
            username='research-task-editor@example.test',
            email='research-task-editor@example.test',
            password='pw',
        )
        self.viewer = User.objects.create_user(
            username='research-task-viewer@example.test',
            email='research-task-viewer@example.test',
            password='pw',
        )
        self.spaces = ensure_platform_workspaces(self.owner)
        self.project = ResearchProject.objects.create(
            workspace=self.spaces['research'],
            owner=self.owner,
            title='Project task bridge',
            description='Research creates execution tasks without duplicating the task model.',
        )
        ResearchProjectProfile.objects.create(
            project=self.project,
            status=ResearchProjectProfile.Status.ACTIVE,
        )
        ProjectMembership.objects.create(
            project=self.project,
            user=self.owner,
            role=ProjectMembership.Role.OWNER,
        )
        ProjectMembership.objects.create(
            project=self.project,
            user=self.editor,
            role=ProjectMembership.Role.EDITOR,
        )
        ProjectMembership.objects.create(
            project=self.project,
            user=self.viewer,
            role=ProjectMembership.Role.VIEWER,
        )

    def create_task(self, user, **overrides):
        self.client.force_login(user)
        payload = {
            'title': 'Synthesize evidence',
            'due_date': '2026-09-30',
            'priority': 'p1',
            'definition_of_done': 'Synthesis is written and linked to the project.',
            **overrides,
        }
        return self.client.post(
            f'/api/platform/projects/{self.project.pk}/tasks/',
            data=payload,
            content_type='application/json',
        )

    def test_project_owner_creates_one_core_execution_task_from_research(self):
        response = self.create_task(self.owner)
        self.assertEqual(response.status_code, 201, response.content)

        task = OperatingTask.objects.get(pk=response.json()['task']['id'])
        self.assertEqual(task.workspace_id, self.spaces['core'].pk)
        self.assertEqual(task.project_id, self.project.pk)
        self.assertEqual(task.owner_id, self.owner.pk)
        self.assertEqual(task.initiative.process.key, OperatingProcess.Key.RESEARCH)
        self.assertEqual(policy_for(task).visibility, INHERIT_VISIBILITY)

        cockpit = self.client.get(f'/api/platform/projects/{self.project.pk}/cockpit/')
        self.assertEqual(cockpit.status_code, 200, cockpit.content)
        self.assertIn('Synthesize evidence', {item['title'] for item in cockpit.json()['tasks']})

    def test_project_editor_can_create_task_without_core_workspace_membership(self):
        self.assertFalse(
            WorkspaceMembership.objects.filter(workspace=self.spaces['core'], user=self.editor).exists()
        )
        response = self.create_task(self.editor, title='Editor-owned task')
        self.assertEqual(response.status_code, 201, response.content)
        task = OperatingTask.objects.get(pk=response.json()['task']['id'])
        self.assertEqual(task.workspace_id, self.spaces['core'].pk)
        self.assertEqual(task.owner_id, self.editor.pk)

    def test_project_viewer_cannot_create_task(self):
        response = self.create_task(self.viewer)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertFalse(OperatingTask.objects.filter(project=self.project, owner=self.viewer).exists())

    def test_due_date_is_required_when_project_has_no_deadline(self):
        response = self.create_task(self.owner, due_date='')
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()['error'], 'due_date_required')
