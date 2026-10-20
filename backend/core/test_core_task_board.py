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
    TaskInAppNotification,
    TaskNotificationOutbox,
    TaskNotificationPreference,
    StrategicObjective,
)
from .models import WorkspaceMembership
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

    def test_task_dependency_picker_loads_only_ids_and_titles(self):
        first = self.create_task('Task in Core')
        second = self.create_task('Task from another project')
        response = self.client.get('/api/operating/task-board/?mode=dependencies')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual({row['id'] for row in data['tasks']}, {first, second})
        self.assertTrue(all(set(row) == {'id', 'title'} for row in data['tasks']))
        self.assertNotIn('key_results', data)
        self.assertNotIn('members', data)
        # The full board still supplies its complete, editable payload.
        full = self.client.get('/api/operating/task-board/').json()
        self.assertIn('members', full)
        self.assertIn('key_results', full)
        self.assertEqual({row['id'] for row in full['tasks']}, {first, second})

    def test_detail_has_editor_choices_when_opened_from_research_without_board(self):
        task_id = self.create_task('Research dialog opens directly')
        response = self.client.get(f'/api/operating/task-board/{task_id}/')
        self.assertEqual(response.status_code, 200, response.content)
        detail = response.json()
        self.assertEqual(detail['task']['id'], task_id)
        self.assertIn('members', detail)
        self.assertIn('key_results', detail)
        self.assertIn('projects', detail)
        self.assertTrue(any(row['value'] == detail['task']['priority']
                            for row in detail['priorities']))
        self.assertTrue(any(row['value'] == detail['task']['status']
                            for row in detail['statuses']))
        self.assertEqual(
            {row['value'] for row in detail['priorities']},
            {'p0', 'p1', 'p2', 'p3'},
        )
        self.assertIn('done', {row['value'] for row in detail['statuses']})

    def test_fast_direct_task_preview_skips_heavy_editor_choices(self):
        task_id = self.create_task('Quick task preview')
        response = self.client.get(f'/api/operating/task-board/{task_id}/?mode=preview')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data['task']['id'], task_id)
        self.assertEqual(data['task']['title'], 'Quick task preview')
        self.assertIn('status', data['task'])
        self.assertNotIn('members', data)
        self.assertNotIn('key_results', data)

    def test_board_aggregates_independent_comment_attachment_and_checklist_counts(self):
        task_id = self.create_task('Counted task')
        other_id = self.create_task('Another task')
        for i in range(3):
            response = self.post_json(f'/api/operating/tasks/{task_id}/comments/',
                                      {'body': f'Comment {i}'})
            self.assertEqual(response.status_code, 201, response.content)
        for i in range(2):
            response = self.client.post(
                f'/api/operating/tasks/{task_id}/attachments/',
                {'file': SimpleUploadedFile(f'source{i}.txt', b'content', content_type='text/plain')},
            )
            self.assertEqual(response.status_code, 201, response.content)
        checklist_ids = []
        for i in range(4):
            response = self.post_json(f'/api/operating/tasks/{task_id}/checklist/',
                                      {'title': f'Step {i}'})
            self.assertEqual(response.status_code, 201, response.content)
            checklist_ids.append(response.json()['item']['id'])
        for item_id in checklist_ids[:2]:
            response = self.patch_json(
                f'/api/operating/tasks/{task_id}/checklist/{item_id}/',
                {'is_completed': True},
            )
            self.assertEqual(response.status_code, 200, response.content)
        response = self.client.get('/api/operating/task-board/')
        self.assertEqual(response.status_code, 200, response.content)
        rows = {row['id']: row for row in response.json()['tasks']}
        self.assertEqual(
            tuple(rows[task_id][key] for key in
                  ('comment_count', 'attachment_count', 'checklist_count', 'checklist_completed_count')),
            (3, 2, 4, 2),
        )
        self.assertEqual(
            tuple(rows[other_id][key] for key in
                  ('comment_count', 'attachment_count', 'checklist_count', 'checklist_completed_count')),
            (0, 0, 0, 0),
        )

    def test_standalone_task_without_key_result_keeps_one_shared_identity(self):
        from datetime import date, timedelta

        response = self.post_json('/api/operating/task-board/', {
            'owner_id': self.user.pk,
            'title': 'Independent Core task',
            'description': 'No project or KR needed',
            'definition_of_done': 'Completed and reviewed',
            'priority': 'p2',
            'status': 'draft',
            'due_date': (date.today() + timedelta(days=3)).isoformat(),
        })
        self.assertEqual(response.status_code, 201, response.content)
        task_id = response.json()['task']['id']
        task = OperatingTask.objects.get(pk=task_id)
        self.assertIsNone(task.initiative_id)
        self.assertIsNone(task.project_id)

        cleared = self.patch_json(f'/api/operating/task-board/{task_id}/', {'due_date': None})
        self.assertEqual(cleared.status_code, 200, cleared.content)
        task.refresh_from_db()
        self.assertIsNone(task.due_date)

        board = self.client.get('/api/operating/task-board/')
        self.assertEqual(board.status_code, 200, board.content)
        entry = next(item for item in board.json()['tasks'] if item['id'] == task_id)
        self.assertIsNone(entry['trace']['key_result']['id'])
        self.assertEqual(entry['initiative_title'], '')

        details = self.client.get(f'/api/operating/task-board/{task_id}/')
        self.assertEqual(details.status_code, 200, details.content)
        updated = self.patch_json(f'/api/operating/task-board/{task_id}/', {
            'description': 'Still the same object without KR',
        })
        self.assertEqual(updated.status_code, 200, updated.content)
        self.assertIsNone(updated.json()['task']['initiative_id'])
        task.refresh_from_db()
        self.assertEqual(task.description, 'Still the same object without KR')

        # Adding and then removing a KR does not replace the task ID.
        kr = KeyResult.objects.filter(objective__workspace=self.workspace).first()
        attached = self.patch_json(f'/api/operating/task-board/{task_id}/', {
            'key_result_id': kr.pk,
            'due_date': (date.today() + timedelta(days=3)).isoformat(),
        })
        self.assertEqual(attached.status_code, 200, attached.content)
        self.assertIsNotNone(attached.json()['task']['initiative_id'])
        unlinked = self.patch_json(f'/api/operating/task-board/{task_id}/', {
            'key_result_id': None,
        })
        self.assertEqual(unlinked.status_code, 200, unlinked.content)
        self.assertEqual(unlinked.json()['task']['id'], task_id)
        self.assertIsNone(unlinked.json()['task']['initiative_id'])

    def test_task_change_by_teammate_enqueues_owner_email_notification(self):
        task_id = self.create_task()
        teammate = User.objects.create_user(
            username='task-editor@example.test',
            email='task-editor@example.test',
            password='Strong-pass-123!',
        )
        WorkspaceMembership.objects.create(
            workspace=self.workspace,
            user=teammate,
            role=WorkspaceMembership.Role.MEMBER,
        )
        self.client.force_login(teammate)
        response = self.patch_json(f'/api/operating/task-board/{task_id}/', {
            'title': 'Changed by teammate',
        })
        self.assertEqual(response.status_code, 200, response.content)
        delivery = TaskNotificationOutbox.objects.get(
            recipient=self.user,
            channel=TaskNotificationOutbox.Channel.EMAIL,
        )
        self.assertEqual(delivery.task_id, task_id)
        self.assertEqual(delivery.event_type, 'task.updated')
        self.assertIn('Title:', delivery.body)

    def test_comment_mentions_notify_in_app_email_and_telegram(self):
        task_id = self.create_task('Mentioned task')
        teammate = User.objects.create_user(
            username='mention-editor@example.test',
            email='mention-editor@example.test',
            password='Strong-pass-123!',
            first_name='Mention',
        )
        WorkspaceMembership.objects.create(
            workspace=self.workspace,
            user=teammate,
            role=WorkspaceMembership.Role.MEMBER,
        )
        TaskNotificationPreference.objects.update_or_create(
            user=self.user,
            defaults={
                'email_enabled': True,
                'telegram_enabled': True,
                'task_changes_enabled': True,
                'telegram_chat_id': 987654321,
            },
        )
        self.client.force_login(teammate)
        response = self.post_json(f'/api/operating/tasks/{task_id}/comments/', {
            'body': 'Please review this result.',
            'mention_user_ids': [self.user.pk],
        })
        self.assertEqual(response.status_code, 201, response.content)
        comment = OperatingTaskComment.objects.get(pk=response.json()['comment']['id'])
        self.assertEqual(list(comment.mentions.values_list('pk', flat=True)), [self.user.pk])

        notice = TaskInAppNotification.objects.get(recipient=self.user)
        self.assertEqual(notice.event_type, 'task.mentioned')
        self.assertEqual(notice.task_id, task_id)
        self.assertFalse(notice.read_at)

        channels = set(
            TaskNotificationOutbox.objects.filter(
                recipient=self.user,
                event_type='task.mentioned',
            ).values_list('channel', flat=True)
        )
        self.assertEqual(
            channels,
            {TaskNotificationOutbox.Channel.EMAIL, TaskNotificationOutbox.Channel.TELEGRAM},
        )

        self.client.force_login(self.user)
        inbox = self.client.get('/api/task-notifications/in-app/')
        self.assertEqual(inbox.status_code, 200, inbox.content)
        self.assertEqual(inbox.json()['unread_count'], 1)
        marked = self.patch_json('/api/task-notifications/in-app/', {'ids': [notice.pk]})
        self.assertEqual(marked.status_code, 200, marked.content)
        self.assertEqual(marked.json()['unread_count'], 0)


    def test_only_admin_or_owner_can_delete_task(self):
        task_id = self.create_task('Protected delete task')
        teammate = User.objects.create_user(
            username='task-delete-member@example.test',
            email='task-delete-member@example.test',
            password='Strong-pass-123!',
        )
        WorkspaceMembership.objects.create(
            workspace=self.workspace,
            user=teammate,
            role=WorkspaceMembership.Role.MEMBER,
        )

        self.client.force_login(teammate)
        detail = self.client.get(f'/api/operating/task-board/{task_id}/')
        self.assertEqual(detail.status_code, 200, detail.content)
        self.assertFalse(detail.json()['can_delete'])
        denied = self.client.delete(f'/api/operating/task-board/{task_id}/')
        self.assertEqual(denied.status_code, 403, denied.content)
        self.assertTrue(OperatingTask.objects.filter(pk=task_id).exists())

        self.client.force_login(self.user)
        detail = self.client.get(f'/api/operating/task-board/{task_id}/')
        self.assertTrue(detail.json()['can_delete'])
        deleted = self.client.delete(f'/api/operating/task-board/{task_id}/')
        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.assertFalse(OperatingTask.objects.filter(pk=task_id).exists())

    def test_board_lists_real_operating_tasks_and_context(self):
        task_id = self.create_task()
        response = self.client.get('/api/operating/task-board/')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data['can_edit'])
        self.assertTrue(data['can_delete'])
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


    def historical_task(self, status='done'):
        return OperatingTask.objects.create(workspace=self.workspace, initiative_id=self.initiative['id'],
            owner=self.user, title='Historical implementation', definition_of_done='Source-reported output',
            source_key='history:one', source_metadata={'activity_date_raw':'2026-09-07'}, status=status)

    def test_source_history_can_be_edited_without_inventing_deadline_or_completion(self):
        task=self.historical_task()
        response=self.patch_json(f'/api/operating/task-board/{task.pk}/', {'priority':'p1','status':'done'})
        self.assertEqual(response.status_code,200,response.content)
        task.refresh_from_db()
        self.assertIsNone(task.due_date)
        self.assertIsNone(task.completed_at)
        self.assertEqual(task.source_metadata['activity_date_raw'],'2026-09-07')

    def test_explicit_new_completion_of_source_task_records_current_transition(self):
        task=self.historical_task('active')
        response=self.patch_json(f'/api/operating/task-board/{task.pk}/', {'status':'done'})
        self.assertEqual(response.status_code,200,response.content)
        task.refresh_from_db()
        self.assertIsNotNone(task.completed_at)
        self.assertIsNone(task.due_date)

    def test_ordinary_initiative_task_still_requires_planning_date(self):
        task_id=self.create_task()
        response=self.patch_json(f'/api/operating/task-board/{task_id}/', {'due_date':None})
        self.assertEqual(response.status_code,400)
        self.assertEqual(response.json()['error'],'task_requires_due_date')


