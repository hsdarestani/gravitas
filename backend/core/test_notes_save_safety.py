"""Regression coverage for truthful saves and stale editors in shared notes."""
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings

from .models import KnowledgeResource
from .nextcloud_notes import NotesError, _update_remote, native_note_detail
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(SECURE_SSL_REDIRECT=False)
class SharedNoteSaveTests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_superuser(
            'save-check-owner', 'save-check@example.test', 'pass'
        )
        self.spaces = ensure_platform_workspaces(self.owner)
        self.note = KnowledgeResource.objects.create(
            workspace=self.spaces['research'],
            owner=self.owner, kind=KnowledgeResource.Kind.NOTE,
            title='Original title', body='original', metadata={'ws_space': 'research'},
        )
        self.factory = RequestFactory()

    def update(self, **payload):
        request = self.factory.patch(
            '/api/platform/nextcloud/notes/%s/' % self.note.pk,
            data=json.dumps(payload), content_type='application/json',
        )
        request.user = self.owner
        return native_note_detail(request, self.note.pk)

    def test_guarded_editor_rejects_stale_revision_without_losing_recent_save(self):
        opened = self.note.updated_at.isoformat()
        with patch('core.nextcloud_notes.sync_note_to_nextcloud'):
            ok = self.update(content='first edit', expected_updated=opened)
            self.assertEqual(ok.status_code, 200)
            stale = self.update(content='stale edit', expected_updated=opened)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(json.loads(stale.content)['error'], 'note_changed_elsewhere')
        self.note.refresh_from_db()
        self.assertEqual(self.note.body, 'first edit')

    def test_mirror_failure_keeps_local_content_but_does_not_claim_synced(self):
        with patch('core.nextcloud_notes.sync_note_to_nextcloud',
                   side_effect=NotesError('Cloud storage returned HTTP 423')):
            result = self.update(content='durable local change',
                                 expected_updated=self.note.updated_at.isoformat())
        self.assertEqual(result.status_code, 200)
        item = json.loads(result.content)['item']
        self.assertEqual(item['sync_state'], 'error')
        self.assertEqual(item['content'], 'durable local change')
        self.note.refresh_from_db()
        self.assertEqual(self.note.body, 'durable local change')

    def test_cross_workspace_implicit_move_is_not_a_save(self):
        with patch('core.nextcloud_notes.sync_note_to_nextcloud'):
            result = self.update(content='different', space='core',
                                 expected_updated=self.note.updated_at.isoformat())
        self.assertEqual(result.status_code, 409)
        self.note.refresh_from_db()
        self.assertEqual(self.note.body, 'original')


class NativeMirrorReadbackTests(SimpleTestCase):
    def test_remote_put_must_read_back_written_content(self):
        resource = SimpleNamespace(
            pk=10, body='correct value', title='Test',
            metadata={'ws_space': 'research',
                      'nextcloud_notes': {'etag': '"first"'}},
        )
        remote = {'id': 50, 'etag': '"first"', 'content': 'old'}
        with patch('core.nextcloud_notes._request', return_value=(200, {'id': 50}, {})), \
             patch('core.nextcloud_notes._get_remote', return_value={'id': 50, 'etag': '"new"', 'content': 'stale'}), \
             patch('core.nextcloud_notes._mark') as mark, \
             patch('core.nextcloud_notes._write_mirror') as write:
            with self.assertRaises(NotesError):
                _update_remote(None, resource, remote)
            mark.assert_called_once()
            write.assert_not_called()

    def test_matching_readback_records_synced_version(self):
        resource = SimpleNamespace(
            pk=10, body='new content', title='Test',
            metadata={'ws_space': 'research',
                      'nextcloud_notes': {'etag': '"first"'}},
        )
        remote = {'id': 50, 'etag': '"first"', 'content': 'old'}
        confirmed = {'id': 50, 'etag': '"new"', 'content': 'new content'}
        with patch('core.nextcloud_notes._request', return_value=(200, {'id': 50}, {})), \
             patch('core.nextcloud_notes._get_remote', return_value=confirmed), \
             patch('core.nextcloud_notes._write_mirror') as write:
            result = _update_remote(None, resource, remote)
        self.assertEqual(result['content'], 'new content')
        self.assertEqual(write.call_args.args[1]['state'], 'synced')
