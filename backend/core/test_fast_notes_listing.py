"""Notes listing is a low-latency local snapshot, never a full Nextcloud sync."""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase, override_settings

from .models import KnowledgeResource
from .nextcloud_notes import native_notes, native_notes_sync
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(SECURE_SSL_REDIRECT=False)
class FastNotesListingTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser(
            username='notes-fast-owner', email='notes-fast-owner@example.test', password='pass'
        )
        self.workspace = ensure_platform_workspaces(self.user)['research']
        self.note = KnowledgeResource.objects.create(
            workspace=self.workspace, owner=self.user,
            kind=KnowledgeResource.Kind.NOTE, title='Quick note',
            body='saved before Nextcloud is contacted',
            metadata={'ws_space': 'research'},
        )
        self.factory = RequestFactory()

    def test_opening_notes_is_read_only_and_does_not_contact_nextcloud(self):
        request = self.factory.get('/api/platform/nextcloud/notes/')
        request.user = self.user
        with patch('core.nextcloud_notes.reconcile_notes') as reconcile, \
             patch('core.nextcloud_notes.cloud._request') as webdav:
            result = native_notes(request)
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.json()['sync']['deferred'])
        self.assertEqual(result.json()['items'][0]['content'], self.note.body)
        self.assertEqual(result['Cache-Control'], 'private, no-store')
        reconcile.assert_not_called()
        webdav.assert_not_called()

    def test_explicit_sync_still_calls_reconciliation(self):
        request = self.factory.post('/api/platform/nextcloud/notes/sync/')
        request.user = self.user
        with patch('core.nextcloud_notes.reconcile_notes',
                   return_value={'counts': {'pushed': 1}}) as reconcile:
            result = native_notes_sync(request)
        self.assertEqual(result.status_code, 200)
        reconcile.assert_called_once_with(self.user)
