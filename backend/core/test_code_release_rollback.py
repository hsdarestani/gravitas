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
