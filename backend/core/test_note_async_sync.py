from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import KnowledgeResource, Workspace


class NoteAsyncSpaceSyncTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='note-sync@example.com',
            email='note-sync@example.com',
            password='A-secure-password-123!',
        )
        self.workspace = Workspace.objects.create(
            name='Note sync personal workspace',
            kind=Workspace.Kind.PERSONAL,
            owner=self.user,
        )

    @patch('core.space_signals._queue_note_sync')
    def test_note_commit_enqueues_space_sync_instead_of_running_it_inline(self, queued):
        with self.captureOnCommitCallbacks(execute=True):
            note = KnowledgeResource.objects.create(
                workspace=self.workspace,
                owner=self.user,
                kind=KnowledgeResource.Kind.NOTE,
                title='Fast note save',
                body='The HTTP request should not wait for Nextcloud WebDAV.',
            )

        queued.assert_called_once_with(note.pk)

    @patch('core.space_signals._NOTE_SYNC_QUEUE')
    @patch('core.space_signals._ensure_note_sync_worker')
    def test_queue_submission_is_non_blocking(self, ensure_worker, note_queue):
        from .space_signals import _queue_note_sync

        _queue_note_sync(42)

        ensure_worker.assert_called_once_with()
        note_queue.put_nowait.assert_called_once_with(42)
        note_queue.put.assert_not_called()
