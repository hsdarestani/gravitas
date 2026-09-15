import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase


class WorkspaceNoteLatencyTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='fast-notes@example.com',
            email='fast-notes@example.com',
            password='A-secure-password-123!',
        )
        self.client.force_login(self.user)

    @patch('core.workspace_pages_api._sync')
    def test_root_note_creation_does_not_wait_for_nextcloud(self, sync):
        response = self.client.post(
            '/api/workspace/pages/',
            json.dumps({'title': 'Fast note', 'kind': 'note', 'space': 'kms'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['page']['space'], 'kms')
        self.assertEqual(response.json()['page']['sync_state'], 'pending')
        sync.assert_not_called()

    @patch('core.workspace_pages_api._sync')
    def test_regular_editor_save_does_not_wait_for_nextcloud(self, sync):
        created = self.client.post(
            '/api/workspace/pages/',
            json.dumps({'title': 'Draft', 'kind': 'note', 'space': 'kms'}),
            content_type='application/json',
        ).json()['page']
        response = self.client.patch(
            f"/api/workspace/pages/{created['id']}/",
            json.dumps({
                'title': 'Draft renamed',
                'blocks': [{'id': 'b-1', 'type': 'p', 'text': 'Saved locally first.'}],
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['page']['title'], 'Draft renamed')
        sync.assert_not_called()
