from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from . import cloud
from .models import KnowledgeResource, StoragePlan


class WorkspaceApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user('one@example.com', 'one@example.com', 'A-secure-password-123!')
        self.other = user_model.objects.create_user('two@example.com', 'two@example.com', 'A-secure-password-123!')

    def _login(self, user=None):
        self.client.force_login(user or self.user)

    def test_authentication_is_required(self):
        response = self.client.get('/api/workspace/dashboard/')
        self.assertEqual(response.status_code, 401)

    def test_project_note_and_search(self):
        self._login()
        project = self.client.post(
            '/api/workspace/projects/',
            {'title': 'Quantum materials', 'description': 'A real project'},
            content_type='application/json',
        )
        self.assertEqual(project.status_code, 201)
        project_id = project.json()['project']['id']
        note = self.client.post(
            '/api/workspace/knowledge/',
            {'kind': 'note', 'title': 'Lab observation', 'body': 'signal alpha', 'project_id': project_id},
            content_type='application/json',
        )
        self.assertEqual(note.status_code, 201)
        result = self.client.get('/api/workspace/knowledge/?q=alpha')
        self.assertEqual([item['title'] for item in result.json()['items']], ['Lab observation'])

    def test_user_isolation_returns_not_found(self):
        self._login()
        created = self.client.post(
            '/api/workspace/knowledge/',
            {'kind': 'note', 'title': 'Private', 'body': 'Only mine'},
            content_type='application/json',
        ).json()['item']
        self._login(self.other)
        self.assertEqual(self.client.get(f"/api/workspace/knowledge/{created['id']}/").status_code, 404)
        ids = [item['id'] for item in self.client.get('/api/workspace/knowledge/').json()['items']]
        self.assertNotIn(created['id'], ids)

    @patch('core.workspace_api.cloud.upload')
    @patch('core.workspace_api.cloud.ensure_identity')
    def test_file_upload_creates_private_resource(self, identity, upload):
        identity.return_value = object()
        self._login()
        response = self.client.post(
            '/api/workspace/files/upload/',
            {'kind': 'dataset', 'title': 'Results', 'file': SimpleUploadedFile('results.csv', b'a,b\n1,2\n', content_type='text/csv')},
        )
        self.assertEqual(response.status_code, 201)
        item = KnowledgeResource.objects.get(pk=response.json()['item']['id'])
        self.assertEqual(item.owner, self.user)
        self.assertEqual(item.kind, 'dataset')
        self.assertTrue(item.storage_path.startswith(f'Gravitas/resources/{item.pk}/'))
        upload.assert_called_once()

    def test_quota_is_enforced_before_cloud_upload(self):
        self._login()
        self.client.get('/api/workspace/dashboard/')
        plan = StoragePlan.objects.get(user=self.user)
        plan.quota_bytes = 3
        plan.save()
        with patch('core.workspace_api.cloud.upload') as upload:
            response = self.client.post(
                '/api/workspace/files/upload/',
                {'kind': 'file', 'file': SimpleUploadedFile('large.txt', b'1234')},
            )
        self.assertEqual(response.status_code, 413)
        upload.assert_not_called()

    def test_safe_paths_reject_traversal(self):
        with self.assertRaises(cloud.CloudError):
            cloud.safe_relative_path('../another-user/file.txt')
