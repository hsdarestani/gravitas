import uuid
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import Client, TestCase

from core.canonical_models import CanonicalProject, CanonicalTaskSyncOutbox
from core.canonical_projects import suppress
from core.models import ProjectMembership, ResearchProject, WorkspaceMembership
from core.operating_models import OperatingTask, WorkStatus
from core.platform_access import can_view, policy_for
from core.platform_models import AccessGrant, ObjectPolicy
from core.platform_runtime_v3 import ensure_platform_workspaces


class TaskWorkflowTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user
        self.author = user('flow-author@example.test')
        self.reviewer = user('flow-reviewer@example.test')
        self.viewer = user('flow-viewer@example.test')
        spaces = ensure_platform_workspaces(self.author)
        self.core = spaces['core']
        self.project = ResearchProject.objects.create(
            workspace=spaces['research'], owner=self.author, title='Workflow project',
        )
        for member, role in ((self.reviewer, 'editor'), (self.viewer, 'viewer')):
            ProjectMembership.objects.create(project=self.project, user=member, role=role)
        self.project_tasks = f'/api/platform/projects/{self.project.pk}/tasks/'
        self.clients = {}
        for member in (self.author, self.reviewer, self.viewer):
            client = Client()
            client.force_login(member)
            self.clients[member.pk] = client

    def client_as(self, user):
        return self.clients[user.pk]

    def create_project_task(self, template='video', **kwargs):
        response = self.client_as(self.author).post(self.project_tasks, {
            'title': 'New deliverable', 'workflow': {'template': template, **kwargs},
        }, content_type='application/json')
        self.assertEqual(response.status_code, 201, response.content)
        task = OperatingTask.objects.get(pk=response.json()['task']['id'])
        return task, f'{self.project_tasks}{task.pk}/workflow/'

    def state(self, url, actor=None):
        response = self.client_as(actor or self.author).get(url)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()['workflow']

    def action(self, url, state, name, actor=None, status=200, **fields):
        response = self.client_as(actor or self.author).post(url, {
            'action': name, 'revision': state['revision'], **fields,
        }, content_type='application/json')
        self.assertEqual(response.status_code, status, response.content)
        return response.json().get('workflow') or response.json()['error']

    def complete_steps(self, url, state):
        for step in state['steps']:
            state = self.action(url, state, 'complete_step', step=step['id'])
        return state

    def test_project_video_iteration_and_final_approval(self):
        task, url = self.create_project_task()
        state = self.state(url)
        music = state['parts'][0]
        self.assertEqual(music['name'], 'Music')
        self.assertEqual(len(state['steps']), 6)
        self.assertEqual(task.subtasks.filter(project=self.project, workspace=self.core).count(), 6)
        initial = {'part': music['id'], 'iteration': 1, 'items': music['iterations'][0]['items']}
        self.assertEqual(self.action(url, state, 'submit', status=409, **initial), 'workflow_finish_steps')
        first = state
        state = self.complete_steps(url, state)
        self.assertTrue(state['steps_done'])
        self.assertEqual(self.action(url, first, 'finalize', status=409), 'workflow_changed')
        self.assertEqual(self.action(url, state, 'finalize', status=409), 'workflow_approval_required')
        self.assertEqual(self.action(url, state, 'submit', status=400, **initial), 'workflow_preview_required')
        evidence = {'preview': 'https://example.test/video-1', 'reference': 'https://example.test/brief'}
        self.assertEqual(self.action(url, state, 'submit', status=400, **initial, **evidence), 'workflow_finish_checklist')
        items = [{**item, 'done': True} for item in initial['items']]
        items.append({'text': 'Listen on speakers', 'done': True})
        initial['items'] = items
        state = self.action(url, state, 'save', **initial, **evidence)
        initial['items'] = state['parts'][0]['iterations'][0]['items']
        state = self.action(url, state, 'submit', **initial, **evidence)
        review = {'part': music['id'], 'iteration': 1}
        self.assertEqual(self.action(url, state, 'approve', status=403, **review), 'workflow_reviewer_required')
        self.assertEqual(self.action(url, state, 'comment', self.viewer, status=403, **review), 'permission_denied')
        state = self.action(url, state, 'comment', self.reviewer, feedback='The track is clear.', **review)
        state = self.action(url, state, 'request_changes', self.reviewer, feedback='Lower the intro volume', **review)
        original, new = state['parts'][0]['iterations']
        self.assertEqual(original['status'], 'changes_requested')
        self.assertEqual(original['preview'], evidence['preview'])
        self.assertEqual(len(original['comments']), 2)
        self.assertEqual(new['number'], 2)
        self.assertEqual(new['items'][-1]['text'], 'Lower the intro volume')
        self.assertFalse(new['items'][-1]['done'])
        self.assertEqual(self.action(
            url, state, 'save', status=400, part=music['id'], iteration=2, items=new['items'][:-1],
        ), 'workflow_keep_requested_fixes')
        self.assertEqual(self.action(url, state, 'approve', self.reviewer, status=409, **review), 'workflow_iteration_closed')
        for part in state['parts']:
            latest = part['iterations'][-1]
            key = {'part': part['id'], 'iteration': latest['number']}
            state = self.action(url, state, 'submit', **key, preview='https://example.test/video-2',
                                items=[{**item, 'done': True} for item in latest['items']])
            state = self.action(url, state, 'approve', self.reviewer, **key)
        task.refresh_from_db()
        self.assertNotEqual(task.status, WorkStatus.DONE)
        state = self.action(url, state, 'finalize', self.reviewer)
        self.assertEqual(state['final_approval']['by']['id'], self.reviewer.pk)
        self.assertEqual(self.state(url)['status'], 'done')
        task.refresh_from_db()
        self.assertIsNotNone(task.completed_at)

    def test_legacy_status_writes_cannot_bypass_qa(self):
        task, url = self.create_project_task('essay')
        state = self.state(url)
        client = self.client_as(self.author)
        project_detail = f'{self.project_tasks}{task.pk}/'
        response = client.patch(project_detail, {'status': 'done'}, content_type='application/json')
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()['error'], 'workflow_approval_required')
        WorkspaceMembership.objects.get_or_create(workspace=self.core, user=self.author, defaults={'role': 'member'})
        for path in (f'/api/operating/task-board/{task.pk}/', f'/api/platform/tasks/{task.pk}/'):
            response = client.patch(path, {'status': 'done'}, content_type='application/json')
            self.assertEqual(response.status_code, 409, response.content)
        moved = client.post('/api/operating/task-board/move/', {
            'task_id': task.pk, 'status': 'done', 'ordered_ids': [task.pk],
        }, content_type='application/json')
        self.assertEqual(moved.status_code, 409, moved.content)
        self.assertEqual(moved.json()['error'], 'workflow_approval_required')
        with self.assertRaises(IntegrityError), transaction.atomic():
            OperatingTask.objects.filter(pk=task.pk).update(status='done')
        step = state['steps'][0]
        deleted = client.delete(f'/api/operating/task-board/{step["id"]}/')
        self.assertEqual(deleted.status_code, 409, deleted.content)
        self.action(url, state, 'complete_step', step=step['id'])
        response = client.patch(f'{self.project_tasks}{step["id"]}/', {'status': 'active'}, content_type='application/json')
        self.assertEqual(response.status_code, 409, response.content)
        task.refresh_from_db()
        self.assertEqual(task.status, WorkStatus.ACTIVE)

    def test_graphic_design_is_configurable_and_create_replays_once(self):
        client = self.client_as(self.author)
        config = {
            'template': 'graphic_design', 'steps': ['Sketch', 'Layout'],
            'parts': ['Typography', 'Export'], 'creation_id': str(uuid.uuid4()),
        }
        payload = {'title': 'Design a cover', 'workflow': config}
        first = client.post(self.project_tasks, payload, content_type='application/json')
        replay = client.post(self.project_tasks, payload, content_type='application/json')
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(first.json()['task']['id'], replay.json()['task']['id'])
        self.assertEqual(OperatingTask.objects.filter(project=self.project).count(), 3)
        url = f'{self.project_tasks}{first.json()["task"]["id"]}/workflow/'
        self.assertEqual([part['name'] for part in self.state(url)['parts']], config['parts'])
        altered = client.post(self.project_tasks, {**payload, 'title': 'Different'}, content_type='application/json')
        self.assertEqual(altered.status_code, 409, altered.content)
        invalid = client.post(self.project_tasks, {
            'title': 'Invalid', 'workflow': {'template': 'graphic_design', 'steps': ['Sketch'], 'parts': []},
        }, content_type='application/json')
        self.assertEqual(invalid.status_code, 400, invalid.content)
        self.assertFalse(OperatingTask.objects.filter(title='Invalid').exists())

    def test_core_development_uses_the_same_steps_and_board(self):
        WorkspaceMembership.objects.get_or_create(workspace=self.core, user=self.author, defaults={'role': 'member'})
        client = self.client_as(self.author)
        payload = {
            'title': 'Ship a feature', 'definition_of_done': 'Feature is ready',
            'priority': 'p2', 'owner_id': self.author.pk, 'status': 'active',
            'workflow': {'template': 'development', 'creation_id': str(uuid.uuid4())},
        }
        response = client.post('/api/operating/task-board/', payload, content_type='application/json')
        self.assertEqual(response.status_code, 201, response.content)
        task_id = response.json()['task']['id']
        self.assertEqual(response.json()['task']['workflow_state'], 'pending')
        state = self.state(f'/api/operating/tasks/{task_id}/workflow/')
        self.assertEqual([step['title'] for step in state['steps']], ['Scope', 'Build', 'Test', 'Prepare preview'])
        self.assertEqual([part['name'] for part in state['parts']], ['Functionality', 'UI'])
        replay = client.post('/api/operating/task-board/', payload, content_type='application/json')
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(replay.json()['task']['id'], task_id)
        legacy = client.post('/api/operating/task-board/', {
            key: value for key, value in payload.items() if key != 'workflow'
        }, content_type='application/json')
        self.assertEqual(legacy.status_code, 201, legacy.content)
        response = client.patch(f'/api/operating/task-board/{legacy.json()["task"]["id"]}/',
                                {'status': 'done'}, content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)

    def test_project_workflow_steps_inherit_the_selected_milestone(self):
        client = self.client_as(self.author)
        milestone = client.post(f'/api/platform/projects/{self.project.pk}/milestones/', {
            'title': 'Finish writing', 'due_date': '2026-12-15',
        }, content_type='application/json')
        self.assertEqual(milestone.status_code, 201, milestone.content)
        milestone_id = milestone.json()['milestone']['id']
        response = client.post(self.project_tasks, {
            'title': 'Write the essay', 'milestone_id': milestone_id, 'workflow': {'template': 'essay'},
        }, content_type='application/json')
        self.assertEqual(response.status_code, 201, response.content)
        task = OperatingTask.objects.get(pk=response.json()['task']['id'])
        self.assertEqual(task.milestone_id, milestone_id)
        self.assertEqual(task.subtasks.filter(milestone_id=milestone_id).count(), 4)

    def test_project_permissions_and_async_canonical_sync(self):
        CanonicalProject.objects.create(project=self.project, enabled=True)
        with patch('core.canonical_middleware.refresh_project', side_effect=AssertionError('DAV in task request')):
            task, url = self.create_project_task('essay')
            step_ids = set(task.subtasks.values_list('pk', flat=True))
            self.assertSetEqual(
                set(CanonicalTaskSyncOutbox.objects.filter(project=self.project).values_list('task_id', flat=True)),
                {task.pk} | step_ids,
            )
            state = self.state(url, self.viewer)
            self.assertFalse(state['can_edit'])
            self.assertEqual(self.action(url, state, 'complete_step', self.viewer, status=403, step=state['steps'][0]['id']),
                             'permission_denied')
            state = self.action(url, state, 'complete_step', self.reviewer, step=state['steps'][0]['id'])
            job = CanonicalTaskSyncOutbox.objects.get(task_id=state['steps'][0]['id'])
            self.assertEqual(job.generation, 2)
        policy = policy_for(task)
        ObjectPolicy.objects.filter(pk=policy.pk).update(visibility='specific')
        self.assertFalse(can_view(self.viewer, task.subtasks.first()))
        self.assertEqual(self.client_as(self.viewer).get(url).status_code, 404)
        with suppress():
            AccessGrant.objects.create(
                content_type=policy.content_type, object_id=task.pk, user=self.viewer, role='comment',
            )
        self.assertTrue(can_view(self.viewer, task.subtasks.first()))
        self.assertTrue(self.state(url, self.viewer)['can_comment'])
