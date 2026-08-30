import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from core import cloud, nextcloud_bridge
from core.models import (
    Collection,
    KnowledgeResource,
    Organization,
    ProjectMembership,
    ResearchProject,
    Workspace,
    WorkspaceMembership,
)
from core.platform_access import (
    INHERIT_VISIBILITY,
    can_edit,
    can_manage,
    can_view,
    grant_role,
    policy_for,
)
from core.platform_models import ObjectPolicy


class NextcloudV4AccessTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(username='owner@example.com', email='owner@example.com', password='StrongPass!123')
        self.editor = User.objects.create_user(username='editor@example.com', email='editor@example.com', password='StrongPass!123')
        self.viewer = User.objects.create_user(username='viewer@example.com', email='viewer@example.com', password='StrongPass!123')
        self.outsider = User.objects.create_user(username='outsider@example.com', email='outsider@example.com', password='StrongPass!123')
        self.org = Organization.objects.create(name='Gravitas Test', slug='gravitas-v4-test', created_by=self.owner)
        self.workspace = Workspace.objects.create(name='Research', kind=Workspace.Kind.TEAM, organization=self.org)
        WorkspaceMembership.objects.create(workspace=self.workspace, user=self.owner, role=WorkspaceMembership.Role.ADMIN)
        WorkspaceMembership.objects.create(workspace=self.workspace, user=self.editor, role=WorkspaceMembership.Role.MEMBER)
        WorkspaceMembership.objects.create(workspace=self.workspace, user=self.viewer, role=WorkspaceMembership.Role.MEMBER)
        self.project = ResearchProject.objects.create(workspace=self.workspace, owner=self.owner, title='Restricted Research')
        ProjectMembership.objects.create(project=self.project, user=self.owner, role=ProjectMembership.Role.OWNER)
        ProjectMembership.objects.create(project=self.project, user=self.editor, role=ProjectMembership.Role.EDITOR)
        ProjectMembership.objects.create(project=self.project, user=self.viewer, role=ProjectMembership.Role.VIEWER)
        project_policy = policy_for(self.project, create=True, created_by=self.owner, default_visibility=ObjectPolicy.Visibility.PROJECT)
        project_policy.visibility = ObjectPolicy.Visibility.PROJECT
        project_policy.save()
        self.folder = Collection.objects.create(workspace=self.workspace, project=self.project, name='Raw Data', created_by=self.owner)
        folder_policy = policy_for(self.folder, create=True, created_by=self.owner)
        self.assertEqual(folder_policy.visibility, INHERIT_VISIBILITY)
        self.resource = KnowledgeResource.objects.create(
            workspace=self.workspace,
            project=self.project,
            collection=self.folder,
            owner=self.owner,
            kind=KnowledgeResource.Kind.FILE,
            title='raw.csv',
            original_name='raw.csv',
            storage_path=f'{cloud.project_mountpoint(self.project)}/Raw Data/raw.csv',
        )
        resource_policy = policy_for(self.resource, create=True, created_by=self.owner)
        self.assertEqual(resource_policy.visibility, INHERIT_VISIBILITY)

    def test_project_roles_flow_through_inherited_folder_and_file(self):
        self.assertTrue(can_edit(self.editor, self.folder))
        self.assertTrue(can_view(self.viewer, self.folder))
        self.assertFalse(can_edit(self.viewer, self.folder))
        self.assertTrue(can_edit(self.editor, self.resource))
        self.assertTrue(can_view(self.viewer, self.resource))
        self.assertFalse(can_edit(self.viewer, self.resource))

    def test_specific_folder_hides_inherited_children_from_other_project_members(self):
        policy = policy_for(self.folder)
        policy.visibility = ObjectPolicy.Visibility.SPECIFIC
        policy.save()
        grant_role(self.folder, self.editor, 'edit', granted_by=self.owner)
        self.assertTrue(can_edit(self.editor, self.folder))
        self.assertTrue(can_edit(self.editor, self.resource))
        self.assertFalse(can_view(self.viewer, self.folder))
        self.assertFalse(can_view(self.viewer, self.resource))
        self.assertTrue(can_manage(self.owner, self.resource))

    def test_non_project_workspace_member_does_not_gain_project_access(self):
        WorkspaceMembership.objects.create(workspace=self.workspace, user=self.outsider, role=WorkspaceMembership.Role.MEMBER)
        self.assertFalse(can_view(self.outsider, self.project))
        self.assertFalse(can_view(self.outsider, self.folder))

    @patch('core.nextcloud_bridge._write_team_acl')
    @patch('core.nextcloud_bridge._set_project_group_read_only')
    @patch('core.nextcloud_bridge.cloud.add_user_to_group')
    @patch('core.nextcloud_bridge.cloud.ensure_team_folder')
    @patch('core.nextcloud_bridge.ensure_user')
    def test_native_team_folder_root_maps_viewer_editor_manager_roles(
        self, ensure_user, ensure_team_folder, add_user, set_read_only, write_acl
    ):
        ensure_user.side_effect = lambda user: SimpleNamespace(username=f'gravitas-u-{user.pk}')
        ensure_team_folder.return_value = {'id': 77, 'mount_point': cloud.project_mountpoint(self.project), 'group_id': cloud.project_group_id(self.project)}
        with patch.object(Collection.objects, 'filter', wraps=Collection.objects.filter):
            result = nextcloud_bridge.ensure_project_space(self.project)
        self.assertEqual(result['folder_id'], 77)
        set_read_only.assert_called_once_with(77, cloud.project_group_id(self.project))
        args = write_acl.call_args_list[0].args
        roles = args[3]
        self.assertEqual(roles[f'gravitas-u-{self.owner.pk}'], 'manage')
        self.assertEqual(roles[f'gravitas-u-{self.editor.pk}'], 'edit')
        self.assertEqual(roles[f'gravitas-u-{self.viewer.pk}'], 'view')

    def test_project_storage_path_uses_stable_team_folder_mount(self):
        path = nextcloud_bridge.project_storage_path(self.project, self.folder, 'dataset.csv')
        self.assertEqual(path, f'{cloud.project_mountpoint(self.project)}/Raw Data/dataset.csv')


