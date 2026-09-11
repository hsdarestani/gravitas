from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]
WS = ROOT / 'assets' / 'ws'


class WorkspaceRuntimeContractTests(SimpleTestCase):
    def read(self, relative_path):
        return (ROOT / relative_path).read_text(encoding='utf-8')

    def test_workspace_boots_the_v4_module_runtime(self):
        html = self.read('workspace.html')
        self.assertIn('/assets/ws/ws.css', html)
        self.assertIn("import { start } from '/assets/ws/ws-app.js'", html)
        self.assertNotIn('/assets/dialog-compat.js', html)
        self.assertNotIn('function add(src,onload)', html)

    def test_v4_runtime_modules_exist(self):
        modules = [
            'ws-app.js',
            'ws-api.js',
            'ws-nav.js',
            'ws-platform.js',
            'ws-views.js',
            'ws-home.js',
            'ws-kms.js',
            'ws-kms-views.js',
            'ws-core-assets.js',
            'ws-palette.js',
            'ws-settings.js',
            'ws-ai.js',
            'ws-seed.js',
        ]
        for module in modules:
            with self.subTest(module=module):
                self.assertTrue((WS / module).is_file())

    def test_v4_runtime_does_not_depend_on_native_dialog_top_layer(self):
        for source in WS.glob('*.js'):
            text = source.read_text(encoding='utf-8')
            with self.subTest(source=source.name):
                self.assertNotIn('.showModal()', text)
                self.assertNotIn("createElement('dialog')", text)

    def test_navigation_and_workspace_router_share_the_same_v4_model(self):
        nav = self.read('assets/ws/ws-nav.js')
        app = self.read('assets/ws/ws-app.js')
        for route in (
            '/workspace/core',
            '/workspace/core/tasks',
            '/workspace/core/content',
            '/workspace/core/team',
            '/workspace/research',
            '/workspace/research/projects',
            '/workspace/research/notes',
            '/workspace/research/files',
            '/workspace/kms',
            '/workspace/kms/base',
        ):
            self.assertIn(route, nav)
        self.assertIn("from './ws-nav.js'", app)
