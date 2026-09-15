from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]


class LiveKMSFrontendContractTests(SimpleTestCase):
    def test_exposed_learning_views_use_live_account_state(self):
        source = (ROOT / 'assets/ws/ws-kms-live.js').read_text(encoding='utf-8')
        self.assertIn("request('/platform/kms/state/'", source)
        self.assertIn("request('/workspace/pages/'", source)
        self.assertIn("space: 'kms'", source)
        self.assertIn('No demo cards were substituted.', source)
        self.assertNotIn('What does spaced repetition claim', source)
        self.assertNotIn('Hermann Ebbinghaus', source)

    def test_nextcloud_tabs_are_wrapped_by_authenticated_sso_launcher(self):
        bridge = (ROOT / 'assets/ws/ws-nextcloud-sso.js').read_text(encoding='utf-8')
        shell = (ROOT / 'workspace.html').read_text(encoding='utf-8')
        self.assertIn('/api/platform/nextcloud/sso/', bridge)
        self.assertIn("parsed.hostname === CLOUD_HOST", bridge)
        self.assertIn('installNextcloudSsoBridge();', shell)

    def test_workspace_does_not_bootstrap_platform_twice(self):
        shell = (ROOT / 'workspace.html').read_text(encoding='utf-8')
        self.assertNotIn('import { loadBootstrap }', shell)
        self.assertIn('const workspaceReady = start();', shell)
        self.assertIn('await waitForPlatform();', shell)
        self.assertLess(shell.index('installFiveLayer();'), shell.index('await workspaceReady;'))
