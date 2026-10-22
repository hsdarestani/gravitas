"""Regression tests: project-canonical notes never use the native Notes mirror.

All tests use disposable database records and MemoryDAV; no production writes.
"""
import json
from unittest.mock import patch

from django.test import override_settings

from .canonical_models import CanonicalFile
from .canonical_projects import encode, export_object
from .models import KnowledgeResource
from .nextcloud_notes import _json, _canonical_file_cache, reconcile_notes, sync_note_to_nextcloud
from .test_canonical_projects import CanonicalProjectTests


@override_settings(SECURE_SSL_REDIRECT=False)
class CanonicalNoteMirrorTests(CanonicalProjectTests):
    def test_canonical_readback_ignores_stale_native_notes_error(self):
        self.adopt()
        note = KnowledgeResource.objects.select_related('project').get(pk=self.note.pk)
        stale_metadata = {**note.metadata, 'nextcloud_notes': {
            'state': 'error', 'error': 'canonical_acl_requires_transaction'}}
        KnowledgeResource.objects.filter(pk=note.pk).update(metadata=stale_metadata)
        note.refresh_from_db()
        data = _json(note, self.owner)
        self.assertEqual(data['storage_mode'], 'canonical')
        self.assertEqual(data['sync_state'], 'synced')
        self.assertEqual(data['sync_error'], '')
        self.assertIsNone(data['native_url'])
        self.assertFalse(data['can_resolve'])
        file = CanonicalFile.objects.get(project=self.project,
                                         object_type='KnowledgeResource', object_id=note.pk)
        self.assertEqual(file.base_content, encode(note))

    def test_full_native_reconcile_skips_guarded_project_notes(self):
        self.adopt()
        note = KnowledgeResource.objects.select_related('project').get(pk=self.note.pk)
        with patch('core.nextcloud_notes.ensure_user', return_value=object()), \
             patch('core.nextcloud_notes.process_note_delete_tombstones',
                   return_value={'pending_ids': set(), 'deleted': 0}), \
             patch('core.nextcloud_notes._list_remote', return_value=[]), \
             patch('core.nextcloud_notes._create_remote', side_effect=AssertionError('native write')), \
             patch('core.canonical_projects.export_object',
                   side_effect=AssertionError('unguarded canonical write')):
            result = reconcile_notes(self.owner)
            self.assertEqual(result['canonical_skipped'], 1)
            self.assertEqual(result['local_total'], 0)
            self.assertEqual(result['counts']['errors'], 0)
            self.assertIsNone(sync_note_to_nextcloud(note))

    def test_manual_single_note_retry_uses_canonical_journal_not_native_notes(self):
        self.adopt()
        url = '/api/platform/nextcloud/notes/sync/'
        with patch('core.nextcloud_notes._request', side_effect=AssertionError('native Notes called')):
            response = self.client.post(url, data=json.dumps({'note_id': self.note.pk}),
                                        content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['item']['sync_state'], 'synced')
        self.assertEqual(response.json()['item']['storage_mode'], 'canonical')
        self.assertEqual(KnowledgeResource.objects.get(pk=self.note.pk).body, self.note.body)

    def test_unverified_projection_does_not_claim_success(self):
        self.adopt()
        note = KnowledgeResource.objects.select_related('project').get(pk=self.note.pk)
        file = CanonicalFile.objects.get(project=self.project, object_type='KnowledgeResource',
                                         object_id=note.pk)
        file.base_content = 'different version'
        file.save(update_fields=['base_content'])
        data = _json(note, self.owner)
        self.assertEqual(data['storage_mode'], 'canonical')
        self.assertEqual(data['sync_state'], 'pending')
        self.assertEqual(data['sync_error'], 'canonical_projection_unverified')

    def test_view_only_member_cannot_force_a_canonical_write(self):
        self.adopt()
        self.client.force_login(self.viewer)
        response = self.client.post('/api/platform/nextcloud/notes/sync/',
                                    data=json.dumps({'note_id': self.note.pk}),
                                    content_type='application/json')
        self.assertEqual(response.status_code, 403, response.content)

    def test_competing_local_and_remote_note_edits_cannot_be_silently_overwritten(self):
        self.adopt()
        note = KnowledgeResource.objects.select_related('project').get(pk=self.note.pk)
        file = CanonicalFile.objects.get(project=self.project, object_type='KnowledgeResource',
                                         object_id=note.pk)
        from . import cloud
        remote_path = cloud.project_mountpoint(self.project) + '/' + file.path
        remote = self.dav.files[remote_path]
        # Two competing modifications to the same base must not be force-merged.
        KnowledgeResource.objects.filter(pk=note.pk).update(body='local conflicting edit')
        self.dav.external(remote_path, remote['content'].replace(note.body, 'remote conflicting edit'))
        response = self.client.post('/api/platform/nextcloud/notes/sync/',
                                    data=json.dumps({'note_id': note.pk}),
                                    content_type='application/json')
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()['error'], 'canonical_file_conflict')
        self.assertEqual(KnowledgeResource.objects.get(pk=note.pk).body, 'local conflicting edit')
