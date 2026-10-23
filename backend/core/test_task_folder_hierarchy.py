"""Guard real nested task hierarchy across Core/Research and compact UI contracts."""
import json
from datetime import date, timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import TestCase, SimpleTestCase, override_settings

from core.models import ResearchProject
from core.operating_models import OperatingTask
from core.platform_runtime_v3 import ensure_platform_workspaces

User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False)
class TaskFolderHierarchyTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='hierarchy@example.test', email='hierarchy@example.test',
            password='SafePassword123!',
        )
        self.spaces = ensure_platform_workspaces(self.user)
        self.client.force_login(self.user)
        self.assertEqual(self.client.get('/api/operating/dashboard/').status_code, 200)
        self.project = ResearchProject.objects.create(
            workspace=self.spaces['research'], owner=self.user, title='Team research project')
        self.other_project = ResearchProject.objects.create(
            workspace=self.spaces['research'], owner=self.user, title='Other research project')
        self.obj = self.send('/api/operating/objectives/', {
            'title': 'Outcome objective', 'owner_id': self.user.pk,
        }).json()['objective']
        self.kr = self.send('/api/operating/key-results/', {
            'title': 'Outcome KR', 'objective_id': self.obj['id'],
            'owner_id': self.user.pk,
        }).json()['key_result']
        self.due = (date.today() + timedelta(days=8)).isoformat()

    def send(self, path, body, method='POST'):
        return getattr(self.client, method.lower())(
            path, json.dumps(body), content_type='application/json')

    def make_parent(self):
        result = self.send('/api/operating/task-board/', {
            'title': 'Parent deliverable', 'owner_id': self.user.pk,
            'key_result_id': self.kr['id'], 'project_id': self.project.pk,
            'due_date': self.due, 'definition_of_done': 'Signed-off result',
            'priority': 'p1', 'status': 'active',
        })
        self.assertEqual(result.status_code, 201, result.content)
        return result.json()['task']['id']

    def test_child_is_real_operating_task_and_inherits_scope(self):
        parent_id = self.make_parent()
        created = self.send('/api/operating/task-board/', {
            'parent_id': parent_id, 'title': 'Research and summarize',
            'definition_of_done': 'Summary reviewed with evidence', 'status': 'active',
        })
        self.assertEqual(created.status_code, 201, created.content)
        child_id = created.json()['task']['id']
        parent = OperatingTask.objects.get(pk=parent_id)
        child = OperatingTask.objects.get(pk=child_id)
        self.assertNotEqual(child_id, parent_id)
        self.assertEqual(child.parent_id, parent_id)
        self.assertEqual(child.project_id, parent.project_id)
        self.assertEqual(child.initiative.key_result_id, parent.initiative.key_result_id)
        self.assertEqual(child.owner_id, parent.owner_id)
        self.assertEqual(child.due_date, parent.due_date)
        self.assertEqual(child.definition_of_done, 'Summary reviewed with evidence')
        detail = self.client.get(f'/api/operating/task-board/{parent_id}/')
        self.assertEqual(detail.status_code, 200, detail.content)
        self.assertEqual(detail.json()['hierarchy']['children'][0]['id'], child_id)
        linked = self.client.get(f'/api/operating/task-board/{child_id}/')
        self.assertEqual(linked.status_code, 200)
        self.assertEqual(linked.json()['hierarchy']['ancestors'][0]['id'], parent_id)
        self.assertEqual(linked.json()['task']['parent_id'], parent_id)
        self.assertEqual(linked.json()['task']['trace']['key_result']['id'], self.kr['id'])
        preview = self.client.get(f'/api/operating/task-board/{parent_id}/?mode=preview')
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.json()['hierarchy']['children'][0]['id'], child_id)

    def test_mismatched_project_or_kr_is_conflict_not_500(self):
        parent_id = self.make_parent()
        result = self.send('/api/operating/task-board/', {
            'parent_id': parent_id, 'project_id': self.other_project.pk,
            'title': 'Wrong project', 'definition_of_done': 'Proof',
        })
        self.assertEqual(result.status_code, 409)
        different = self.send('/api/operating/key-results/', {
            'title': 'Different KR', 'objective_id': self.obj['id'], 'owner_id': self.user.pk,
        }).json()['key_result']
        result = self.send('/api/operating/task-board/', {
            'parent_id': parent_id, 'key_result_id': different['id'],
            'title': 'Wrong KR', 'definition_of_done': 'Proof',
        })
        self.assertEqual(result.status_code, 409)

    def test_parent_cycle_is_rejected_and_existing_data_survives(self):
        parent_id = self.make_parent()
        child = self.send('/api/operating/task-board/', {
            'title': 'First child', 'parent_id': parent_id,
            'definition_of_done': 'Completed with evidence',
        }).json()['task']['id']
        response = self.send(f'/api/operating/task-board/{parent_id}/',
                             {'parent_id': child}, 'PATCH')
        self.assertEqual(response.status_code, 409, response.content)
        self.assertIsNone(OperatingTask.objects.get(pk=parent_id).parent_id)
        self.assertEqual(OperatingTask.objects.get(pk=child).parent_id, parent_id)

    def test_parent_workflow_does_not_erase_child_progress(self):
        parent_id = self.make_parent()
        child_id = self.send('/api/operating/task-board/', {
            'title': 'Child with separate completion', 'parent_id': parent_id,
            'definition_of_done': 'Evidence attached',
        }).json()['task']['id']
        result = self.send(f'/api/operating/task-board/{child_id}/',
                           {'status': 'done'}, 'PATCH')
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(OperatingTask.objects.get(pk=child_id).status, 'done')
        self.assertEqual(OperatingTask.objects.get(pk=parent_id).status, 'active')


class TaskFolderUiContractTests(SimpleTestCase):
    def test_real_subtasks_and_parent_navigation_exist_in_same_task_dialog(self):
        source = (Path(__file__).resolve().parents[2] / 'assets/ws/ws-views.js').read_text()
        for token in [
            "task-family__path", "task-family__children",
            "task-family__details", "Parent task", "Subtasks",
            "parent_id: task.id", "Expected outcome / Definition of done",
            "navTask(created.task.id)", "const moreMenu = el('details'",
            "const mentionSuggestions = el('div', 'task-comment__suggestions')",
            "comment.addEventListener('keydown'", "syncMentionIds()",
            "file.addEventListener('change'", "task-card-dialog__history",
            "const changedRelations = new Set()", "changedRelations.has(name)",
            "payload[name] = control.value ? Number(control.value) : null",
        ]:
            self.assertIn(token, source)
        stylesheet = (Path(__file__).resolve().parents[2] / 'assets/ws/ws.css').read_text()
        self.assertIn(".task-family__crumb", stylesheet)
        self.assertIn(".task-card-dialog__more-items", stylesheet)
        self.assertIn(".task-card-dialog__attach-action", stylesheet)
        self.assertNotIn("Mention teammates", source)
        self.assertNotIn("They will be notified in GraviQuest", source)
        self.assertNotIn("No comments yet.", source)
