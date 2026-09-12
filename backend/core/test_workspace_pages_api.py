import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import KnowledgeResource


class WorkspacePagesApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            'pages@example.com', 'pages@example.com', 'A-secure-password-123!'
        )
        self.client.force_login(self.user)

    @patch('core.workspace_pages_api._sync', return_value=None)
    def test_page_create_edit_and_read_are_account_backed(self, _sync):
        created = self.client.post(
            '/api/platform/pages/',
            json.dumps({
                'title': 'Research log', 'kind': 'note', 'space': 'research',
                'blocks': [{'id': 'b-1', 'type': 'p', 'text': 'Initial evidence'}],
            }),
            content_type='application/json',
        )
        self.assertEqual(created.status_code, 201)
        page = created.json()['page']
        self.assertEqual(page['blocks'][0]['text'], 'Initial evidence')

        updated = self.client.patch(
            f"/api/platform/pages/{page['id']}/",
            json.dumps({
                'title': 'Research log updated', 'bookmarked': True,
                'blocks': [{'id': 'b-1', 'type': 'h2', 'text': 'Verified evidence'}],
            }),
            content_type='application/json',
        )
        self.assertEqual(updated.status_code, 200)
        self.assertTrue(updated.json()['page']['bookmarked'])
        stored = KnowledgeResource.objects.get(pk=page['id'])
        self.assertEqual(stored.body, 'Verified evidence')
        self.assertEqual(stored.metadata['ws_blocks'][0]['type'], 'h2')

        detail = self.client.get(f"/api/platform/pages/{page['id']}/")
        self.assertEqual(detail.json()['page']['title'], 'Research log updated')
        tree = self.client.get('/api/platform/pages/').json()
        self.assertIn(page['id'], [node['id'] for node in tree['nodes']])

    def test_pages_require_authentication(self):
        self.client.logout()
        self.assertEqual(self.client.get('/api/platform/pages/').status_code, 401)
