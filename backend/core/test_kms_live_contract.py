from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]


class LiveKMSFrontendContractTests(SimpleTestCase):
    def test_every_knowledge_view_reads_the_account_store(self):
        # ws-kms.js held a seeded localStorage workspace and ws-kms-live.js
        # took over two of its six screens; one account store serves all six.
        # Base and Recall keep the loading notice ws-kms-live.js drew; the
        # other five screens wait through whenReady.
        store = (ROOT / 'assets/ws/ws-kms.js').read_text(encoding='utf-8')
        views = (ROOT / 'assets/ws/ws-kms-views.js').read_text(encoding='utf-8')
        self.assertIn("P.call('/platform/kms/state/')", store)
        self.assertIn("method: 'PUT', body: { state: store }", store)
        self.assertIn('if (!sync.ready && !sync.loading) return null;', store)
        self.assertNotIn('function seed()', store)
        self.assertNotIn('What does spaced repetition claim', store)
        self.assertNotIn('Memory: A Contribution', store)
        self.assertEqual(views.count('if (whenReady(host,'), 5)
        self.assertEqual(views.count('K.ready().then(() => {'), 3)
        self.assertIn("'Review queue clear'", views)
        self.assertIn("'Make recall card'", views)
        self.assertFalse((ROOT / 'assets/ws/ws-kms-live.js').exists())

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
        # One router: ws-app draws every route, calling the renderers itself.
        self.assertNotIn('installFiveLayer', shell)
        self.assertNotIn('installNextcloudNativeRouter', shell)
        app = (ROOT / 'assets/ws/ws-app.js').read_text(encoding='utf-8')
        self.assertIn('renderFiveLayer(host, { go, renderNotesMirror: renderMirrorRoute })', app)
        self.assertIn('renderNotesRoute(host)', app)
        self.assertIn("addEventListener('popstate', () => apply(location.pathname + location.search));", app)
