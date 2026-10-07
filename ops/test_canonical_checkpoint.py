import importlib.util
import io
import json
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
            targets = {name: base / name[:-4] for name in ('site.tar', 'backend.tar', 'nextcloud.tar')}
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
                    self.assertEqual(len(list(base.glob('*.pre-restore-*'))), 3)

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


if __name__ == '__main__':
    unittest.main()
