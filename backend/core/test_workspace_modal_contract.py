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
        self.assertIn("import { start } from '/assets/ws/ws-app.js", html)
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
            '/workspace/research/search',
            '/workspace/research/notes',
            '/workspace/research/files',
            '/workspace/kms',
            '/workspace/kms/base',
        ):
            self.assertIn(route, nav)
        self.assertIn("from './ws-nav.js", app)

    def test_research_search_uses_permission_filtered_platform_data(self):
        app = self.read('assets/ws/ws-app.js')
        platform = self.read('assets/ws/ws-platform.js')
        research = self.read('assets/ws/ws-research.js')
        self.assertIn("view: 'research-search'", app)
        self.assertIn("workspace=research&q=", platform)
        self.assertIn('P.searchResources(term)', research)
        self.assertIn('P.projects()', research)

    def test_space_sync_conflicts_require_an_explicit_direction(self):
        platform = self.read('assets/ws/ws-platform.js')
        research = self.read('assets/ws/ws-research.js')
        self.assertIn("error.data = data", platform)
        self.assertIn("P.syncSpace({ force: true, confirmed: true })", research)
        self.assertIn('P.reconcileSpace()', research)
        self.assertIn('Keep Gravitas version', research)
        self.assertIn('Use Nextcloud version', research)

    def test_journal_keys_use_the_readers_local_calendar_date(self):
        api = self.read('assets/ws/ws-api.js')
        self.assertIn('function localDateKey(date)', api)
        self.assertIn("const dateKey = localDateKey(date)", api)
        self.assertNotIn("const dateKey = date.toISOString().slice(0, 10)", api)

    def test_zip_reference_editor_interactions_are_wired(self):
        app = self.read('assets/ws/ws-app.js')
        for contract in (
            'Recently viewed', 'Bookmarked notes', "block.highlight",
            "block.comment", "wrap.draggable = true", "Open with…",
            "type = 'range'", "Page title to link",
        ):
            self.assertIn(contract, app)

    def test_zip_reference_tree_and_task_interactions_are_wired(self):
        api = self.read('assets/ws/ws-api.js')
        research = self.read('assets/ws/ws-research.js')
        nav = self.read('assets/ws/ws-nav.js')
        self.assertIn('decoratedServerNodes', api)
        self.assertIn("id: 'journal'", api)
        self.assertIn('phantom-', api)
        self.assertIn("ctx.go(`/workspace/page/${item.id}`)", research)
        self.assertIn("Sort: due date", research)
        self.assertIn("rkms-timeline__bar", research)
        self.assertIn("tree: true", nav)

    def test_resource_views_have_download_and_open_actions(self):
        views = self.read('assets/ws/ws-views.js')
        self.assertIn('function resourceRow(item)', views)
        self.assertIn('/api/platform/files/${item.id}/download/', views)
        self.assertIn('Open with…', views)

    def test_server_notes_only_use_real_space_folders_as_default_parents(self):
        app = self.read('assets/ws/ws-app.js')
        self.assertIn("if (api.state.mode === 'server') return null", app)
