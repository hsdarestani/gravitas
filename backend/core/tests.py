import json
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase

from . import cloud
from .models import (
    Collection, KnowledgeLink, KnowledgeResource, Organization,
    ProjectMembership, ResearchProject, StoragePlan, Workspace,
    WorkspaceMembership,
)


class WorkspaceApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        password = 'A-secure-password-123!'
        self.user = user_model.objects.create_user('one@example.com', 'one@example.com', password, first_name='Ada')
        self.other = user_model.objects.create_user('two@example.com', 'two@example.com', password)

    def _login(self, user=None):
        self.client.force_login(user or self.user)

    def _post(self, url, data):
        return self.client.post(url, json.dumps(data), content_type='application/json')

    def _patch(self, url, data):
        return self.client.patch(url, json.dumps(data), content_type='application/json')

    def test_authentication_is_required(self):
        self.assertEqual(self.client.get('/api/workspace/dashboard/').status_code, 401)

    def test_signup_provisions_personal_workspace(self):
        response = self._post('/api/auth/signup/', {
            'name': 'New Researcher', 'email': 'new@example.com',
            'password': 'A-secure-password-456!',
        })
        self.assertEqual(response.status_code, 201)
        user = get_user_model().objects.get(email='new@example.com')
        self.assertTrue(Workspace.objects.filter(owner=user, kind='personal').exists())
        self.assertTrue(StoragePlan.objects.filter(user=user).exists())
        self.assertTrue(response.wsgi_request.user.is_authenticated)

    def test_project_note_search_and_item_detail(self):
        self._login()
        project = self._post('/api/workspace/projects/', {'title': 'Quantum materials', 'description': 'A real project'})
        self.assertEqual(project.status_code, 201)
        project_id = project.json()['project']['id']
        note = self._post('/api/workspace/knowledge/', {
            'kind': 'note', 'title': 'Lab observation', 'body': 'signal alpha', 'project_id': project_id,
        })
        self.assertEqual(note.status_code, 201)
        item_id = note.json()['item']['id']
        result = self.client.get('/api/workspace/knowledge/?q=alpha')
        self.assertEqual([item['title'] for item in result.json()['items']], ['Lab observation'])
        detail = self.client.get(f'/api/workspace/knowledge/{item_id}/').json()['item']
        self.assertEqual(detail['body'], 'signal alpha')
        self.assertEqual(detail['permissions']['can_edit'], True)
        self.assertEqual(detail['related'], [])

    def test_user_isolation_returns_not_found(self):
        self._login()
        created = self._post('/api/workspace/knowledge/', {'kind': 'note', 'title': 'Private', 'body': 'Only mine'}).json()['item']
        self._login(self.other)
        self.assertEqual(self.client.get(f"/api/workspace/knowledge/{created['id']}/").status_code, 404)
        self.assertEqual(self._patch(f"/api/workspace/knowledge/{created['id']}/", {'title': 'Stolen'}).status_code, 404)
        ids = [item['id'] for item in self.client.get('/api/workspace/knowledge/').json()['items']]
        self.assertNotIn(created['id'], ids)

    @patch('core.workspace_api.cloud.upload')
    @patch('core.workspace_api.cloud.ensure_identity')
    def test_file_upload_creates_private_resource_in_drive_root(self, identity, upload):
        identity.return_value = object()
        self._login()
        response = self.client.post('/api/workspace/files/upload/', {
            'kind': 'dataset', 'title': 'Results',
            'file': SimpleUploadedFile('results.csv', b'a,b\n1,2\n', content_type='text/csv'),
        })
        self.assertEqual(response.status_code, 201)
        item = KnowledgeResource.objects.get(pk=response.json()['item']['id'])
        self.assertEqual(item.owner, self.user)
        self.assertEqual(item.storage_path, 'Gravitas/My Files/results.csv')
        upload.assert_called_once()

    def test_quota_is_enforced_before_cloud_upload(self):
        self._login()
        self.client.get('/api/workspace/dashboard/')
        plan = StoragePlan.objects.get(user=self.user)
        plan.quota_bytes = 3
        plan.save()
        with patch('core.workspace_api.cloud.upload') as upload:
            response = self.client.post('/api/workspace/files/upload/', {
                'kind': 'file', 'file': SimpleUploadedFile('large.txt', b'1234'),
            })
        self.assertEqual(response.status_code, 413)
        upload.assert_not_called()

    @patch('core.workspace_api.cloud.delete')
    @patch('core.workspace_api.cloud.folder_is_empty', return_value=True)
    @patch('core.workspace_api.cloud.move')
    @patch('core.workspace_api.cloud.make_folder')
    @patch('core.workspace_api.cloud.ensure_identity')
    def test_nested_folder_file_rename_move_and_empty_delete(self, identity, make_folder, move, is_empty, delete):
        identity.return_value = object()
        self._login()
        root = self._post('/api/workspace/collections/', {'name': 'Experiments'}).json()['collection']
        child = self._post('/api/workspace/collections/', {'name': 'Runs', 'parent_id': root['id']}).json()['collection']
        resource = KnowledgeResource.objects.create(
            workspace=Workspace.objects.get(owner=self.user), owner=self.user, collection_id=child['id'], kind='file',
            title='Protocol', original_name='protocol.pdf', storage_path='Gravitas/My Files/Experiments/Runs/protocol.pdf', file_size=12,
        )
        renamed = self._patch(f'/api/workspace/knowledge/{resource.pk}/', {'filename': 'methodology.pdf', 'collection_id': root['id']})
        self.assertEqual(renamed.status_code, 200)
        resource.refresh_from_db()
        self.assertEqual(resource.storage_path, 'Gravitas/My Files/Experiments/methodology.pdf')
        move.assert_called_with(identity.return_value, 'Gravitas/My Files/Experiments/Runs/protocol.pdf', 'Gravitas/My Files/Experiments/methodology.pdf')
        folder_move = self._patch(f"/api/workspace/collections/{child['id']}/", {'name': 'Archived Runs', 'parent_id': ''})
        self.assertEqual(folder_move.status_code, 200)
        self.assertEqual(self.client.delete(f"/api/workspace/collections/{child['id']}/").status_code, 200)
        self.assertEqual(self.client.delete(f"/api/workspace/collections/{root['id']}/").status_code, 409)
        self.assertGreaterEqual(delete.call_count, 1)

    def test_knowledge_links_are_bidirectional_and_isolated(self):
        self._login()
        note = self._post('/api/workspace/knowledge/', {'kind': 'note', 'title': 'Assumptions', 'body': 'Baseline'}).json()['item']
        paper = self._post('/api/workspace/knowledge/', {'kind': 'paper', 'title': 'Reference', 'source_url': 'https://doi.org/10.1000/test'}).json()['item']
        linked = self._post(f"/api/workspace/knowledge/{note['id']}/links/", {'target_id': paper['id'], 'relation': 'references'})
        self.assertEqual(linked.status_code, 201)
        link_id = linked.json()['link']['id']
        backlink = self.client.get(f"/api/workspace/knowledge/{paper['id']}/links/").json()['links'][0]
        self.assertEqual(backlink['item']['id'], note['id'])
        self.assertEqual(backlink['direction'], 'backlink')
        self.assertEqual(self.client.delete(f"/api/workspace/knowledge/{note['id']}/links/{link_id}/").status_code, 200)
        self._login(self.other)
        foreign = self._post('/api/workspace/knowledge/', {'kind': 'note', 'title': 'Foreign', 'body': 'Private'}).json()['item']
        self._login(self.user)
        self.assertEqual(self._post(f"/api/workspace/knowledge/{note['id']}/links/", {'target_id': foreign['id']}).status_code, 400)

    def test_project_viewer_is_read_only_and_editor_can_mutate(self):
        org = Organization.objects.create(name='Research Team', slug='research-team', created_by=self.user)
        workspace = Workspace.objects.create(name='Shared Lab', kind='team', organization=org)
        WorkspaceMembership.objects.create(workspace=workspace, user=self.user, role='owner')
        WorkspaceMembership.objects.create(workspace=workspace, user=self.other, role='member')
        project = ResearchProject.objects.create(workspace=workspace, owner=self.user, title='Shared Study')
        ProjectMembership.objects.create(project=project, user=self.user, role='owner')
        membership = ProjectMembership.objects.create(project=project, user=self.other, role='viewer')
        note = KnowledgeResource.objects.create(workspace=workspace, project=project, owner=self.user, kind='note', title='Shared note', body='Read me')
        self._login(self.other)
        self.assertEqual(self.client.get(f'/api/workspace/projects/{project.pk}/').status_code, 200)
        self.assertEqual(self._patch(f'/api/workspace/knowledge/{note.pk}/', {'title': 'Changed'}).status_code, 403)
        self.assertEqual(self._post('/api/workspace/knowledge/', {'workspace_id': workspace.pk, 'project_id': project.pk, 'kind': 'note', 'title': 'Nope'}).status_code, 403)
        membership.role = 'editor'
        membership.save()
        self.assertEqual(self._patch(f'/api/workspace/knowledge/{note.pk}/', {'title': 'Editor change'}).status_code, 200)
        self.assertEqual(self._post('/api/workspace/knowledge/', {'workspace_id': workspace.pk, 'project_id': project.pk, 'kind': 'note', 'title': 'Editor note'}).status_code, 201)
        self.assertEqual(self._patch(f'/api/workspace/projects/{project.pk}/', {'title': 'Cannot manage'}).status_code, 403)

    @patch('core.management.commands.seed_workspace_demo.cloud.delete')
    @patch('core.management.commands.seed_workspace_demo.cloud.folder_is_empty', return_value=True)
    @patch('core.management.commands.seed_workspace_demo.cloud.make_folder')
    @patch('core.management.commands.seed_workspace_demo.cloud.ensure_identity')
    def test_demo_seed_is_idempotent_and_removable(self, identity, make_folder, is_empty, delete):
        identity.return_value = Mock()
        call_command('seed_workspace_demo', user=self.user.email)
        call_command('seed_workspace_demo', user=self.user.email)
        project = ResearchProject.objects.get(title='AI for Scientific Discovery', owner=self.user)
        self.assertEqual(project.resources.filter(metadata__demo_seed='gravitas-research-demo-v1').count(), 5)
        self.assertEqual(project.collections.count(), 3)
        self.assertEqual(KnowledgeLink.objects.filter(source__project=project).count(), 4)
        call_command('seed_workspace_demo', user=self.user.email, remove=True)
        self.assertFalse(ResearchProject.objects.filter(pk=project.pk).exists())

    def test_safe_paths_reject_traversal_and_drive_path_is_normalized(self):
        with self.assertRaises(cloud.CloudError):
            cloud.safe_relative_path('../another-user/file.txt')
        self.assertEqual(cloud.drive_path(['Papers', '2026'], 'method.pdf'), 'Gravitas/My Files/Papers/2026/method.pdf')
