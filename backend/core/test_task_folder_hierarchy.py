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

    def test_canonical_subtask_creation_commits_locally_and_queues_native_sync(self):
        """Never block a POST on the remote DAV journal or reject canonical children."""
        from unittest.mock import patch
        from core.canonical_models import CanonicalProject, CanonicalTaskSyncOutbox

        parent_id = self.make_parent()
        CanonicalProject.objects.create(project=self.project, enabled=True)
        import uuid
        request_id = str(uuid.uuid4())
        body = {
            'parent_id': parent_id,
            'title': 'Document current workflow',
            'definition_of_done': 'Reviewed development process document',
            'priority': 'p1', 'owner_id': self.user.pk,
            'client_create_id': request_id,
        }
        # Signal export is forbidden on the request path: it can perform
        # multiple synchronous Nextcloud WebDAV operations and fail after 25s.
        with patch('core.canonical_signals.export_object',
                   side_effect=AssertionError('unexpected synchronous native write')):
            response = self.send('/api/operating/task-board/', body)
        self.assertEqual(response.status_code, 201, response.content)
        child_id = response.json()['task']['id']
        child = OperatingTask.objects.get(pk=child_id)
        self.assertEqual(child.parent_id, parent_id)
        self.assertEqual(child.project_id, self.project.pk)

        job = CanonicalTaskSyncOutbox.objects.get(
            project=self.project, task_id=child_id)
        self.assertEqual(job.generation, 1)
        self.assertEqual(job.state, 'pending')
        self.assertIsNotNone(job.next_attempt_at)

        replay = self.send('/api/operating/task-board/', body)
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertTrue(replay.json()['replayed'])
        self.assertEqual(replay.json()['task']['id'], child_id)
        self.assertEqual(OperatingTask.objects.filter(parent_id=parent_id).count(), 1)
        self.assertEqual(CanonicalTaskSyncOutbox.objects.filter(
            project=self.project, task_id=child_id).count(), 1)

    def test_legacy_canonical_child_create_also_queues_sync(self):
        from core.canonical_models import CanonicalProject, CanonicalTaskSyncOutbox
        from unittest.mock import patch

        parent_id = self.make_parent()
        CanonicalProject.objects.create(project=self.project, enabled=True)
        with patch('core.canonical_signals.export_object',
                   side_effect=AssertionError('remote export in POST')):
            response = self.send('/api/operating/task-board/', {
                'parent_id': parent_id, 'title': 'Legacy subtask',
                'definition_of_done': 'Proof of completion',
            })
        self.assertEqual(response.status_code, 201, response.content)
        task_id = response.json()['task']['id']
        self.assertTrue(CanonicalTaskSyncOutbox.objects.filter(
            project=self.project, task_id=task_id, state='pending').exists())

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


    def test_subtask_create_retries_are_idempotent_and_confirmable(self):
        parent_id = self.make_parent()
        import uuid
        request_id = str(uuid.uuid4())
        body = {
            'parent_id': parent_id,
            'title': 'Documenting current development workflow',
            'definition_of_done': 'A comprehensive review of the current development process',
            'priority': 'p1',
            'owner_id': self.user.pk,
            'client_create_id': request_id,
        }
        before = self.client.get(
            '/api/operating/task-board/',
            {'mode': 'create-status', 'parent_id': parent_id, 'client_request_id': request_id},
        )
        self.assertEqual(before.status_code, 200, before.content)
        self.assertFalse(before.json()['created'])

        first = self.send('/api/operating/task-board/', body)
        self.assertEqual(first.status_code, 201, first.content)
        child_id = first.json()['task']['id']
        self.assertIn('task_create;dur=', first['Server-Timing'])

        replay = self.send('/api/operating/task-board/', body)
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertTrue(replay.json()['replayed'])
        self.assertEqual(replay.json()['task']['id'], child_id)
        self.assertEqual(OperatingTask.objects.filter(parent_id=parent_id).count(), 1)

        status = self.client.get(
            '/api/operating/task-board/',
            {'mode': 'create-status', 'parent_id': parent_id, 'client_request_id': request_id},
        )
        self.assertEqual(status.status_code, 200, status.content)
        self.assertTrue(status.json()['created'])
        self.assertEqual(status.json()['task']['id'], child_id)

        wrong_payload = {**body, 'title': 'Different task title'}
        conflict = self.send('/api/operating/task-board/', wrong_payload)
        self.assertEqual(conflict.status_code, 409, conflict.content)
        self.assertEqual(conflict.json()['error'], 'creation_request_payload_mismatch')

    def test_subtask_create_rejects_bad_keys_and_requires_authenticated_confirmation(self):
        parent_id = self.make_parent()
        body = {
            'parent_id': parent_id, 'title': 'Child', 'definition_of_done': 'Proof',
            'client_create_id': 'not-a-uuid',
        }
        self.assertEqual(self.send('/api/operating/task-board/', body).status_code, 400)
        self.assertEqual(OperatingTask.objects.filter(parent_id=parent_id).count(), 0)
        self.client.logout()
        status = self.client.get('/api/operating/task-board/', {
            'mode': 'create-status', 'parent_id': parent_id,
            'client_request_id': '64aaf30d-1a4c-4c69-b97e-e53bb35fab34',
        })
        self.assertEqual(status.status_code, 401)


