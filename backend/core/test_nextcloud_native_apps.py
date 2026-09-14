from datetime import date, datetime, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import KnowledgeResource
from .nextcloud_deck import _pull_card
from .nextcloud_notes import (
    NotesConflict,
    _local_fingerprint,
    _remote_fingerprint,
    _snapshot,
    reconcile_notes,
    sync_note_to_nextcloud,
)
from .operating_models import WorkStatus
from .workspace_api import provision_personal_workspace


class NativeNotesMirrorTests(TestCase):
    def setUp(self):
        self.queue_patcher = patch('core.space_signals._queue_note_sync')
        self.queue_patcher.start()
        self.addCleanup(self.queue_patcher.stop)
        self.user = get_user_model().objects.create_user(
            username='notes-user', email='notes@example.com', password='not-a-real-secret',
        )
        self.workspace = provision_personal_workspace(self.user)

    def note(self, *, title='Local title', body='Local body', space='research'):
        return KnowledgeResource.objects.create(
            workspace=self.workspace,
            owner=self.user,
            kind=KnowledgeResource.Kind.NOTE,
            title=title,
            body=body,
            metadata={
                'ws_space': space,
                'ws_kind': 'note',
                'ws_blocks': [{'id': 'b-1', 'type': 'p', 'text': body}],
            },
        )

    @patch('core.nextcloud_notes.ensure_user', return_value=object())
    @patch('core.nextcloud_notes._request')
    def test_local_note_creates_native_nextcloud_note_and_mapping(self, request, _ensure):
        resource = self.note()
        remote = {
            'id': 41, 'etag': 'etag-one', 'readonly': False,
            'title': 'Local title', 'content': 'Local body',
            'category': 'Gravitas/Research', 'favorite': False, 'modified': 10,
        }
        request.return_value = (200, remote, {})

        result = sync_note_to_nextcloud(resource)

        self.assertEqual(result['id'], 41)
        resource.refresh_from_db()
        mirror = resource.metadata['nextcloud_notes']
        self.assertEqual(mirror['id'], 41)
        self.assertEqual(mirror['etag'], 'etag-one')
        self.assertEqual(mirror['state'], 'synced')
        self.assertEqual(request.call_args.args[:2], ('POST', '/notes'))
        self.assertEqual(request.call_args.kwargs['body']['category'], 'Gravitas/Research')

    @patch('core.nextcloud_notes.ensure_user', return_value=object())
    @patch('core.nextcloud_notes._request')
    def test_remote_only_edit_is_pulled_into_gravitas(self, request, _ensure):
        resource = self.note()
        original_remote = {
            'id': 52, 'etag': 'etag-a', 'readonly': False,
            'title': resource.title, 'content': resource.body,
            'category': 'Gravitas/Research', 'favorite': False, 'modified': 10,
        }
        metadata = dict(resource.metadata)
        metadata['nextcloud_notes'] = _snapshot(original_remote, _local_fingerprint(resource))
        KnowledgeResource.objects.filter(pk=resource.pk).update(metadata=metadata)
        resource.metadata = metadata

        changed_remote = dict(original_remote, etag='etag-b', title='Edited in Nextcloud', content='Native markdown', modified=20)
        request.return_value = (200, changed_remote, {})

        sync_note_to_nextcloud(resource)

        resource.refresh_from_db()
        self.assertEqual(resource.title, 'Edited in Nextcloud')
        self.assertEqual(resource.body, 'Native markdown')
        self.assertEqual(resource.metadata['nextcloud_notes']['etag'], 'etag-b')
        self.assertEqual(resource.metadata['nextcloud_notes']['state'], 'synced')

    @patch('core.nextcloud_notes.ensure_user', return_value=object())
    @patch('core.nextcloud_notes._request')
    def test_concurrent_note_edits_become_conflict_without_overwrite(self, request, _ensure):
        resource = self.note()
        original_remote = {
            'id': 63, 'etag': 'etag-a', 'readonly': False,
            'title': resource.title, 'content': resource.body,
            'category': 'Gravitas/Research', 'favorite': False, 'modified': 10,
        }
        metadata = dict(resource.metadata)
        metadata['nextcloud_notes'] = _snapshot(original_remote, _local_fingerprint(resource))
        KnowledgeResource.objects.filter(pk=resource.pk).update(metadata=metadata)
        resource.metadata = metadata

        resource.body = 'Changed in Gravitas'
        resource.metadata = dict(resource.metadata)
        resource.metadata['ws_blocks'] = [{'id': 'b-1', 'type': 'p', 'text': resource.body}]
        resource.save(update_fields=['body', 'metadata', 'updated_at'])
        changed_remote = dict(original_remote, etag='etag-b', content='Changed in Nextcloud', modified=20)
        request.return_value = (200, changed_remote, {})

        with self.assertRaises(NotesConflict):
            sync_note_to_nextcloud(resource)

        resource.refresh_from_db()
        self.assertEqual(resource.body, 'Changed in Gravitas')
        self.assertEqual(resource.metadata['nextcloud_notes']['state'], 'conflict')
        self.assertEqual(resource.metadata['nextcloud_notes']['remote_fingerprint'], _remote_fingerprint(changed_remote))
        self.assertEqual(request.call_count, 1, 'conflict detection must not PUT over either side')

    @patch('core.nextcloud_notes.ensure_user', return_value=object())
    @patch('core.nextcloud_notes._list_remote')
    def test_only_gravitas_categories_are_adopted_from_native_notes(self, list_remote, _ensure):
        list_remote.return_value = [
            {
                'id': 70, 'etag': 'a', 'readonly': False, 'title': 'Research native',
                'content': '# Research', 'category': 'Gravitas/Research', 'favorite': True, 'modified': 1,
            },
            {
                'id': 71, 'etag': 'b', 'readonly': False, 'title': 'Private native',
                'content': 'personal', 'category': 'Personal', 'favorite': False, 'modified': 1,
            },
        ]

        result = reconcile_notes(self.user)

        self.assertEqual(result['counts']['adopted'], 1)
        adopted = KnowledgeResource.objects.get(owner=self.user, title='Research native')
        self.assertEqual(adopted.metadata['ws_space'], 'research')
        self.assertTrue(adopted.metadata['ws_bookmarked'])
        self.assertFalse(KnowledgeResource.objects.filter(owner=self.user, title='Private native').exists())

    def test_native_notes_api_requires_authentication(self):
        response = self.client.get('/api/platform/nextcloud/notes/')
        self.assertEqual(response.status_code, 401)