class NextcloudV4ApiTests(NextcloudV4AccessTests):
    @patch('core.nextcloud_api.nextcloud_bridge.sync_collection_acl')
    def test_project_folder_creation_defaults_to_inherit(self, sync_acl):
        sync_acl.return_value = {'folder_id': 1}
        self.client.force_login(self.owner)
        response = self.client.post(
            f'/api/platform/projects/{self.project.pk}/folders/',
            data=json.dumps({'name': 'Analysis', 'visibility': 'inherit'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        item = response.json()['item']
        self.assertEqual(item['visibility'], 'inherit')
        self.assertTrue(Collection.objects.filter(project=self.project, name='Analysis').exists())
        sync_acl.assert_called_once()

    @patch('core.nextcloud_api.nextcloud_bridge.sync_object_acl')
    def test_specific_folder_grant_requires_project_membership(self, sync_acl):
        self.client.force_login(self.owner)
        response = self.client.post(
            '/api/platform/share/',
            data=json.dumps({
                'type': 'collection',
                'id': self.folder.pk,
                'action': 'grant',
                'email': self.outsider.email,
                'role': 'view',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error'], 'project_membership_required')
        sync_acl.assert_not_called()

    @patch('core.nextcloud_api.nextcloud_bridge.sync_object_acl')
    def test_folder_policy_can_be_switched_to_specific_and_back_to_inherit(self, sync_acl):
        self.client.force_login(self.owner)
        for visibility in ('specific', 'inherit'):
            response = self.client.post(
                '/api/platform/share/',
                data=json.dumps({
                    'type': 'collection',
                    'id': self.folder.pk,
                    'action': 'policy',
                    'visibility': visibility,
                    'allow_download': True,
                }),
                content_type='application/json',
            )
            self.assertEqual(response.status_code, 200, response.content)
            self.folder.refresh_from_db()
            self.assertEqual(policy_for(self.folder).visibility, visibility)
        self.assertEqual(sync_acl.call_count, 2)

    @patch('core.nextcloud_api.nextcloud_bridge.create_native_client_credentials')
    def test_current_user_can_generate_device_specific_nextcloud_credentials(self, create_credentials):
        create_credentials.return_value = {
            'server': 'https://gravitasplus.com/nextcloud',
            'username': f'gravitas-u-{self.owner.pk}',
            'app_password': 'one-time-device-secret',
            'web_url': 'https://gravitasplus.com/nextcloud/',
            'note': 'shown once',
        }
        self.client.force_login(self.owner)
        response = self.client.post('/api/platform/nextcloud/client-credentials/', data='{}', content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['credentials']['username'], f'gravitas-u-{self.owner.pk}')
        create_credentials.assert_called_once_with(self.owner)

    def test_nextcloud_status_lists_native_project_mount(self):
        self.client.force_login(self.viewer)
        response = self.client.get('/api/platform/nextcloud/')
        self.assertEqual(response.status_code, 200)
        projects = response.json()['projects']
        project = next(item for item in projects if item['id'] == self.project.pk)
        self.assertEqual(project['mount_point'], cloud.project_mountpoint(self.project))
        self.assertIn('/nextcloud/', project['native_url'])
