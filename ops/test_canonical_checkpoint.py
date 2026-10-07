import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('checkpoint', Path(__file__).with_name('canonical_checkpoint.py'))
checkpoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checkpoint)


class CheckpointTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('CHECKPOINT_TEST_POSTGRES'), 'PostgreSQL integration fixture not configured')
    def test_real_postgres_copy_hash_is_independent_of_insertion_order(self):
        def fingerprint(values):
            sql = 'CREATE TEMP TABLE checkpoint_fixture (id integer, content text); INSERT INTO checkpoint_fixture VALUES ' + values + '; ' + checkpoint.fingerprint_sql('checkpoint_fixture')
            return checkpoint.stream_fingerprint(['psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql])
        first = fingerprint("(1, 'one'), (2, 'two'), (2, 'two')")
        self.assertEqual(first, fingerprint("(2, 'two'), (1, 'one'), (2, 'two')"))
        self.assertEqual(first['rows'], 3)
        self.assertNotEqual(first['hash'], fingerprint("(1, 'one'), (2, 'two')")['hash'])

    def test_streaming_fingerprint_preserves_duplicate_rows_and_counts(self):
        import sys
        fingerprint = checkpoint.stream_fingerprint([sys.executable, '-c', "import sys; sys.stdout.write('a' * 32 + '\\n'); sys.stdout.write('a' * 32 + '\\n')"])
        self.assertEqual(fingerprint['rows'], 2)
        single = checkpoint.stream_fingerprint([sys.executable, '-c', "print('a' * 32)"])
        self.assertNotEqual(fingerprint['hash'], single['hash'])

    def test_streaming_fingerprint_rejects_failed_query_even_after_valid_output(self):
        import sys
        with self.assertRaises(RuntimeError):
            checkpoint.stream_fingerprint([sys.executable, '-c', "print('a' * 32); raise SystemExit(1)"])

    def test_partial_pause_failure_restores_original_runtime_state(self):
        status = {'installed': True, 'needsDbUpgrade': False, 'maintenance': False, 'version': '34.0.3.2'}
        with patch.object(checkpoint, 'output', return_value=json.dumps(status)), patch.object(checkpoint, 'active_units', return_value=['gravitas-backend.service']), patch.object(checkpoint, 'save_json'), patch.object(checkpoint, 'run', side_effect=RuntimeError('failed to stop service')), patch.object(checkpoint, 'resume') as resume:
            with self.assertRaises(RuntimeError):
                checkpoint.pause()
            resume.assert_called_once_with({'units': ['gravitas-backend.service'], 'maintenance': False, 'nextcloud_version': '34.0.3.2'})

    def test_symlink_followed_by_child_cannot_write_outside_staging(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'unsafe.tar'
            with tarfile.open(path, 'w') as archive:
                link = tarfile.TarInfo('escape'); link.type = tarfile.SYMTYPE; link.linkname = '/tmp/outside'; archive.addfile(link)
                item = tarfile.TarInfo('escape/write'); item.size = 1; archive.addfile(item, io.BytesIO(b'x'))
            with self.assertRaises(ValueError):
                checkpoint.validate_tar(path)

    def exercise_restore(self, fail_second=False):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp); source = base / 'checkpoint'; source.mkdir()
            targets = {name: base / name[:-4] for name in (*checkpoint.SOURCES, 'nextcloud.tar')}
            for name, target in targets.items():
                target.mkdir(); (target / 'version').write_text('current')
                with tarfile.open(source / name, 'w') as archive:
                    entry = tarfile.TarInfo('version'); entry.size = len(b'snapshot'); archive.addfile(entry, io.BytesIO(b'snapshot'))
            for name in ('gravitas.dump', 'nextcloud.dump'):
                (source / name).write_bytes(b'PGDMPtest')
            commands = []; restored = 0
            def fake_run(command, **kwargs):
                nonlocal restored
                commands.append(command)
                if command[0] == 'tar':
                    return subprocess.run(command, check=True, **kwargs)
                if 'pg_restore' in command:
                    restored += 1
                    if fail_second and restored == 2:
                        raise RuntimeError('second staged DB restore failed')
                return None
            with patch.object(checkpoint, 'BASE', base), patch.object(checkpoint, 'SOURCES', {k: v for k, v in targets.items() if k != 'nextcloud.tar'}), patch.object(checkpoint, 'run', side_effect=fake_run), patch.object(checkpoint, 'output', return_value='1'):
                if fail_second:
                    with self.assertRaises(RuntimeError):
                        checkpoint.restore_files(source, targets['nextcloud.tar'], {})
                    self.assertFalse(any(any('ALTER DATABASE' in arg for arg in cmd) for cmd in commands))
                    self.assertTrue(all((p / 'version').read_text() == 'current' for p in targets.values()))
                else:
                    checkpoint.restore_files(source, targets['nextcloud.tar'], {})
                    swaps = [i for i, cmd in enumerate(commands) if any('ALTER DATABASE' in arg for arg in cmd)]
                    restores = [i for i, cmd in enumerate(commands) if 'pg_restore' in cmd]
                    self.assertGreater(min(swaps), max(restores))
                    self.assertTrue(all((p / 'version').read_text() == 'snapshot' for p in targets.values()))
                    self.assertEqual(len(list(base.glob('*.pre-restore-*'))), len(targets))

    def test_all_databases_are_staged_before_exchanging_any_live_store(self):
        self.exercise_restore()

    def test_failed_staged_database_does_not_exchange_live_databases_or_files(self):
        self.exercise_restore(fail_second=True)

    def test_integrity_failure_prevents_restore(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            checkpoint.save_json(path / 'manifest.json', {'schema': 1, 'state': 'complete', 'files': {n: {'sha256': 'wrong'} for n in checkpoint.FILES}})
            for name in checkpoint.FILES:
                (path / name).write_bytes(b'changed')
            with self.assertRaises(ValueError):
                checkpoint.verify(path)

    def test_rehearsal_uses_isolated_databases_and_cleans_failed_restore(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp); source = base / 'checkpoint'; source.mkdir()
            for name in checkpoint.FILES:
                (source / name).touch()
            calls = []
            def fake_run(command, **kwargs):
                calls.append(command)
                if 'pg_restore' in command:
                    raise RuntimeError('invalid staged archive')
            with patch.object(checkpoint, 'BASE', base), patch.object(checkpoint, 'verify', return_value={'databases': {'gravitas': {}, 'nextcloud': {}}}), patch.object(checkpoint, 'run', side_effect=fake_run):
                with self.assertRaises(RuntimeError):
                    checkpoint.rehearse(source)
            created = next(command[-1] for command in calls if 'createdb' in command)
            self.assertTrue(created.startswith('gravitas_rehearsal_'))
            self.assertTrue(any('dropdb' in command and command[-1] == created for command in calls))
            self.assertFalse(any(any('ALTER DATABASE' in arg for arg in command) for command in calls))
            self.assertFalse(list(base.glob('rehearsal-*')))


if __name__ == '__main__':
    unittest.main()