class DeckBidirectionalMirrorTests(TestCase):
    def task(self, *, updated_at, status=WorkStatus.ACTIVE, title='Local task', due_date=date(2026, 9, 20), cycle_id=1):
        task = SimpleNamespace(
            pk=9,
            title=title,
            status=status,
            due_date=due_date,
            cycle_id=cycle_id,
            updated_at=updated_at,
            completed_at=None,
        )
        task.save = MagicMock()
        return task

    def current(self, task, *, stack='Active', title='Local task', due='2026-09-20T17:00:00+00:00', marker=None, modified=0):
        marker = task.updated_at.timestamp() if marker is None else marker
        return {
            'stack_title': stack,
            'stack_id': 2,
            'card': {
                'id': 88,
                'title': title,
                'duedate': due,
                'lastModified': modified,
                'description': f'<!-- gravitas-task:9 -->\n<!-- gravitas-task-updated:{marker:.6f} -->',
            },
        }

    def test_newer_deck_execution_state_is_pulled_when_local_is_unchanged(self):
        changed_at = datetime(2026, 9, 14, 12, 0, tzinfo=dt_timezone.utc)
        task = self.task(updated_at=changed_at)
        current = self.current(
            task,
            stack='Done',
            title='Renamed in Deck',
            due='2026-09-22T17:00:00+00:00',
            modified=changed_at.timestamp() + 30,
        )

        result = _pull_card(task, current)

        self.assertEqual(result, 'pulled')
        self.assertEqual(task.title, 'Renamed in Deck')
        self.assertEqual(task.status, WorkStatus.DONE)
        self.assertEqual(task.due_date, date(2026, 9, 22))
        self.assertIsNotNone(task.completed_at)
        task.save.assert_called_once()

    def test_concurrent_deck_and_gravitas_edits_are_not_overwritten(self):
        changed_at = datetime(2026, 9, 14, 12, 5, tzinfo=dt_timezone.utc)
        task = self.task(updated_at=changed_at, title='Changed in Gravitas')
        previous_push = changed_at.timestamp() - 60
        current = self.current(
            task,
            title='Changed in Deck',
            marker=previous_push,
            modified=changed_at.timestamp() + 30,
        )

        result = _pull_card(task, current)

        self.assertEqual(result, 'conflict')
        self.assertEqual(task.title, 'Changed in Gravitas')
        task.save.assert_not_called()

    def test_deck_cannot_clear_last_due_date_without_cycle(self):
        changed_at = datetime(2026, 9, 14, 12, 0, tzinfo=dt_timezone.utc)
        task = self.task(updated_at=changed_at, cycle_id=None)
        current = self.current(task, due=None, modified=changed_at.timestamp() + 10)

        result = _pull_card(task, current)

        self.assertEqual(result, 'unchanged')
        self.assertEqual(task.due_date, date(2026, 9, 20))
        task.save.assert_not_called()
