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


    def test_project_editor_updates_the_existing_task_without_creating_a_copy(self):
        created = self.create_task(self.owner)
        task_id = created.json()['task']['id']
        self.client.force_login(self.editor)
        response = self.client.patch(
            f'/api/platform/projects/{self.project.pk}/tasks/{task_id}/',
            data={'status': 'blocked', 'blocked_reason': 'Awaiting source verification'},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(OperatingTask.objects.filter(project=self.project).count(), 1)
        task = OperatingTask.objects.get(pk=task_id)
        self.assertEqual(task.status, 'blocked')
        self.assertEqual(task.blocked_reason, 'Awaiting source verification')

    def test_project_viewer_cannot_mutate_project_task(self):
        created = self.create_task(self.owner)
        task_id = created.json()['task']['id']
        self.client.force_login(self.viewer)
        response = self.client.patch(
            f'/api/platform/projects/{self.project.pk}/tasks/{task_id}/',
            data={'status': 'done'}, content_type='application/json',
        )
        self.assertEqual(response.status_code, 403, response.content)
        self.assertNotEqual(OperatingTask.objects.get(pk=task_id).status, 'done')

    def test_rejects_dependency_cycle_and_project_reassignment(self):
        created = self.create_task(self.owner)
        task_id = created.json()['task']['id']
        self.client.force_login(self.owner)
        circular = self.client.patch(
            f'/api/platform/projects/{self.project.pk}/tasks/{task_id}/',
            data={'dependency_id': task_id}, content_type='application/json',
        )
        self.assertEqual(circular.status_code, 400, circular.content)
        self.assertEqual(circular.json()['error'], 'dependency_cycle')
        reassignment = self.client.patch(
            f'/api/platform/projects/{self.project.pk}/tasks/{task_id}/',
            data={'project_id': 999}, content_type='application/json',
        )
        self.assertEqual(reassignment.status_code, 400, reassignment.content)


    def _time(self, user, task_id, action=None, **fields):
        self.client.force_login(user)
        url = f'/api/platform/projects/{self.project.pk}/tasks/{task_id}/time/'
        if action is None:
            return self.client.get(url)
        return self.client.post(
            url, data={'action': action, **fields}, content_type='application/json')

    def test_work_log_is_one_human_editable_note_with_cross_device_timer(self):
        from core.models import KnowledgeResource
        task_id = self.create_task(self.owner).json()['task']['id']
        first = self._time(self.owner, task_id, 'start')
        self.assertEqual(first.status_code, 200, first.content)
        self.assertTrue(first.json()['my_active_started_at'])
        repeated = self._time(self.owner, task_id, 'start')
        self.assertEqual(repeated.status_code, 409)
        stopped = self._time(self.owner, task_id, 'stop', note='Drafted research findings')
        self.assertEqual(stopped.status_code, 200, stopped.content)
        self.assertEqual(stopped.json()['entry_count'], 1)
        self.assertIsNone(stopped.json()['my_active_started_at'])
        note = KnowledgeResource.objects.get(project=self.project, metadata__pm_type='task_time_log_v1')
        self.assertEqual(note.metadata['task_id'], task_id)
        self.assertIn('Drafted research findings', note.body)
        self.assertEqual(KnowledgeResource.objects.filter(project=self.project, metadata__pm_type='task_time_log_v1').count(), 1)

    def test_manual_work_log_and_team_visibility(self):
        task_id = self.create_task(self.owner).json()['task']['id']
        written = self._time(self.owner, task_id, 'log', minutes=35, date='2026-09-29', note='Analysis | review')
        self.assertEqual(written.status_code, 200, written.content)
        self.assertEqual(written.json()['total_minutes'], 35)
        self.assertEqual(written.json()['entries'][0]['note'], 'Analysis | review')
        viewed = self._time(self.viewer, task_id)
        self.assertEqual(viewed.status_code, 200, viewed.content)
        self.assertEqual(viewed.json()['total_minutes'], 35)
        rejected = self._time(self.viewer, task_id, 'log', minutes=25, date='2026-09-29')
        self.assertEqual(rejected.status_code, 403, rejected.content)

    def test_work_log_rejects_invalid_external_markdown_without_rewriting(self):
        from core.models import KnowledgeResource
        task_id = self.create_task(self.owner).json()['task']['id']
        self._time(self.owner, task_id, 'log', minutes=10, date='2026-09-29')
        note = KnowledgeResource.objects.get(project=self.project, metadata__pm_type='task_time_log_v1')
        note.body += '\nnot a valid time log row'
        note.save()
        response = self._time(self.owner, task_id)
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()['error'], 'work_log_entry_invalid')

    def test_work_log_rejects_future_manual_date_and_overlong_duration(self):
        task_id = self.create_task(self.owner).json()['task']['id']
        invalid = self._time(self.owner, task_id, 'log', minutes=721, date='2026-09-29')
        self.assertEqual(invalid.status_code, 400)
        future = self._time(self.owner, task_id, 'log', minutes=10, date='2099-01-01')
        self.assertEqual(future.status_code, 400)
