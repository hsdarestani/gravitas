import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .legacy_folder_cleanup import _delete_remote_folder
from .models import Collection, KnowledgeResource, ProjectMembership, ResearchProject


LEGACY_NAMES = (
    '01 Client Input',
    '02 Working',
    '03 Datasets',
    '04 Analysis',
    '05 Deliverables',
    '06 Archive',
)


@override_settings(
    GRAVITAS_DEFAULT_QUOTA_BYTES=1024 * 1024 * 100,
    GRAVITAS_MAX_UPLOAD_BYTES=1024 * 1024 * 10,
    SECURE_SSL_REDIRECT=False,
)
class LegacyFolderCleanupTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            username='legacy-owner@example.com',
            email='legacy-owner@example.com',
            first_name='Legacy Owner',
            password='Test-Pass-123!',
        )
        self.viewer = User.objects.create_user(
            username='legacy-viewer@example.com',
            email='legacy-viewer@example.com',
            first_name='Legacy Viewer',
            password='Test-Pass-456!',
        )
        self.client.force_login(self.owner)
        response = self.client.post(
            '/api/platform/projects/',
            data=json.dumps({
                'title': 'Legacy folder migration test',
                'category': 'client',
                'visibility': 'private',
                'secure_data_room': True,
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.project = ResearchProject.objects.get(pk=response.json()['project']['id'])
        self.folders = {}
        for name in LEGACY_NAMES:
            self.folders[name] = Collection.objects.create(
                workspace=self.project.workspace,
                project=self.project,
                name=name,
                created_by=self.owner,
            )

    @property
    def url(self):
        return f'/api/platform/projects/{self.project.pk}/legacy-folders/'

    def post_cleanup(self, confirmed=True):
        return self.client.post(
            self.url,
            data=json.dumps({'confirmed': confirmed}),
            content_type='application/json',
        )

    def test_detects_full_legacy_signature_without_touching_cloud(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200, response.content)
        legacy = response.json()['legacy']
        self.assertTrue(legacy['active'])
        self.assertTrue(legacy['full_signature'])
        self.assertTrue(legacy['can_cleanup'])
        self.assertEqual(legacy['count'], 6)
        self.assertEqual(legacy['database_empty_count'], 6)
        self.assertEqual(legacy['database_blocked_count'], 0)

    def test_cleanup_removes_only_folders_empty_in_database_and_nextcloud(self):
        busy = self.folders['02 Working']
        resource = KnowledgeResource.objects.create(
            workspace=self.project.workspace,
            project=self.project,
            collection=busy,
            owner=self.owner,
            kind='file',
            title='Do not delete me',
            storage_path='GRV-%06d/02 Working/evidence.csv' % self.project.pk,
            original_name='evidence.csv',
        )
        remote_state = {'exists': True, 'empty': True, 'via': 'admin'}
        reconciled = {'team_folder': True, 'space_paths': [{'user_id': self.owner.pk, 'path': 'Space/Research/Client/Legacy_folder_migration_test'}], 'space_pending': []}

        with (
            patch('core.legacy_folder_cleanup.nextcloud_bridge.ensure_project_space', return_value={}),
            patch('core.legacy_folder_cleanup.nextcloud_bridge.ensure_user', return_value=SimpleNamespace()),
            patch('core.legacy_folder_cleanup._remote_folder_state', return_value=remote_state) as inspect,
            patch('core.legacy_folder_cleanup._delete_remote_folder', return_value='admin') as delete,
            patch('core.legacy_folder_cleanup._reconcile_nextcloud', return_value=reconciled) as reconcile,
        ):
            response = self.post_cleanup()

        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual({item['name'] for item in data['cleaned']}, set(LEGACY_NAMES) - {'02 Working'})
        self.assertTrue(all(item['deleted_via'] == 'admin' for item in data['cleaned']))
        self.assertEqual(data['blocked'], [{
            'id': busy.pk,
            'name': '02 Working',
            'reason': 'contains_database_content',
        }])
        self.assertEqual(inspect.call_count, 5)
        self.assertEqual(delete.call_count, 5)
        reconcile.assert_called_once_with(self.project)
        self.assertTrue(data['nextcloud']['team_folder'])
        self.assertEqual(list(self.project.collections.values_list('name', flat=True)), ['02 Working'])

        # Once a cleanup has been confirmed, the remaining legacy folder stays
        # detectable even though the original six-folder signature is partial.
        status = self.client.get(self.url).json()['legacy']
        self.assertTrue(status['active'])
        self.assertTrue(status['previously_confirmed'])
        self.assertFalse(status['full_signature'])

        resource.delete()
        with (
            patch('core.legacy_folder_cleanup.nextcloud_bridge.ensure_project_space', return_value={}),
            patch('core.legacy_folder_cleanup.nextcloud_bridge.ensure_user', return_value=SimpleNamespace()),
            patch('core.legacy_folder_cleanup._remote_folder_state', return_value=remote_state),
            patch('core.legacy_folder_cleanup._delete_remote_folder', return_value='admin'),
            patch('core.legacy_folder_cleanup._reconcile_nextcloud', return_value=reconciled),
        ):
            second = self.post_cleanup()
        self.assertEqual(second.status_code, 200, second.content)
        self.assertFalse(second.json()['legacy']['active'])
        self.assertFalse(self.project.collections.exists())

    def test_nextcloud_content_is_never_deleted(self):
        def remote_state(_identity, path):
            return {
                'exists': True,
                'empty': not path.endswith('/03 Datasets'),
                'via': 'admin',
            }

        with (
            patch('core.legacy_folder_cleanup.nextcloud_bridge.ensure_project_space', return_value={}),
            patch('core.legacy_folder_cleanup.nextcloud_bridge.ensure_user', return_value=SimpleNamespace()),
            patch('core.legacy_folder_cleanup._remote_folder_state', side_effect=remote_state),
            patch('core.legacy_folder_cleanup._delete_remote_folder', return_value='admin') as delete,
            patch('core.legacy_folder_cleanup._reconcile_nextcloud', return_value={'team_folder': True, 'space_paths': [], 'space_pending': []}),
        ):
            response = self.post_cleanup()

        self.assertEqual(response.status_code, 200, response.content)
        blocked = response.json()['blocked']
        self.assertEqual(len(blocked), 1)
        self.assertEqual(blocked[0]['name'], '03 Datasets')
        self.assertEqual(blocked[0]['reason'], 'contains_nextcloud_content')
        self.assertTrue(self.project.collections.filter(name='03 Datasets').exists())
        self.assertEqual(delete.call_count, 5)

    def test_admin_dav_is_used_for_deleting_verified_team_folder(self):
        identity = SimpleNamespace()
        with (
            patch('core.legacy_folder_cleanup.cloud._admin_dav_url', return_value='https://nc/admin/path') as admin_url,
            patch('core.legacy_folder_cleanup.cloud._admin_auth', return_value=('admin', 'secret')),
            patch('core.legacy_folder_cleanup.cloud._request') as request,
            patch('core.legacy_folder_cleanup.cloud.delete') as owner_delete,
        ):
            via = _delete_remote_folder(identity, 'GRV-000123/01 Client Input', {'exists': True, 'empty': True, 'via': 'admin'})
        self.assertEqual(via, 'admin')
        admin_url.assert_called_once_with('GRV-000123/01 Client Input')
        request.assert_called_once()
        self.assertEqual(request.call_args.args[0], 'DELETE')
        owner_delete.assert_not_called()

    def test_cleanup_requires_explicit_confirmation(self):
        response = self.post_cleanup(confirmed=False)
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()['error'], 'confirmation_required')
        self.assertEqual(self.project.collections.count(), 6)

    def test_viewer_can_see_warning_but_cannot_cleanup(self):
        ProjectMembership.objects.create(
            project=self.project,
            user=self.viewer,
            role=ProjectMembership.Role.VIEWER,
        )
        self.client.force_login(self.viewer)
        status = self.client.get(self.url)
        self.assertEqual(status.status_code, 200, status.content)
        self.assertFalse(status.json()['legacy']['can_cleanup'])
        response = self.post_cleanup()
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()['error'], 'permission_denied')
        self.assertEqual(self.project.collections.count(), 6)
