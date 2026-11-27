import json
from pathlib import Path
import subprocess
import sys
import unittest


SERVICES = Path(__file__).with_name('services')


class IsolatedServiceConfigs(unittest.TestCase):
    def test_discourse_renderer_uses_scoped_hosts_volumes_and_smtp(self):
        result = subprocess.run(
            [sys.executable, str(SERVICES / 'discourse.py')], input='staging-fixture-only-' * 3,
            capture_output=True, text=True, check=True,
        )
        data = json.loads(result.stdout)
        self.assertEqual(data['expose'], ['127.0.0.1:18882:80'])
        self.assertEqual(data['env']['DISCOURSE_HOSTNAME'], 'forum-staging.graviquest.com')
        self.assertEqual(data['env']['DISCOURSE_SMTP_ADDRESS'], 'mailpit-staging')
        self.assertEqual(data['env']['DISCOURSE_DISCOURSE_CONNECT_URL'],
                         'https://staging.graviquest.com/api/forum/sso/')
        self.assertTrue(all(vol['volume']['host'].startswith('/var/lib/graviquest-staging/')
                            for vol in data['volumes']))
        self.assertRegex(data['params']['version'], '^[a-f0-9]{40}$')

    def test_discourse_renderer_refuses_short_secret(self):
        result = subprocess.run([sys.executable, str(SERVICES / 'discourse.py')], input='demo',
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')

    def test_tutor_rejects_unknown_operation_before_running(self):
        result = subprocess.run(['bash', str(SERVICES / 'tutor.sh'), 'preview'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('config|launch', result.stderr)
