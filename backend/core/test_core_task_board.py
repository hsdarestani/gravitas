import json
import tempfile
from datetime import date, timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from .operating_models import (
    Initiative,
    KeyResult,
    OperatingProcess,
    OperatingTask,
    OperatingTaskAttachment,
    OperatingTaskChecklistItem,
    OperatingTaskComment,
    StrategicObjective,
)
from .platform_runtime_v3 import ensure_platform_workspaces


User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False, CONTENT_ATTACHMENT_MAX_BYTES=100)
class CoreTaskBoardTests(TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.upload_override = override_settings(CORE_UPLOAD_ROOT=Path(self.tmp.name))
        self.upload_override.enable()

        self.user = User.objects.create_user(
            username='task-board@example.test',
            email='task-board@example.test',
            password='Strong-pass-123!',
        )
        self.workspace = ensure_platform_workspaces(self.user)['core']
        self.client.force_login(self.user)
        dashboard = self.client.get('/api/operating/dashboard/')
        self.assertEqual(dashboard.status_code, 200, dashboard.content)
        process = next(item for item in dashboard.json()['processes'] if item['key'] == 'research')

        objective = self.post_json('/api/operating/objectives/', {
            'title': 'Task board objective',
            'quarter': 'Q4 2026',
            'owner_id': self.user.pk,
        }).json()['objective']
        kr = self.post_json('/api/operating/key-results/', {
            'objective_id': objective['id'],
            'title': 'Task board KR',
            'owner_id': self.user.pk,
            'baseline_value': 0,
            'target_value': 100,
            'current_value': 0,
            'unit': '%',
        }).json()['key_result']
        self.initiative = self.post_json('/api/operating/initiatives/', {
            'key_result_id': kr['id'],
            'process_id': process['id'],
            'title': 'Task board initiative',
            'owner_id': self.user.pk,
            'priority': 'p1',
        }).json()['initiative']

    def tearDown(self):
        self.upload_override.disable()
        self.tmp.cleanup()
        super().tearDown()

    def post_json(self, path, payload):
        return self.client.post(path, json.dumps(payload), content_type='application/json')

    def patch_json(self, path, payload):
        return self.client.patch(path, json.dumps(payload), content_type='application/json')

    def create_task(self, title='Board task', status='draft'):
        response = self.post_json('/api/operating/task-board/', {
            'initiative_id': self.initiative['id'],
            'owner_id': self.user.pk,
            'title': title,
            'description': 'Trello card body',
            'definition_of_done': 'Evidence attached and reviewed.',
            'priority': 'p1',
            'status': status,
            'due_date': (date.today() + timedelta(days=7)).isoformat(),
        })
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['task']['id']

    def test_board_lists_real_operating_tasks_and_context(self):
        task_id = self.create_task()
        response = self.client.get('/api/operating/task-board/')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data['can_edit'])
        self.assertIn(task_id, [row['id'] for row in data['tasks']])
        self.assertIn(self.user.pk, [row['id'] for row in data['members']])
        self.assertIn(self.initiative['id'], [row['id'] for row in data['initiatives']])
        task = next(row for row in data['tasks'] if row['id'] == task_id)
        self.assertEqual(task['status'], 'draft')
        self.assertEqual(task['priority'], 'p1')
        self.assertGreater(task['board_order'], 0)

    def test_drag_move_updates_status_and_lane_order(self):
        first = self.create_task('First', 'draft')
        second = self.create_task('Second', 'active')
        moved = self.post_json('/api/operating/task-board/move/', {
            'task_id': first,
            'status': 'active',
            'ordered_ids': [second, first],
        })
        self.assertEqual(moved.status_code, 200, moved.content)
        first_row = OperatingTask.objects.get(pk=first)
        second_row = OperatingTask.objects.get(pk=second)
        self.assertEqual(first_row.status, 'active')
        self.assertLess(second_row.board_order, first_row.board_order)

    def test_card_edit_comment_attachment_and_history(self):
        task_id = self.create_task()
        edited = self.patch_json(f'/api/operating/task-board/{task_id}/', {
            'title': 'Updated task title',
            'priority': 'p0',
            'status': 'blocked',
            'owner_id': self.user.pk,
            'initiative_id': self.initiative['id'],
            'due_date': (date.today() + timedelta(days=5)).isoformat(),
            'definition_of_done': 'Updated done definition.',
            'blocked_reason': 'Waiting on source material.',
            'milestone_id': None,
            'work_package_id': None,
            'cycle_id': None,
            'project_id': None,
            'meeting_id': None,
            'dependency_id': None,
        })
        self.assertEqual(edited.status_code, 200, edited.content)
        self.assertEqual(edited.json()['task']['status'], 'blocked')
        self.assertEqual(edited.json()['task']['priority'], 'p0')

        comment = self.post_json(f'/api/operating/tasks/{task_id}/comments/', {
            'body': 'This comment belongs to the Trello card.',
        })
        self.assertEqual(comment.status_code, 201, comment.content)
        self.assertTrue(OperatingTaskComment.objects.filter(task_id=task_id).exists())

        good = self.client.post(
            f'/api/operating/tasks/{task_id}/attachments/',
            {'file': SimpleUploadedFile('brief.txt', b'12345', content_type='text/plain')},
        )
        self.assertEqual(good.status_code, 201, good.content)
        attachment = OperatingTaskAttachment.objects.get(task_id=task_id)
        self.assertTrue(Path(attachment.storage_path).exists())

        too_big = self.client.post(
            f'/api/operating/tasks/{task_id}/attachments/',
            {'file': SimpleUploadedFile('large.txt', b'x' * 101, content_type='text/plain')},
        )
        self.assertEqual(too_big.status_code, 413)

        history = self.client.get(f'/api/operating/tasks/{task_id}/history/')
        self.assertEqual(history.status_code, 200, history.content)
        actions = {row['action'] for row in history.json()['events']}
        self.assertIn('task.created', actions)
        self.assertIn('task.updated', actions)
        self.assertIn('task.comment_added', actions)
        self.assertIn('task.attachment_added', actions)


    def test_checklist_crud_updates_board_progress_and_history(self):
        task_id = self.create_task()

        first = self.post_json(f'/api/operating/tasks/{task_id}/checklist/', {
            'title': 'Collect source pack',
        })
        self.assertEqual(first.status_code, 201, first.content)
        first_id = first.json()['item']['id']

        second = self.post_json(f'/api/operating/tasks/{task_id}/checklist/', {
            'title': 'Review evidence map',
        })
        self.assertEqual(second.status_code, 201, second.content)
        second_id = second.json()['item']['id']
        self.assertEqual(OperatingTaskChecklistItem.objects.filter(task_id=task_id).count(), 2)

        completed = self.patch_json(
            f'/api/operating/tasks/{task_id}/checklist/{first_id}/',
            {'is_completed': True},
        )
        self.assertEqual(completed.status_code, 200, completed.content)
        self.assertTrue(completed.json()['item']['is_completed'])
        self.assertIsNotNone(completed.json()['item']['completed_at'])

        renamed = self.patch_json(
            f'/api/operating/tasks/{task_id}/checklist/{second_id}/',
            {'title': 'Approve evidence map'},
        )
        self.assertEqual(renamed.status_code, 200, renamed.content)
        self.assertEqual(renamed.json()['item']['title'], 'Approve evidence map')

        listing = self.client.get(f'/api/operating/tasks/{task_id}/checklist/')
        self.assertEqual(listing.status_code, 200, listing.content)
        self.assertEqual([row['id'] for row in listing.json()['items']], [first_id, second_id])

        board = self.client.get('/api/operating/task-board/')
        self.assertEqual(board.status_code, 200, board.content)
        row = next(item for item in board.json()['tasks'] if item['id'] == task_id)
        self.assertEqual(row['checklist_count'], 2)
        self.assertEqual(row['checklist_completed_count'], 1)

        deleted = self.client.delete(f'/api/operating/tasks/{task_id}/checklist/{second_id}/')
        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.assertFalse(OperatingTaskChecklistItem.objects.filter(pk=second_id).exists())

        history = self.client.get(f'/api/operating/tasks/{task_id}/history/')
        actions = {row['action'] for row in history.json()['events']}
        self.assertIn('task.checklist_item_added', actions)
        self.assertIn('task.checklist_item_completed', actions)
        self.assertIn('task.checklist_item_updated', actions)
        self.assertIn('task.checklist_item_deleted', actions)

    def test_attachment_download_and_delete_are_scoped_to_task(self):
        task_id = self.create_task()
        uploaded = self.client.post(
            f'/api/operating/tasks/{task_id}/attachments/',
            {'file': SimpleUploadedFile('scope.txt', b'scoped', content_type='text/plain')},
        )
        attachment_id = uploaded.json()['attachment']['id']
        download = self.client.get(
            f'/api/operating/tasks/{task_id}/attachments/{attachment_id}/download/'
        )
        self.assertEqual(download.status_code, 200)
        delete = self.client.delete(
            f'/api/operating/tasks/{task_id}/attachments/{attachment_id}/'
        )
        self.assertEqual(delete.status_code, 200)
        self.assertFalse(OperatingTaskAttachment.objects.filter(pk=attachment_id).exists())


class CoreTaskBoardFrontendContractTests(TestCase):
    def test_workspace_task_view_is_trello_board_with_collaboration(self):
        root = Path(__file__).resolve().parents[2]
        views = (root / 'assets/ws/ws-views.js').read_text(encoding='utf-8')
        css = (root / 'assets/ws/ws.css').read_text(encoding='utf-8')
        platform = (root / 'assets/ws/ws-platform.js').read_text(encoding='utf-8')

        self.assertIn('task-trello-board', views)
        self.assertIn("card.draggable = true", views)
        self.assertIn('uploadOperatingTaskAttachment', views)
        self.assertIn('addOperatingTaskComment', views)
        self.assertIn('operatingTaskHistory', views)
        self.assertIn('operatingTaskChecklist', views)
        self.assertIn('addOperatingTaskChecklistItem', views)
        self.assertIn('task-checklist__item', views)
        self.assertIn('moveOperatingTask', views)
        self.assertIn('.task-card-dialog', css)
        self.assertIn('.task-checklist__item', css)
        self.assertIn("export const operatingTaskBoard", platform)
        self.assertIn("export const operatingTaskChecklist", platform)
