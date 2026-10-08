import json
from unittest.mock import patch, Mock
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.db import transaction
from . import cloud
from .canonical_models import CanonicalProject, CanonicalFile, CanonicalFileRevision
from .canonical_projects import adopt_project, decode, encode, export_object, refresh_project, merge_text, CanonicalConflict, relative_path, suppress
from .models import ResearchProject, KnowledgeResource, ProjectMembership
from .platform_runtime_v3 import ensure_platform_workspaces


class MemoryDAV:
    def __init__(self):
        self.files = {}; self.counter = 0
    def read(self, path, etag=None):
        row = self.files.get(path)
        if row and etag == row['etag']:
            return {'unchanged': True}
        return dict(row) if row else None
    def write(self, path, content, etag=None):
        row = self.files.get(path)
        if row and row['etag'] != etag or not row and etag:
            return None
        self.counter += 1
        self.files[path] = {'content': content, 'etag': f'"r{self.counter}"', 'file_id': str(self.counter)}
        return dict(self.files[path])
    def external(self, path, content):
        row = self.files[path]
        return self.write(path, content, row['etag'])

    def delete(self, path, etag):
        row = self.files.get(path)
        if row and row['etag'] != etag:
            return False
        self.files.pop(path, None)
        return True


@override_settings(SECURE_SSL_REDIRECT=False, GRAVITAS_CANONICAL_ADOPTION_ENABLED=True)
class CanonicalProjectTests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_superuser('canonical-owner', 'owner@example.test', 'pass')
        self.viewer = get_user_model().objects.create_user('canonical-viewer', 'viewer@example.test', 'pass')
        self.outsider = get_user_model().objects.create_user('canonical-outside', 'outside@example.test', 'pass')
        spaces = ensure_platform_workspaces(self.owner)
        self.project = ResearchProject.objects.create(workspace=spaces['research'], owner=self.owner, title='Existing Pulsar project', description='one\ntwo\nthree\nfour\n')
        self.note = KnowledgeResource.objects.create(workspace=self.project.workspace, project=self.project, owner=self.owner, kind='note', title='Existing architecture', body='Evidence\nexisting source material\n')
        ProjectMembership.objects.create(project=self.project, user=self.viewer, role='viewer')
        self.dav = MemoryDAV()
        for name, kwargs in [
            ('core.canonical_projects.dav_read', {'side_effect': self.dav.read}),
            ('core.canonical_projects.dav_write', {'side_effect': self.dav.write}),
            ('core.canonical_api.dav_read', {'side_effect': self.dav.read}),
            ('core.canonical_api.dav_write', {'side_effect': self.dav.write}),
            ('core.canonical_projects.file_acl', {}),
            ('core.canonical_projects.cloud.admin_make_folder', {}),
            ('core.canonical_projects.cloud.set_team_folder_acl', {}),
            ('core.canonical_acl.protect_service_folder', {}),
            ('core.canonical_projects.nextcloud_bridge.ensure_project_space', {}),
            ('core.canonical_journal.recover_project', {}),
            ('core.canonical_journal.dav_delete', {'side_effect': self.dav.delete}),
        ]:
            p = patch(name, **kwargs); p.start(); self.addCleanup(p.stop)
        self.client.force_login(self.owner)

    def adopt(self):
        return adopt_project(self.project, self.owner)

    @override_settings(GRAVITAS_CANONICAL_ADOPTION_ENABLED=False)
    def test_adoption_gate_leaves_existing_content_untouched(self):
        with self.assertRaisesMessage(ValueError, 'canonical_adoption_pending_operational_validation'):
            self.adopt()
        self.assertFalse(CanonicalProject.objects.filter(project=self.project, enabled=True).exists())
        self.assertEqual(self.dav.files, {})

    def full(self, path):
        return cloud.project_mountpoint(self.project) + '/' + path

    def test_adoption_backups_preserves_ids_and_is_idempotent(self):
        state = self.adopt()
        self.assertTrue(state.enabled)
        self.assertIn(state.migration_backup_path, self.dav.files)
        backup = json.loads(self.dav.files[state.migration_backup_path]['content'])
        self.assertIn(self.note.pk, [x['id'] for x in backup if x['type'] == 'KnowledgeResource'])
        self.assertIn(self.full('project.md'), self.dav.files)
        self.assertIn(self.full(relative_path(self.note)), self.dav.files)
        count = len(self.dav.files); self.adopt(); self.assertEqual(count, len(self.dav.files))
        self.assertEqual(KnowledgeResource.objects.filter(project=self.project).count(), 1)

    @override_settings(NEXTCLOUD_ADMIN_USER='canonical-service')
    def test_private_migration_and_journal_folders_keep_service_access(self):
        with patch('core.canonical_acl.protect_service_folder') as acl:
            self.adopt()
        private_calls = acl.call_args_list
        self.assertTrue(private_calls)
        self.assertTrue(any('CanonicalTransactions' in call.args[1] for call in private_calls))
        self.assertTrue(any('CanonicalMigration' in call.args[1] for call in private_calls))

    def test_note_surface_write_updates_canonical_and_external_edit_updates_projection(self):
        from .canonical_journal import canonical_operation
        self.adopt()
        with canonical_operation(self.owner):
            self.note.body = 'New note body'; self.note.save()
        path = self.full(relative_path(self.note))
        self.assertIn('New note body', self.dav.files[path]['content'])
        self.dav.external(path, self.dav.files[path]['content'].replace('New note body', 'External canonical note edit'))
        refresh_project(self.project, self.owner)
        self.note.refresh_from_db(); self.assertEqual(self.note.body, 'External canonical note edit')

    def test_background_write_rejected_before_sql_without_canonical_boundary(self):
        from .canonical_journal import RecoveryRequired
        self.adopt(); original = self.note.body
        self.note.body = 'unprotected background write'
        with self.assertRaises(RecoveryRequired):
            self.note.save()
        self.note.refresh_from_db()
        self.assertEqual(self.note.body, original)

    def test_generic_text_edit_checks_revision_and_viewer_access(self):
        response = Mock(status_code=200, content=b'external text', headers={'ETag': '"external"'})
        url = f'/api/platform/projects/{self.project.pk}/file-content/?path=02_Working/synthesis.md&edit=1'
        with patch('core.canonical_api.nextcloud_bridge.ensure_user', return_value=Mock(username='canonical-owner')), patch('core.canonical_api.cloud._auth', return_value=('caller', 'test-only')), patch('core.canonical_api.cloud._request', return_value=response) as dav:
            loaded = self.client.get(url)
            self.assertEqual(loaded.status_code, 200, loaded.content)
            stale = self.client.put(url, json.dumps({'content': 'mine', 'etag': '"old"'}), content_type='application/json')
            self.assertEqual(stale.status_code, 409, stale.content)
            self.assertEqual(stale.json()['conflict']['remote'], 'external text')
            self.assertTrue(all(call.args[0] == 'GET' for call in dav.call_args_list))
            self.client.force_login(self.viewer)
            denied = self.client.put(url, json.dumps({'content': 'mine', 'etag': '"external"'}), content_type='application/json')
            self.assertEqual(denied.status_code, 403)

    def test_viewer_cannot_upload_or_archive_project_files(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        self.client.force_login(self.viewer)
        url = f'/api/platform/projects/{self.project.pk}/structure/'
        with patch('core.canonical_api.cloud._request') as dav:
            result = self.client.post(url, {'action': 'upload', 'path': '02_Working/source.pdf', 'file': SimpleUploadedFile('source.pdf', b'source')})
            self.assertEqual(result.status_code, 403)
            result = self.client.post(url, json.dumps({'action': 'trash', 'path': '02_Working/source.pdf', 'etag': '"revision"'}), content_type='application/json')
            self.assertEqual(result.status_code, 403)
            dav.assert_not_called()

    def test_project_metadata_import_does_not_change_access_policy(self):
        from .platform_models import ResearchProjectProfile
        profile, _ = ResearchProjectProfile.objects.get_or_create(project=self.project)
        self.adopt()
        path = self.full(relative_path(profile))
        document = json.loads(self.dav.files[path]['content'])
        document['fields']['research_question'] = 'How does scoped context preserve project ACLs?'
        document['fields']['deadline'] = '2026-10-15'
        self.dav.external(path, json.dumps(document))
        refresh_project(self.project, self.owner)
        profile.refresh_from_db()
        self.assertEqual(profile.research_question, document['fields']['research_question'])
        self.assertEqual(str(profile.deadline), '2026-10-15')
        self.assertEqual(profile.visibility, 'private')

    def test_external_project_title_and_description_preserve_identity_and_owner(self):
        self.adopt()
        path = self.full('project.md')
        header, _, body = self.dav.files[path]['content'].partition('\n')
        payload = json.loads(header[len('<!-- gravitas:'):-len(' -->')])
        payload['fields']['title'] = 'External research title'
        updated = '<!-- gravitas:' + json.dumps(payload) + ' -->\nExternal research description'
        self.dav.external(path, updated)
        refresh_project(self.project, self.owner)
        self.project.refresh_from_db()
        self.assertEqual(self.project.title, 'External research title')
        self.assertEqual(self.project.description, 'External research description')
        self.assertEqual(self.project.owner_id, self.owner.pk)
        self.assertEqual(CanonicalProject.objects.get(project=self.project).project_id, self.project.pk)

    def test_membership_change_requires_boundary_and_propagates_all_child_acls(self):
        from .canonical_journal import canonical_operation, RecoveryRequired
        self.adopt()
        member = ProjectMembership.objects.get(project=self.project, user=self.viewer)
        member.role = 'editor'
        with self.assertRaises(RecoveryRequired):
            member.save()
        member.refresh_from_db()
        self.assertEqual(member.role, 'viewer')
        with patch('core.canonical_projects.nextcloud_bridge.ensure_project_space') as root_acl, patch('core.canonical_projects.file_acl') as children:
            with canonical_operation(self.owner):
                member.role = 'editor'
                member.save()
            root_acl.assert_called_once()
            self.assertGreater(children.call_count, 0)
        member.refresh_from_db()
        self.assertEqual(member.role, 'editor')

    def test_project_markdown_persists_and_api_viewer_cannot_edit(self):
        self.adopt()
        url = f'/api/platform/projects/{self.project.pk}/file-content/?path=project.md'
        response = self.client.get(url); self.assertEqual(response.status_code, 200, response.content)
        saved = self.client.put(url, json.dumps({'content': '# Pulsar\nReal existing project', 'etag': response.json()['etag']}), content_type='application/json')
        self.assertEqual(saved.status_code, 200, saved.content)
        self.project.refresh_from_db(); self.assertEqual(self.project.description, '# Pulsar\nReal existing project')
        self.client.force_login(self.viewer)
        denied = self.client.put(url, json.dumps({'content': 'overwrite', 'etag': saved.json()['etag']}), content_type='application/json')
        self.assertEqual(denied.status_code, 403, denied.content)
        self.client.force_login(self.outsider); self.assertEqual(self.client.get(url).status_code, 403)

    def test_nonoverlapping_three_way_text_merge_and_overlap_conflict(self):
        self.assertEqual(merge_text('a\nb\nc\nd\n', 'A\nb\nc\nd\n', 'a\nb\nc\nD\n'), 'A\nb\nc\nD\n')
        self.assertIsNone(merge_text('a\nb\n', 'A\nb\n', 'REMOTE\nb\n'))

    def test_stale_client_save_conflict_returns_both_and_can_resolve_with_current_etag(self):
        self.adopt()
        url = f'/api/platform/projects/{self.project.pk}/file-content/?path=project.md'
        original = self.client.get(url).json()
        self.dav.external(self.full('project.md'), 'REMOTE\ntwo\nthree\nfour\n')
        response = self.client.put(url, json.dumps({'content': 'MINE\ntwo\nthree\nfour\n', 'etag': original['etag']}), content_type='application/json')
        self.assertEqual(response.status_code, 409, response.content)
        conflict = response.json()['conflict']; self.assertIn('MINE', conflict['mine']); self.assertIn('REMOTE', conflict['remote'])
        resolved = self.client.put(url, json.dumps({'content': conflict['mine'], 'etag': conflict['etag']}), content_type='application/json')
        self.assertEqual(resolved.status_code, 200, resolved.content)
        self.assertTrue(CanonicalFileRevision.objects.filter(file__project=self.project, content__startswith='REMOTE').exists())

    def test_wrong_identity_rejected_without_mutating_database(self):
        self.adopt(); path = self.full(relative_path(self.note))
        value = self.dav.files[path]['content'].replace(f'"project_id": {self.project.pk}', '"project_id": 999999')
        self.dav.external(path, value)
        with self.assertRaisesMessage(ValueError, 'canonical_identity_changed'):
            refresh_project(self.project, self.owner)
        self.note.refresh_from_db(); self.assertEqual(self.note.body, 'Evidence\nexisting source material\n')

    def test_external_delete_does_not_recreate_content(self):
        self.adopt(); path = self.full('project.md'); del self.dav.files[path]
        with self.assertRaises(CanonicalConflict):
            export_object(self.project)
        self.assertNotIn(path, self.dav.files)

    def test_path_traversal_and_managed_move_rejected(self):
        with patch('core.canonical_api.listing', return_value=[]):
            url = f'/api/platform/projects/{self.project.pk}/structure/'
            denied = self.client.get(url + '?path=../other'); self.assertEqual(denied.status_code, 400)
            result = self.client.post(url, json.dumps({'action': 'move', 'path': 'project.md', 'target': 'other.md'}), content_type='application/json')
            self.assertEqual(result.status_code, 400)

    def test_failed_readback_or_acl_never_enables_project(self):
        with patch('core.canonical_projects.file_acl', side_effect=cloud.CloudError('ACL failed')):
            with self.assertRaises(cloud.CloudError):
                self.adopt()
        self.assertFalse(CanonicalProject.objects.filter(project=self.project, enabled=True).exists())


@override_settings(NEXTCLOUD_ADMIN_USER='service', NEXTCLOUD_ADMIN_PASSWORD='fixture')
class NativeCanonicalRepresentationTests(TestCase):
    def test_owner_dav_clients_and_admin_reads_share_strong_representation(self):
        from types import SimpleNamespace
        for method in ('GET', 'PUT', 'DELETE', 'MOVE', 'HEAD'):
            with self.subTest(method=method), patch('core.cloud.requests.request', return_value=SimpleNamespace(status_code=200)) as request:
                cloud._request(method, cloud._admin_dav_url('GRV-000208/project.md'), auth=('fixture', 'fixture'), expected={200}, headers={'If-Match': '"native"'})
                headers = request.call_args.kwargs['headers']
                self.assertEqual(headers['Accept-Encoding'], 'identity')
                self.assertEqual(headers['If-Match'], '"native"')

    def test_conditional_writes_use_the_same_native_representation_as_reads(self):
        from types import SimpleNamespace
        from .canonical_projects import dav_write
        from .canonical_journal import dav_delete
        with patch('core.canonical_projects.cloud.admin_make_folder') as folder, patch('core.canonical_projects.dav_read', return_value={'content': 'new', 'etag': '"next"'}), patch('core.canonical_projects.cloud._request', return_value=SimpleNamespace(status_code=204)) as request:
            dav_write('GRV-000208/project.md', 'new', '"native"')
            folder.assert_not_called()
            self.assertEqual(request.call_args.kwargs['headers'], {'Accept-Encoding': 'identity', 'If-Match': '"native"'})
            dav_write('GRV-000208/project.md', 'new')
            folder.assert_called_once_with('GRV-000208')
            self.assertEqual(request.call_args.kwargs['headers'], {'Accept-Encoding': 'identity', 'If-None-Match': '*'})
            dav_delete('GRV-000208/project.md', '"native"')
            self.assertEqual(request.call_args.kwargs['headers'], {'Accept-Encoding': 'identity', 'If-Match': '"native"'})

    def test_native_content_read_requests_identity_representation_for_write_etag(self):
        from types import SimpleNamespace
        from .canonical_projects import dav_read
        with patch('core.canonical_projects.cloud._request', return_value=SimpleNamespace(status_code=200, content=b'original', headers={'ETag': '"native"', 'OC-FileId': '1'})) as request:
            result = dav_read('GRV-000208/project.md', '"prior"')
        self.assertEqual(request.call_args.kwargs['headers'], {'Accept-Encoding': 'identity', 'If-None-Match': '"prior"'})
        self.assertEqual(result['etag'], '"native"')
