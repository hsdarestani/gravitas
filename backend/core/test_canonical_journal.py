import json
from unittest.mock import patch
from django.test import TransactionTestCase
from .test_canonical_projects import MemoryDAV
from .canonical_journal import WriteBatch, recover_journal, RecoveryRequired, commit_witness, write_batch
from .canonical_models import CanonicalWriteCommit


class CanonicalJournalTests(TransactionTestCase):
    def setUp(self):
        from types import SimpleNamespace
        self.project = SimpleNamespace(pk=71)
        self.dav = MemoryDAV()
        for target, kwargs in [
            ('core.canonical_projects.dav_read', {'side_effect': self.dav.read}),
            ('core.canonical_projects.dav_write', {'side_effect': self.dav.write}),
            ('core.canonical_journal.dav_delete', {'side_effect': self.dav.delete}),
            ('core.canonical_journal.cloud.project_mountpoint', {'return_value': 'project'}),
            ('core.canonical_journal.cloud.project_group_id', {'return_value': 'group'}),
            ('core.canonical_journal.cloud.admin_make_folder', {}),
            ('core.canonical_journal.cloud.set_team_folder_acl', {}),
            ('core.canonical_acl.protect_service_folder', {}),
        ]:
            p = patch(target, **kwargs); p.start(); self.addCleanup(p.stop)

    def test_native_acl_revision_can_rebase_only_unchanged_persisted_journal(self):
        batch = WriteBatch(); journal = batch.journal(self.project)
        batch.persist(journal)
        self.dav.files[journal['path']]['etag'] = '"acl-revision"'
        journal['manifest']['review'] = 'next operation'
        batch.persist(journal)
        self.assertEqual(json.loads(self.dav.files[journal['path']]['content'])['review'], 'next operation')

    def test_rebased_journal_rejects_changed_manifest_and_replaced_native_identity(self):
        for change in ({'content': '{}', 'etag': '"external"'}, {'file_id': 'replaced', 'etag': '"external"'}):
            with self.subTest(change=change):
                batch = WriteBatch(); journal = batch.journal(self.project)
                batch.persist(journal)
                self.dav.files[journal['path']].update(change)
                journal['manifest']['review'] = 'next operation'
                with self.assertRaises(RecoveryRequired): batch.persist(journal)

    def test_rebased_journal_keeps_conditional_write_race_closed(self):
        batch = WriteBatch(); journal = batch.journal(self.project)
        batch.persist(journal)
        self.dav.files[journal['path']]['etag'] = '"acl-revision"'
        with patch('core.canonical_projects.dav_write', return_value=None) as write:
            with self.assertRaises(RecoveryRequired): batch.persist(journal)
        self.assertEqual(write.call_args.args[2], '"acl-revision"')

    def test_failed_second_file_restores_first_after_database_rollback(self):
        before = self.dav.write('project/project.md', 'original')
        batch = WriteBatch()
        batch.put(self.project, 'project/project.md', 'edited', before['etag'])
        second = self.dav.write('project/02_Working/Research/notes/other.md', 'b')
        self.assertIsNone(batch.put(self.project, 'project/02_Working/Research/notes/other.md', 'wrong', 'stale-etag'))
        batch.finalize()
        self.assertEqual(self.dav.files['project/project.md']['content'], 'original')
        manifest = json.loads(self.dav.files[batch.journals[71]['path']]['content'])
        self.assertEqual(manifest['state'], 'rolled_back')

    def test_commit_witness_rolls_back_with_database_transaction(self):
        from django.db import transaction
        before = self.dav.write('project/project.md', 'original')
        with self.assertRaisesMessage(ValueError, 'later operation failed'):
            with write_batch() as batch, transaction.atomic():
                batch.put(self.project, 'project/project.md', 'edited', before['etag'])
                commit_witness(batch)
                raise ValueError('later operation failed')
        self.assertFalse(CanonicalWriteCommit.objects.filter(pk=batch.id).exists())
        self.assertEqual(self.dav.files['project/project.md']['content'], 'original')

    def test_outer_transaction_rollback_leaves_pending_journal_for_recovery(self):
        from django.db import transaction
        path = 'project/project.md'
        before = self.dav.write(path, 'original')
        with self.assertRaises(ValueError):
            with transaction.atomic():
                with write_batch() as batch, transaction.atomic():
                    batch.put(self.project, path, 'edited', before['etag'])
                    commit_witness(batch)
                manifest = json.loads(self.dav.files[batch.journals[71]['path']]['content'])
                self.assertEqual(manifest['state'], 'pending')
                raise ValueError('outer failure')
        self.assertFalse(CanonicalWriteCommit.objects.filter(pk=batch.id).exists())
        batch.finalize()
        self.assertEqual(self.dav.files[path]['content'], 'original')

    def test_committed_database_witness_preserves_remote_and_replay(self):
        before = self.dav.write('project/project.md', 'original')
        batch = WriteBatch(); batch.put(self.project, 'project/project.md', 'edited', before['etag'])
        commit_witness(batch); batch.finalize(); batch.finalize()
        self.assertEqual(self.dav.files['project/project.md']['content'], 'edited')
        self.assertTrue(CanonicalWriteCommit.objects.filter(pk=batch.id).exists())

    def test_new_file_is_conditionally_removed_on_rollback(self):
        batch = WriteBatch(); batch.put(self.project, 'project/project.md', 'new', None)
        batch.finalize()
        self.assertNotIn('project/project.md', self.dav.files)

    def acl_store(self):
        from .canonical_acl import normalize
        path = 'project/02_Working/Research/notes/item'
        old = [{'type': 'group', 'id': 'group', 'mask': 31, 'permissions': 1}]
        state = {'rules': normalize(old), 'etag': '"acl1"'}
        def read(target):
            self.assertEqual(target, path)
            return {'rules': [dict(r) for r in state['rules']], 'etag': state['etag']}
        def write(target, rules, expected):
            self.assertEqual(target, path)
            if expected != state:
                return None
            state['rules'] = normalize(rules)
            state['etag'] += 'n'
            return read(target)
        for target, fn in [('core.canonical_acl.read_acl', read), ('core.canonical_acl.write_acl', write)]:
            p = patch(target, side_effect=fn); p.start(); self.addCleanup(p.stop)
        return path, old, state

    def test_acl_rollback_restores_previous_permissions_and_commit_retains_new(self):
        path, old, state = self.acl_store()
        batch = WriteBatch(); batch.acl(self.project, path, [])
        self.assertEqual(state['rules'], [])
        batch.finalize(); batch.finalize()
        self.assertEqual(state['rules'], old)
        batch = WriteBatch(); batch.acl(self.project, path, [])
        commit_witness(batch); batch.finalize()
        self.assertEqual(state['rules'], [])

    def test_external_acl_change_is_preserved_during_recovery(self):
        path, old, state = self.acl_store()
        batch = WriteBatch(); batch.acl(self.project, path, [])
        state['rules'] = [{'type': 'user', 'id': 'external-owner', 'mask': 31, 'permissions': 31}]
        with self.assertRaises(RecoveryRequired):
            batch.finalize()
        self.assertEqual(state['rules'][0]['id'], 'external-owner')

    def test_root_acl_uses_etag_after_its_descendant_journal_write(self):
        before = {'rules': [{'type': 'group', 'id': 'group', 'mask': 31, 'permissions': 1}], 'etag': 'old'}
        current = dict(before, etag='after-journal')
        with patch('core.canonical_acl.read_acl', side_effect=[before, current]), patch('core.canonical_acl.write_acl', return_value={'rules': [], 'etag': 'written'}) as write:
            WriteBatch().acl(self.project, 'project', [])
        write.assert_called_once_with('project', [], current)

    def test_external_acl_change_between_journal_and_write_is_preserved(self):
        before = {'rules': [], 'etag': 'old'}
        external = {'rules': [{'type': 'user', 'id': 'external', 'mask': 31, 'permissions': 31}], 'etag': 'changed'}
        with patch('core.canonical_acl.read_acl', side_effect=[before, external]), patch('core.canonical_acl.write_acl') as write:
            with self.assertRaises(RecoveryRequired):
                WriteBatch().acl(self.project, 'project', [{'type': 'group', 'id': 'group', 'mask': 31, 'permissions': 1}])
        write.assert_not_called()

    def test_ambiguous_acl_write_stops_for_review(self):
        path, old, state = self.acl_store()
        batch = WriteBatch()
        from .canonical_acl import write_acl
        def crash(*args):
            write_acl(*args)
            raise RuntimeError('crash after ACL write')
        with patch('core.canonical_acl.write_acl', side_effect=crash):
            with self.assertRaises(RuntimeError):
                batch.acl(self.project, path, [])
        with self.assertRaises(RecoveryRequired):
            batch.finalize()

    def test_deleted_file_restored_on_rollback_and_kept_deleted_on_commit(self):
        path = 'project/02_Working/Research/notes/note.md'
        before = self.dav.write(path, 'original note')
        batch = WriteBatch()
        self.assertTrue(batch.delete(self.project, path, before['etag']))
        self.assertNotIn(path, self.dav.files)
        batch.finalize()
        self.assertEqual(self.dav.files[path]['content'], 'original note')
        batch = WriteBatch()
        self.assertTrue(batch.delete(self.project, path, self.dav.files[path]['etag']))
        commit_witness(batch); batch.finalize(); batch.finalize()
        self.assertNotIn(path, self.dav.files)

    def test_delete_recovery_preserves_external_recreation(self):
        path = 'project/02_Working/Research/notes/note.md'
        before = self.dav.write(path, 'original')
        batch = WriteBatch(); batch.delete(self.project, path, before['etag'])
        self.dav.write(path, 'external recreation')
        with self.assertRaises(RecoveryRequired):
            batch.finalize()
        self.assertEqual(self.dav.files[path]['content'], 'external recreation')

    def test_external_edit_is_never_overwritten_by_recovery(self):
        before = self.dav.write('project/project.md', 'original')
        batch = WriteBatch(); batch.put(self.project, 'project/project.md', 'edited', before['etag'])
        self.dav.external('project/project.md', 'external writer')
        with self.assertRaises(RecoveryRequired):
            batch.finalize()
        self.assertEqual(self.dav.files['project/project.md']['content'], 'external writer')

    def test_worker_crash_before_write_leaves_safe_replayable_journal(self):
        before = self.dav.write('project/project.md', 'original')
        batch = WriteBatch()
        original = self.dav.write
        def crashing(path, content, etag=None):
            if path == 'project/project.md':
                raise RuntimeError('worker stopped before PUT')
            return original(path, content, etag)
        with patch('core.canonical_projects.dav_write', side_effect=crashing):
            with self.assertRaises(RuntimeError):
                batch.put(self.project, 'project/project.md', 'edited', before['etag'])
        self.assertEqual(recover_journal(batch.journals[71]['path']), 'rolled_back')

    def test_ambiguous_write_without_durable_etag_requires_review(self):
        before = self.dav.write('project/project.md', 'original')
        batch = WriteBatch(); original = self.dav.write
        def crashing(path, content, etag=None):
            result = original(path, content, etag)
            if path == 'project/project.md':
                raise RuntimeError('worker stopped after PUT')
            return result
        with patch('core.canonical_projects.dav_write', side_effect=crashing):
            with self.assertRaises(RuntimeError):
                batch.put(self.project, 'project/project.md', 'edited', before['etag'])
        with self.assertRaises(RecoveryRequired):
            recover_journal(batch.journals[71]['path'])
        self.assertEqual(self.dav.files['project/project.md']['content'], 'edited')


    def test_unchanged_acl_has_no_unwritten_journal_to_recover(self):
        path, old, state = self.acl_store()
        batch = WriteBatch()
        self.assertEqual(batch.acl(self.project, path, old), state)
        self.assertEqual(batch.journals, {})
        batch.finalize()
        self.assertFalse(self.dav.files)

    def test_stale_initial_file_save_has_no_missing_journal_on_finalize(self):
        before = self.dav.write('project/project.md', 'external')
        batch = WriteBatch()
        self.assertIsNone(batch.put(self.project, 'project/project.md', 'mine', '"stale"'))
        self.assertEqual(batch.journals, {})
        batch.finalize()
        self.assertEqual(self.dav.files['project/project.md'], before)
