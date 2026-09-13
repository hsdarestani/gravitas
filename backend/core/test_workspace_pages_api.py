import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
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
    def test_journal_creation_reuses_the_existing_local_date(self, _sync):
        payload = json.dumps({
            'title': 'Sun, 13 Sep 2026', 'kind': 'journal',
            'space': 'research', 'journal_date': '2026-09-13',
        })
        first = self.client.post('/api/workspace/pages/', payload, content_type='application/json')
        second = self.client.post('/api/workspace/pages/', payload, content_type='application/json')
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()['page']['id'], second.json()['page']['id'])
        self.assertEqual(KnowledgeResource.objects.filter(
            owner=self.user, metadata__ws_journal_date='2026-09-13',
        ).count(), 1)

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

    @patch('core.workspace_pages_api._sync', return_value=None)
    def test_backlinks_are_derived_from_accessible_page_blocks(self, _sync):
        target = self.client.post('/api/workspace/pages/', json.dumps({
            'title': 'Field Theory', 'blocks': [{'id': 'b-1', 'type': 'p', 'text': ''}],
        }), content_type='application/json').json()['page']
        source = self.client.post('/api/workspace/pages/', json.dumps({
            'title': 'Reading log',
            'blocks': [{'id': 'b-2', 'type': 'p', 'text': 'Compare this with [[Field Theory]] tomorrow.'}],
        }), content_type='application/json').json()['page']

        response = self.client.get(f"/api/workspace/pages/{target['id']}/backlinks/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['links'][0]['id'], source['id'])
        self.assertIn('[[Field Theory]]', response.json()['links'][0]['excerpt'])

    @patch('core.workspace_pages_api.cloud.upload')
    @patch('core.workspace_pages_api.cloud.make_folder')
    @patch('core.workspace_pages_api.ensure_space_root', return_value=object())
    @patch('core.workspace_pages_api.ensure_note_link')
    @patch('core.workspace_pages_api._sync', return_value=None)
    def test_attachment_is_stored_in_its_note_folder(self, _sync, note_link, _root, make_folder, upload):
        note_link.return_value = SimpleNamespace(attachments_path='Space/Research/Notes/Field_Log')
        page = self.client.post('/api/workspace/pages/', json.dumps({
            'title': 'Field Log', 'blocks': [{'id': 'b-1', 'type': 'p', 'text': ''}],
        }), content_type='application/json').json()['page']
        response = self.client.post(
            f"/api/workspace/pages/{page['id']}/attachments/",
            {'file': SimpleUploadedFile('sample.csv', b'a,b\n1,2\n', content_type='text/csv')},
        )
        self.assertEqual(response.status_code, 201)
        attachment = KnowledgeResource.objects.get(pk=response.json()['item']['id'])
        self.assertEqual(attachment.storage_path, 'Space/Research/Notes/Field_Log/sample.csv')
        self.assertEqual(attachment.metadata['ws_parent_page'], page['id'])
        make_folder.assert_called_once_with(_root.return_value, 'Space/Research/Notes/Field_Log')
        upload.assert_called_once()

    @patch('core.workspace_pages_api._sync', return_value=None)
    def test_another_user_cannot_attach_to_private_page(self, _sync):
        page = self.client.post('/api/workspace/pages/', json.dumps({
            'title': 'Private note', 'blocks': [],
        }), content_type='application/json').json()['page']
        other = get_user_model().objects.create_user('other-pages@example.com', password='A-secure-password-123!')
        self.client.force_login(other)
        response = self.client.post(
            f"/api/workspace/pages/{page['id']}/attachments/",
            {'file': SimpleUploadedFile('private.txt', b'nope')},
        )
        self.assertEqual(response.status_code, 404)
