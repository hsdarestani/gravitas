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

    def test_cockpit_snapshot_keeps_acl_without_crawling_native_project(self):
        self.adopt()
        url = f'/api/platform/projects/{self.project.pk}/cockpit/?read_mode=snapshot'
        with patch('core.canonical_middleware.refresh_project') as refresh:
            response = self.client.get(url)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['read_mode'], 'snapshot')
        self.assertEqual(response.json()['counts']['notes'], 1)
        self.assertEqual(response.json()['resources'][0]['id'], self.note.pk)
        refresh.assert_not_called()
        self.client.force_login(self.outsider)
        self.assertNotEqual(self.client.get(url).status_code, 200)

    def test_adopted_research_panels_read_without_dav_and_still_enforce_acl(self):
        from .research_models import ResearchExperiment
        ResearchExperiment.objects.create(
            project=self.project, owner=self.owner, title='Proof of concept'
        )
        self.adopt()
        root = f'/api/platform/projects/{self.project.pk}/'
        endpoints = [
            ('experiments/', 200),
            ('tools/data/tables/', 200),
            ('tools/external/datasets/', 409),
        ]
        with patch(
            'core.canonical_middleware.refresh_project',
            side_effect=AssertionError('Read-only research panels must not await Nextcloud'),
        ):
            for path, status in endpoints:
                with self.subTest(path=path):
                    result = self.client.get(root + path)
                    self.assertEqual(result.status_code, status, result.content)
            self.assertEqual(
                len(self.client.get(root + 'experiments/').json()['experiments']), 1
            )
            self.client.force_login(self.viewer)
            for path, status in endpoints:
                with self.subTest(viewer_path=path):
                    self.assertEqual(self.client.get(root + path).status_code, status)
            self.client.force_login(self.outsider)
            for path, _ in endpoints:
                with self.subTest(outsider_path=path):
                    self.assertEqual(self.client.get(root + path).status_code, 404)

    def test_native_cockpit_read_still_refreshes_source(self):
        self.adopt()
        with patch('core.canonical_middleware.refresh_project') as refresh:
            response = self.client.get(f'/api/platform/projects/{self.project.pk}/cockpit/')
        self.assertEqual(response.status_code, 200)
        refresh.assert_called_once()

    def test_live_folder_listing_does_not_refresh_unrelated_file_contents(self):
        self.adopt()
        with patch('core.canonical_api.listing', return_value=[]), patch('core.canonical_middleware.refresh_project') as refresh:
            response = self.client.get(f'/api/platform/projects/{self.project.pk}/structure/')
        self.assertEqual(response.status_code, 200, response.content)
        refresh.assert_not_called()

    def test_adopted_project_tool_selection_does_not_sync_nextcloud(self):
        """Only profile metadata changes; adopted native documents are untouched."""
        from .platform_models import ResearchProjectProfile
        self.adopt()
        original = dict(self.dav.files)
        path = f'/api/platform/projects/{self.project.pk}/tools/selection/'
        with (patch('core.canonical_middleware.refresh_project',
                    side_effect=AssertionError('Selection should not refresh DAV')),
              patch('core.canonical_middleware.refresh_task_scope',
                    side_effect=AssertionError('Selection should not refresh a task'))):
            response = self.client.patch(path, json.dumps({
                'selected_integrations': ['git'],
                'requested_plugins': ['Microscope viewer'],
            }), content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        profile = ResearchProjectProfile.objects.get(project=self.project)
        self.assertEqual(profile.selected_integrations, ['git'])
        self.assertEqual(profile.requested_plugins, ['Microscope viewer'])
        self.assertEqual(self.dav.files, original)

    def test_snapshot_query_cannot_bypass_task_write_boundary(self):
        from .operating_models import OperatingTask
        with transaction.atomic():
            task = OperatingTask.objects.create(workspace=ensure_platform_workspaces(self.owner)['core'], project=self.project, owner=self.owner, title='Real task', definition_of_done='Saved task')
        self.adopt()
        with patch('core.canonical_middleware.refresh_task_scope') as refresh:
            response = self.client.patch(f'/api/operating/task-board/{task.pk}/?read_mode=snapshot', data=json.dumps({'title': 'Edited task'}), content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        refresh.assert_called_once()
        task.refresh_from_db()
        self.assertEqual(task.title, 'Edited task')

    def test_missing_cached_native_identity_is_refreshed_without_a_content_revision(self):
        self.adopt()
        file = CanonicalFile.objects.get(project=self.project, path='project.md')
        revision_count = file.revisions.count()
        CanonicalFile.objects.filter(pk=file.pk).update(file_id='')
        refresh_project(self.project, self.owner)
        file.refresh_from_db()
        self.assertEqual(file.file_id, self.dav.files[self.full('project.md')]['file_id'])
        self.assertEqual(file.revisions.count(), revision_count)

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

    def test_task_work_log_survives_native_nextcloud_roundtrip(self):
        from .models import KnowledgeResource
        from .canonical_projects import relative_path
        self.adopt()
        task = self.client.post(
            f'/api/platform/projects/{self.project.pk}/tasks/',
            data={'title': 'Canonical timer task', 'due_date': '2026-10-20'},
            content_type='application/json',
        )
        self.assertEqual(task.status_code, 201, task.content)
        task_id = task.json()['task']['id']
        url = f'/api/platform/projects/{self.project.pk}/tasks/{task_id}/time/'
        started = self.client.post(url, data={'action': 'start'}, content_type='application/json')
        self.assertEqual(started.status_code, 200, started.content)
        note = KnowledgeResource.objects.get(project=self.project, metadata__pm_type='task_time_log_v1')
        path = self.full(relative_path(note))
        self.assertIn('active_started_at', self.dav.files[path]['content'])
        stopped = self.client.post(url, data={'action': 'stop', 'note': 'Native time log'}, content_type='application/json')
        self.assertEqual(stopped.status_code, 200, stopped.content)
        self.assertEqual(stopped.json()['entry_count'], 1)
        self.assertIn('Native time log', self.dav.files[path]['content'])
        self.dav.external(path, self.dav.files[path]['content'].replace('Native time log', 'Nextcloud edited note'))
        reloaded = self.client.get(url)
        self.assertEqual(reloaded.status_code, 200, reloaded.content)
        self.assertEqual(reloaded.json()['entries'][0]['note'], 'Nextcloud edited note')

    def test_schedule_planner_roundtrips_to_native_nextcloud_markdown(self):
        self.adopt()
        created = self.client.post(
            f'/api/platform/projects/{self.project.pk}/tasks/',
            data={'title': 'Plan scientific review', 'due_date': '2026-10-20'},
            content_type='application/json',
        )
        self.assertEqual(created.status_code, 201, created.content)
        task_id = created.json()['task']['id']
        endpoint = f'/api/platform/projects/{self.project.pk}/schedules/'
        result = self.client.post(endpoint, data={
            'task_id': task_id, 'start_date': '2026-10-14',
            'end_date': '2026-10-19', 'estimated_minutes': 420,
        }, content_type='application/json')
        self.assertEqual(result.status_code, 200, result.content)
        schedule = KnowledgeResource.objects.get(
            project=self.project, metadata__pm_type='task_schedule_v1')
        path = self.full(relative_path(schedule))
        self.assertIn('| 2026-10-14 | 2026-10-19 | 420 |', self.dav.files[path]['content'])
        self.dav.external(path, self.dav.files[path]['content'].replace(
            '| 2026-10-14 | 2026-10-19 | 420 |',
            '| 2026-10-15 | 2026-10-18 | 300 |'))
        listing = self.client.get(endpoint)
        self.assertEqual(listing.status_code, 200, listing.content)
        self.assertEqual(listing.json()['schedules'][0]['start_date'], '2026-10-15')
        self.assertEqual(listing.json()['schedules'][0]['estimated_minutes'], 300)

    def test_nextcloud_notes_mirror_is_not_canonical_user_content(self):
        from .canonical_journal import canonical_operation
        self.note.metadata = {
            'ws_space': 'research',
            'nextcloud_notes': {'id': 42, 'etag': 'old', 'state': 'synced'},
        }
        self.note.save(update_fields=['metadata'])
        self.adopt()
        path = self.full(relative_path(self.note))
        native = self.dav.files[path]['content']
        self.assertNotIn('nextcloud_notes', native)
        self.assertEqual(decode(self.note, native)['metadata'], {'ws_space': 'research'})

        # Simulate a legacy .md header containing an obsolete mirror snapshot.
        header, _, body = native.partition('\n')
        legacy = json.loads(header[len('<!-- gravitas:'):-len(' -->')])
        legacy['fields']['metadata']['nextcloud_notes'] = {
            'id': 42, 'etag': 'obsolete', 'state': 'synced',
        }
        legacy_content = '<!-- gravitas:' + json.dumps(
            legacy, ensure_ascii=False, sort_keys=True) + ' -->\n' + body
        self.dav.external(path, legacy_content)

        # The independent Notes connector legitimately advances its mirror
        # in SQL while the canonical document remains unchanged.
        fresh_mirror = {'id': 42, 'etag': 'fresh', 'state': 'synced'}
        KnowledgeResource.objects.filter(pk=self.note.pk).update(
            metadata={'ws_space': 'research', 'nextcloud_notes': fresh_mirror})
        refresh_project(self.project, self.owner)
        self.note.refresh_from_db()
        self.assertEqual(self.note.metadata['nextcloud_notes'], fresh_mirror)
        self.assertEqual(self.note.metadata['ws_space'], 'research')
        self.assertEqual(encode(self.note), native)

        # Even a real user edit must never leak the mirror into the source.
        with canonical_operation(self.owner):
            self.note.body = 'New user content'
            self.note.save()
        self.assertIn('New user content', self.dav.files[path]['content'])
        self.assertNotIn('nextcloud_notes', self.dav.files[path]['content'])

    def test_native_user_metadata_edits_still_flow_into_projection(self):
        self.note.metadata = {'ws_space': 'research', 'nextcloud_notes': {'etag': 'local'}}
        self.note.save(update_fields=['metadata'])
        self.adopt()
        path = self.full(relative_path(self.note))
        original = self.dav.files[path]['content']
        header, _, body = original.partition('\n')
        payload = json.loads(header[len('<!-- gravitas:'):-len(' -->')])
        payload['fields']['metadata']['ws_folder'] = 'Reviewed'
        self.dav.external(path, '<!-- gravitas:' + json.dumps(
            payload, ensure_ascii=False, sort_keys=True) + ' -->\n' + body)
        refresh_project(self.project, self.owner)
        self.note.refresh_from_db()
        self.assertEqual(self.note.metadata['ws_folder'], 'Reviewed')
        self.assertEqual(self.note.metadata['nextcloud_notes'], {'etag': 'local'})

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

    def test_canonical_editor_preserves_versions_and_enforces_read_acl(self):
        self.adopt()
        content_url = f'/api/platform/projects/{self.project.pk}/file-content/?path=project.md'
        history_url = f'/api/platform/projects/{self.project.pk}/file-revisions/?path=project.md'
        original = self.client.get(content_url).json()
        draft = original['content'].replace('one', 'new draft')
        saved = self.client.put(content_url,
            json.dumps({'content': draft, 'etag': original['etag']}),
            content_type='application/json')
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(saved.json()['content'], draft)
        history = self.client.get(history_url)
        self.assertEqual(history.status_code, 200, history.content)
        self.assertEqual(history.json()['current_etag'], saved.json()['etag'])
        versions = history.json()['revisions']
        self.assertTrue(any(v['etag'] == original['etag'] for v in versions))
        prior = next(v for v in versions if v['etag'] == original['etag'])
        snapshot = self.client.get(history_url + '&revision_id=' + str(prior['id']))
        self.assertEqual(snapshot.status_code, 200)
        self.assertEqual(snapshot.json()['revision']['content'], original['content'])
        self.client.force_login(self.viewer)
        self.assertEqual(self.client.get(history_url).status_code, 200)
        self.assertEqual(self.client.put(content_url,
            json.dumps({'content': 'override', 'etag': saved.json()['etag']}),
            content_type='application/json').status_code, 403)
        self.client.force_login(self.outsider)
        self.assertEqual(self.client.get(history_url).status_code, 403)

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

    def test_core_board_http_edit_uses_canonical_transaction_and_retains_history(self):
        from .operating_models import OperatingTask
        core=ensure_platform_workspaces(self.owner)['core']
        task=OperatingTask.objects.create(workspace=core,project=self.project,owner=self.owner,
            title='Historical implementation',status='done',definition_of_done='Reported output',
            source_key='history:http-board',source_metadata={'activity_date_raw':'2026-09-07'})
        self.adopt()
        original_note_body=self.note.body
        self.note.body='An unrelated native note changed externally'
        native_note=encode(self.note)
        self.dav.external(self.full(relative_path(self.note)),native_note)
        self.note.refresh_from_db()
        response=self.client.patch(f'/api/operating/task-board/{task.pk}/',
            json.dumps({'priority':'p1'}),content_type='application/json')
        self.assertEqual(response.status_code,200,response.content)
        task.refresh_from_db()
        native=json.loads(self.dav.files[self.full(relative_path(task))]['content'])
        self.note.refresh_from_db()
        self.assertEqual(self.note.body,original_note_body)
        self.assertEqual(self.dav.files[self.full(relative_path(self.note))]['content'],native_note)
        self.assertEqual(native['fields']['priority'],'p1')
        self.assertEqual(native['fields']['source_key'],'history:http-board')
        self.assertIsNone(task.due_date)
        self.assertIsNone(task.completed_at)
        readback=self.client.get(f'/api/operating/task-board/{task.pk}/')
        self.assertEqual(readback.status_code,200,readback.content)
        self.assertEqual(readback.json()['task']['priority'],'p1')

    def test_core_board_http_creation_in_canonical_project_exports_native_file(self):
        from .operating_models import OperatingTask
        self.adopt()
        response=self.client.post('/api/operating/task-board/',json.dumps({
            'title':'Independent project work','project_id':self.project.pk,
            'owner_id':self.owner.pk,'definition_of_done':'Reviewed result','status':'draft','priority':'p2',
        }),content_type='application/json')
        self.assertEqual(response.status_code,201,response.content)
        task=OperatingTask.objects.get(pk=response.json()['task']['id'])
        native=json.loads(self.dav.files[self.full(relative_path(task))]['content'])
        self.assertEqual(native['fields']['title'],'Independent project work')
        self.assertEqual(task.project_id,self.project.pk)


@override_settings(NEXTCLOUD_ADMIN_USER='service', NEXTCLOUD_ADMIN_PASSWORD='fixture')
class NativeCanonicalRepresentationTests(TestCase):
    def test_get_without_file_id_binds_dav_identity_to_the_content_revision(self):
        from types import SimpleNamespace
        from .canonical_projects import dav_read
        metadata = b'<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:response><d:propstat><d:prop><oc:id>123instance</oc:id><d:getetag>"native"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>'
        with patch('core.canonical_projects.cloud._request', side_effect=[SimpleNamespace(status_code=200, content=b'original', headers={'ETag': '"native"'}), SimpleNamespace(status_code=207, content=metadata)]) as request:
            result = dav_read('GRV-000208/project.md')
        self.assertEqual(result, {'content': 'original', 'etag': '"native"', 'file_id': '123instance'})
        self.assertEqual(request.call_args.args[0], 'PROPFIND')
        self.assertEqual(request.call_args.kwargs['headers']['Depth'], '0')

    def test_changed_metadata_revision_cannot_be_attached_to_old_content(self):
        from types import SimpleNamespace
        from .canonical_projects import dav_read
        metadata = b'<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:response><d:propstat><d:prop><oc:id>123instance</oc:id><d:getetag>"changed"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>'
        with patch('core.canonical_projects.cloud._request', side_effect=[SimpleNamespace(status_code=200, content=b'original', headers={'ETag': '"native"'}), SimpleNamespace(status_code=207, content=metadata)]):
            with self.assertRaisesMessage(cloud.CloudError, 'canonical_read_revision_changed'):
                dav_read('GRV-000208/project.md')

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

