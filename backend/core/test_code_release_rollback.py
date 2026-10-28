"""Execute the workflow's actual rollback against an isolated temporary tree."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import textwrap
from unittest import skipUnless
from django.test import SimpleTestCase

ROOT = Path(__file__).resolve().parents[2]


@skipUnless(shutil.which('rsync') and shutil.which('tar'), 'requires deployment copy utilities')
class CodeReleaseRollbackTests(SimpleTestCase):
    def test_any_failed_or_missing_public_probe_triggers_the_error_trap(self):
        source = (ROOT / 'scripts/reliability/deploy-api-release.sh').read_text()
        function = re.search(r'^verify_public_probes\(\) \{\n(.*?)^\}', source, re.M | re.S).group(0)
        with tempfile.TemporaryDirectory() as directory:
            probes = Path(directory) / 'probes'
            for content, expected in [('ok\nok\n', 0), ('ok\nfailed_http_502\nok\n', 99), ('', 99)]:
                with self.subTest(content=content):
                    probes.write_text(content)
                    result = subprocess.run(['bash', '-Eeuo', 'pipefail', '-c',
                        "trap 'exit 99' ERR\n" + function + '\nverify_public_probes\necho accepted'],
                        env={**os.environ, 'PROBES': str(probes)}, capture_output=True, text=True, timeout=5)
                    self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
                    self.assertEqual('accepted' in result.stdout, expected == 0)

    def test_active_standby_aborts_before_overwriting_the_recovery_archive(self):
        source = (ROOT / 'scripts/reliability/deploy-api-release.sh').read_text()
        preflight = source[:source.index('sudo install -d -m 700 "$BACKUP"')]
        with tempfile.TemporaryDirectory() as directory:
            sudo = Path(directory) / 'sudo'
            sudo.write_text('#!/bin/bash\nif [ "$1" = systemctl ]; then exit 0; fi\nexit 88\n')
            sudo.chmod(0o755)
            result = subprocess.run(['bash', '-c', preflight, '_', '/stage', '/backend', 'test-revision', 'example.test'],
                env={**os.environ, 'PATH': directory + os.pathsep + os.environ['PATH']},
                capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn('previous standby is active', result.stderr)

    def test_rollback_removes_new_code_but_keeps_runtime_and_local_database(self):
        workflow = (ROOT / 'scripts/reliability/deploy-api-release.sh').read_text()
        match = re.search(r'^restore_code\(\) \{\n(.*?)^\}', workflow, re.M | re.S)
        self.assertIsNotNone(match)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            before = root / 'before'; before.mkdir()
            (before / 'api.py').write_text('previous version')
            os.utime(before / 'api.py', (1700000000, 1700000000))
            backup = root / 'backup'; backup.mkdir()
            with tarfile.open(backup / 'backend.tar', 'w') as archive:
                archive.add(before / 'api.py', arcname='api.py')
            live = root / 'live'; live.mkdir()
            (live / 'api.py').write_text('broken candidate')
            os.utime(live / 'api.py', (1700000000, 1700000000))
            (live / 'new_module.py').write_text('must disappear on rollback')
            (live / '.venv').mkdir(); (live / '.venv/keep').write_text('runtime')
            (live / 'test.sqlite3').write_text('current data')
            (live / 'staticfiles').mkdir(); (live / 'staticfiles/keep').write_text('static')
            commands = root / 'commands'; commands.mkdir()
            # This test exercises actual tar/rsync, not privilege or systemd.
            sudo = commands / 'sudo'
            sudo.write_text('#!/bin/bash\nif [[ "$1" == chown || "$1" == systemctl ]]; then exit 0; fi\nexec "$@"\n')
            sudo.chmod(0o755)
            env = {**os.environ, 'BACKUP': str(backup), 'BACKEND_PATH': str(live),
                   'PATH': str(commands) + os.pathsep + os.environ['PATH']}
            result = subprocess.run(['bash', '-euo', 'pipefail', '-c', textwrap.dedent(match.group(1))],
                                    env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((live / 'api.py').read_text(), 'previous version', result.stderr)
            self.assertFalse((live / 'new_module.py').exists())
            self.assertEqual((live / '.venv/keep').read_text(), 'runtime')
            self.assertEqual((live / 'test.sqlite3').read_text(), 'current data')
            self.assertEqual((live / 'staticfiles/keep').read_text(), 'static')
