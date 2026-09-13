import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import KnowledgeResource, Workspace


class WorkspacePagesApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            'pages@example.com', 'pages@example.com', 'A-secure-password-123!'
        )
        self.client.force_login(self.user)

    @patch('core.workspace_pages_api._sync', return_value=None)
    def test_page_create_edit_and_read_are_account_backed(self, _sync):
        created = self.client.post(
            '/api/workspace/pages/',
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
            f"/api/workspace/pages/{page['id']}/",
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

        detail = self.client.get(f"/api/workspace/pages/{page['id']}/")
        self.assertEqual(detail.json()['page']['title'], 'Research log updated')
        tree = self.client.get('/api/workspace/pages/').json()
        self.assertIn(page['id'], [node['id'] for node in tree['nodes']])

    def test_pages_require_authentication(self):
        self.client.logout()
        self.assertEqual(self.client.get('/api/workspace/pages/').status_code, 401)

    @patch('core.workspace_pages_api._sync', return_value=None)
    def test_owned_legacy_note_is_readable_without_workspace_membership(self, _sync):
        legacy_owner = get_user_model().objects.create_user(
            'legacy@example.com', 'legacy@example.com', 'A-secure-password-123!'
        )
        team = Workspace.objects.create(
            name='Legacy workspace', kind=Workspace.Kind.PERSONAL, owner=legacy_owner,
        )
        note = KnowledgeResource.objects.create(
            workspace=team,
            owner=self.user,
            kind=KnowledgeResource.Kind.NOTE,
            title='Owned legacy note',
        )

        listed = self.client.get('/api/workspace/pages/')
        self.assertEqual(listed.status_code, 200)
        self.assertIn(str(note.pk), [page['id'] for page in listed.json()['pages']])

        detail = self.client.get(f'/api/workspace/pages/{note.pk}/')
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()['page']['title'], 'Owned legacy note')