class TaskFolderUiContractTests(SimpleTestCase):
    def test_subtask_creation_does_not_wait_for_board_reload_and_can_confirm_timeout(self):
        source = (Path(__file__).resolve().parents[2] / 'assets/ws/ws-views.js').read_text()
        subtask_form = source.split("const createChild = el('form', 'task-family__new');", 1)[1].split(
            "const createDisclosure = el('details', 'task-family__create');", 1)[0]
        self.assertIn('client_create_id: createRequestId', subtask_form)
        self.assertIn('P.operatingTaskCreationStatus(task.id, createRequestId)', subtask_form)
        self.assertIn('navTask(created.task.id)', subtask_form)
        self.assertNotIn('await reloadBoard(', subtask_form)


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
            "const resourceSection = el('section', 'task-card-dialog__resources')",
            "resourceHeader.append(resourceTitle, addResource)",
            "external-links/",
            "let confirmedValues = taskFormValues()", "value !== confirmedValues[key]",
            "[key, control.value ? Number(control.value) : null]",
        ]:
            self.assertIn(token, source)
        stylesheet = (Path(__file__).resolve().parents[2] / 'assets/ws/ws.css').read_text()
        self.assertIn(".task-family__crumb", stylesheet)
        self.assertIn(".task-card-dialog__more-items", stylesheet)
        self.assertIn(".task-card-dialog__attach-action", stylesheet)
        self.assertNotIn("Mention teammates", source)
        self.assertNotIn("They will be notified in GraviQuest", source)
        self.assertNotIn("No comments yet.", source)
        # Task conversations are a single threaded comment stream. The
        # unrelated line-annotation storage remains untouched for notes.
        self.assertNotIn('mountAnchoredComments', source)
        self.assertNotIn('task-card-dialog__advanced-comments', source)
        self.assertIn("const commentsPanel = panel('Comments')", source)
        self.assertIn('P.addOperatingTaskComment(task.id, comment.value.trim(), mentionUserIds)', source)
        # The visible card stays focused: historical provenance is an Activity
        # disclosure, checklist is opt-in, placement is grouped and cached
        # Google status is no longer fetched on every card open.
        self.assertIn("const optionalTools = el('section', 'task-card-dialog__optional-tools')", source)
        self.assertIn("advancedActionItems.prepend(checklistAction)", source)
        self.assertIn("if (!checklistLoaded) loadChecklist()", source)
        self.assertIn("relatedBlock.append(placement, scheduling)", source)
        self.assertIn("if (sourceRecords.length) historyPanel.body.append(sourceHistory)", source)
        self.assertIn("const calendarAction = makeButton('Google Tasks', async () =>", source)
        self.assertNotIn("refreshTaskCalendarState().catch", source)
        self.assertIn("const overflowSteps = pathSteps.filter(step => !primary.includes(step))", source)
        self.assertNotIn("loadChecklist(), loadComments()", source)
