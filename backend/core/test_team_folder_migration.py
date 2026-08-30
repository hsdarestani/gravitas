import hashlib
from io import StringIO
from types import SimpleNamespace
from unittest.mock import call, patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from core import cloud, nextcloud_bridge
from core.models import Collection, KnowledgeResource, Organization, ProjectMembership, ResearchProject, Workspace


class FakeDownload:
    def __init__(self, payload=b'legacy-data', content_type='text/csv'):
        self.payload = payload
        self.headers = {'Content-Type': content_type}
        self.closed = False

    def iter_content(self, chunk_size=1024 * 1024):
        yield self.payload

    def close(self):
        self.closed = True


class TeamFolderLegacyMigrationTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            username='migration-owner@example.com',
            email='migration-owner@example.com',
            password='StrongPass!123',
        )
        self.uploader = User.objects.create_user(
            username='legacy-uploader@example.com',
            email='legacy-uploader@example.com',
            password='StrongPass!123',
        )
        self.org = Organization.objects.create(
            name='Migration Test',
            slug='migration-test',
            created_by=self.owner,
        )
        self.workspace = Workspace.objects.create(
            name='Research',
            kind=Workspace.Kind.TEAM,
            organization=self.org,
        )
        self.project = ResearchProject.objects.create(
            workspace=self.workspace,
            owner=self.owner,
            title='Legacy Research',
        )
        ProjectMembership.objects.create(
            project=self.project,
            user=self.owner,
            role=ProjectMembership.Role.OWNER,
        )
        self.folder = Collection.objects.create(
            workspace=self.workspace,
            project=self.project,
            name='Raw Data',
            created_by=self.owner,
        )
        self.payload = b'a,b\n1,2\n'
        self.legacy_path = 'Gravitas/resources/77/legacy.csv'
        self.resource = KnowledgeResource.objects.create(
            workspace=self.workspace,
            project=self.project,
            collection=self.folder,
            owner=self.uploader,
            kind=KnowledgeResource.Kind.DATASET,
            title='Legacy dataset',
            original_name='legacy.csv',
            mime_type='text/csv',
            file_size=len(self.payload),
            storage_path=self.legacy_path,
            checksum='sha256:' + hashlib.sha256(self.payload).hexdigest(),
        )
        self.new_path = nextcloud_bridge.project_storage_path(
            self.project,
            self.folder,
            self.resource.original_name,
        )
        self.source_identity = SimpleNamespace(username=f'gravitas-u-{self.uploader.pk}')
        self.destination_identity = SimpleNamespace(username=f'gravitas-u-{self.owner.pk}')

    def identity_for(self, user):
        return self.destination_identity if user.pk == self.owner.pk else self.source_identity

    def test_dry_run_verbose_lists_only_legacy_paths_and_mutates_nothing(self):
        native = KnowledgeResource.objects.create(
            workspace=self.workspace,
            project=self.project,
            owner=self.owner,
            kind=KnowledgeResource.Kind.FILE,
            title='Already native',
            original_name='native.pdf',
            storage_path=f'{cloud.project_mountpoint(self.project)}/native.pdf',
        )
        out = StringIO()
        call_command(
            'migrate_project_files_to_team_folders',
            dry_run=True,
            verbose=True,
            stdout=out,
        )
        text = out.getvalue()
        self.assertIn(f'resource={self.resource.pk}', text)
        self.assertNotIn(f'resource={native.pk} ', text)
        self.assertIn('dry-run matched=1', text)
        self.resource.refresh_from_db()
        self.assertEqual(self.resource.storage_path, self.legacy_path)

    def test_default_dry_run_exposes_only_count_not_research_paths(self):
        out = StringIO()
        call_command('migrate_project_files_to_team_folders', dry_run=True, stdout=out)
        text = out.getvalue()
        self.assertEqual(text.strip(), 'dry-run matched=1')
        self.assertNotIn(self.legacy_path, text)
        self.assertNotIn(self.resource.original_name, text)
        self.assertNotIn(self.project.title, text)

    @patch('core.management.commands.migrate_project_files_to_team_folders.nextcloud_bridge.sync_resource_acl')
    @patch('core.management.commands.migrate_project_files_to_team_folders.cloud.delete')
    @patch('core.management.commands.migrate_project_files_to_team_folders.cloud.upload')
    @patch('core.management.commands.migrate_project_files_to_team_folders.cloud.download')
    @patch('core.management.commands.migrate_project_files_to_team_folders.cloud.path_exists', return_value=False)
    @patch('core.management.commands.migrate_project_files_to_team_folders.nextcloud_bridge.ensure_user')
    @patch('core.management.commands.migrate_project_files_to_team_folders.nextcloud_bridge.ensure_project_space')
    def test_success_uses_project_owner_for_destination_then_deletes_legacy_source(
        self,
        ensure_space,
        ensure_user,
        path_exists,
        download,
        upload,
        delete,
        sync_acl,
    ):
        ensure_user.side_effect = self.identity_for
        upstream = FakeDownload(self.payload)
        download.return_value = upstream

        out = StringIO()
        call_command('migrate_project_files_to_team_folders', stdout=out)

        ensure_space.assert_called_once_with(self.project)
        self.assertEqual(ensure_user.call_args_list[0], call(self.uploader))
        self.assertEqual(ensure_user.call_args_list[1], call(self.owner))
        path_exists.assert_called_once_with(self.destination_identity, self.new_path)
        download.assert_called_once_with(self.source_identity, self.legacy_path)
        self.assertEqual(upload.call_args.args[0], self.destination_identity)
        self.assertEqual(upload.call_args.args[1], self.new_path)
        sync_acl.assert_called_once()
        delete.assert_called_once_with(self.source_identity, self.legacy_path)
        self.assertTrue(upstream.closed)

        self.resource.refresh_from_db()
        self.assertEqual(self.resource.storage_path, self.new_path)
        self.assertTrue(self.resource.metadata['nextcloud_team_folder'])
        self.assertEqual(self.resource.metadata['migrated_from'], self.legacy_path)
        self.assertIn('migration complete migrated=1', out.getvalue())
        self.assertNotIn(self.new_path, out.getvalue())

    @patch('core.management.commands.migrate_project_files_to_team_folders.cloud.download')
    @patch('core.management.commands.migrate_project_files_to_team_folders.cloud.path_exists', return_value=True)
    @patch('core.management.commands.migrate_project_files_to_team_folders.nextcloud_bridge.ensure_user')
    @patch('core.management.commands.migrate_project_files_to_team_folders.nextcloud_bridge.ensure_project_space')
    def test_existing_destination_aborts_before_any_copy(
        self, ensure_space, ensure_user, path_exists, download
    ):
        ensure_user.side_effect = self.identity_for
        with self.assertRaises(CommandError) as exc:
            call_command('migrate_project_files_to_team_folders')
        self.assertIn('Destination already exists', str(exc.exception))
        self.assertNotIn(self.new_path, str(exc.exception))
        download.assert_not_called()
        self.resource.refresh_from_db()
        self.assertEqual(self.resource.storage_path, self.legacy_path)

    @patch('core.management.commands.migrate_project_files_to_team_folders.nextcloud_bridge.sync_resource_acl')
    @patch('core.management.commands.migrate_project_files_to_team_folders.cloud.delete')
    @patch('core.management.commands.migrate_project_files_to_team_folders.cloud.upload')
    @patch('core.management.commands.migrate_project_files_to_team_folders.cloud.download')
    @patch('core.management.commands.migrate_project_files_to_team_folders.cloud.path_exists', return_value=False)
    @patch('core.management.commands.migrate_project_files_to_team_folders.nextcloud_bridge.ensure_user')
    @patch('core.management.commands.migrate_project_files_to_team_folders.nextcloud_bridge.ensure_project_space')
    def test_acl_failure_rolls_back_database_and_removes_new_copy_for_retry(
        self,
        ensure_space,
        ensure_user,
        path_exists,
        download,
        upload,
        delete,
        sync_acl,
    ):
        ensure_user.side_effect = self.identity_for
        download.return_value = FakeDownload(self.payload)
        sync_acl.side_effect = RuntimeError('ACL service unavailable')

        with self.assertRaises(CommandError):
            call_command('migrate_project_files_to_team_folders')

        self.resource.refresh_from_db()
        self.assertEqual(self.resource.storage_path, self.legacy_path)
        self.assertNotIn('nextcloud_team_folder', self.resource.metadata)
        delete.assert_called_once_with(self.destination_identity, self.new_path)
        self.assertNotIn(call(self.source_identity, self.legacy_path), delete.call_args_list)

    @patch('core.management.commands.migrate_project_files_to_team_folders.nextcloud_bridge.sync_resource_acl')
    @patch('core.management.commands.migrate_project_files_to_team_folders.cloud.delete')
    @patch('core.management.commands.migrate_project_files_to_team_folders.cloud.upload')
    @patch('core.management.commands.migrate_project_files_to_team_folders.cloud.download')
    @patch('core.management.commands.migrate_project_files_to_team_folders.cloud.path_exists', return_value=False)
    @patch('core.management.commands.migrate_project_files_to_team_folders.nextcloud_bridge.ensure_user')
    @patch('core.management.commands.migrate_project_files_to_team_folders.nextcloud_bridge.ensure_project_space')
    def test_checksum_mismatch_removes_new_copy_and_keeps_legacy_pointer(
        self,
        ensure_space,
        ensure_user,
        path_exists,
        download,
        upload,
        delete,
        sync_acl,
    ):
        ensure_user.side_effect = self.identity_for
        download.return_value = FakeDownload(b'corrupted')

        with self.assertRaises(CommandError) as exc:
            call_command('migrate_project_files_to_team_folders')
        self.assertIn('Checksum mismatch', str(exc.exception))

        self.resource.refresh_from_db()
        self.assertEqual(self.resource.storage_path, self.legacy_path)
        delete.assert_called_once_with(self.destination_identity, self.new_path)
        sync_acl.assert_not_called()
