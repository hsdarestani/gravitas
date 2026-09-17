from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from .layer_models import ModuleGrant
from .models import KnowledgeResource
from .workspace_api import provision_personal_workspace


class NotesFastFirstPaintApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='fast-native-notes@example.com',
            email='fast-native-notes@example.com',
            password='A-secure-password-123!',
        )
        ModuleGrant.objects.update_or_create(
            user=self.user,
            module=ModuleGrant.Module.RESEARCH,
            defaults={
                'enabled': True,
                'access_level': ModuleGrant.AccessLevel.PARTICIPATE,
                'source': ModuleGrant.Source.ADMIN,
            },
        )
        workspace = provision_personal_workspace(self.user)
        self.note = KnowledgeResource.objects.create(
            workspace=workspace,
            owner=self.user,
            kind=KnowledgeResource.Kind.NOTE,
            title='Already local',
            body='Render this before any remote request.',
            metadata={'ws_space': 'research', 'ws_kind': 'note'},
        )
        self.client.force_login(self.user)

    @patch('core.nextcloud_notes_fast_api.native_notes')
    def test_initial_notes_get_returns_local_rows_without_blocking_reconcile(self, legacy_native_notes):
        response = self.client.get('/api/platform/nextcloud/notes/')

        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data['sync_deferred'])
        self.assertIsNone(data['sync'])
        self.assertEqual([item['title'] for item in data['items']], ['Already local'])
        legacy_native_notes.assert_not_called()

    @patch('core.nextcloud_notes_fast_api.native_notes')
    def test_blocking_sync_is_only_available_when_explicitly_requested(self, legacy_native_notes):
        from django.http import JsonResponse

        legacy_native_notes.return_value = JsonResponse({'ok': True, 'explicit_sync': True})
        response = self.client.get('/api/platform/nextcloud/notes/?sync=1')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['explicit_sync'])
        legacy_native_notes.assert_called_once()


class NotesFastFirstPaintAssetTests(TestCase):
    def test_workspace_installs_non_blocking_notes_layer(self):
        root = Path(__file__).resolve().parents[2]
        workspace = (root / 'workspace.html').read_text(encoding='utf-8')
        script = (root / 'assets' / 'ws' / 'ws-notes-performance.js').read_text(encoding='utf-8')

        self.assertIn('installNotesPerformance', workspace)
        self.assertIn('/workspace/research/editor', script)
        self.assertIn('/workspace/research/notes', script)
        self.assertIn("'/platform/nextcloud/notes/sync/'", script)
        self.assertIn('Local notes ready', script)
        self.assertIn('45000', script)
        self.assertNotIn('.showModal(', script)
        self.assertNotIn("createElement('dialog')", script)