class CoreTaskBoardFrontendContractTests(TestCase):
    def test_workspace_task_view_is_trello_board_with_collaboration(self):
        root = Path(__file__).resolve().parents[2]
        views = (root / 'assets/ws/ws-views.js').read_text(encoding='utf-8')
        css = (root / 'assets/ws/ws.css').read_text(encoding='utf-8')
        design = (root / 'assets/ws/ws-unified-design.css').read_text(encoding='utf-8')
        platform = (root / 'assets/ws/ws-platform.js').read_text(encoding='utf-8')

        self.assertIn('task-trello-board', views)
        self.assertIn("card.draggable = draggable", views)
        self.assertIn('uploadOperatingTaskAttachment', views)
        self.assertIn('addOperatingTaskComment', views)
        self.assertIn('operatingTaskHistory', views)
        self.assertIn('operatingTaskChecklist', views)
        self.assertIn('addOperatingTaskChecklistItem', views)
        self.assertIn('task-checklist__item', views)
        self.assertIn('moveOperatingTask', views)
        self.assertIn("['due_asc', 'Due date · soonest']", views)
        self.assertIn("['created_desc', 'Created · newest']", views)
        self.assertIn('task-board__top-scroll', views)
        self.assertIn('detailData.can_delete', views)
        self.assertIn("remove.classList.add('ws-btn--danger')", views)
        self.assertIn('.task-board__top-scroll', css)
        self.assertIn('.ws-btn--danger', design)
        self.assertIn('.task-card-dialog', css)
        self.assertIn('.task-checklist__item', css)
        self.assertIn("export const operatingTaskBoard", platform)
        self.assertIn("export const operatingTaskChecklist", platform)
