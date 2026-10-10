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
        self.assertIn("import { start } from '/assets/ws/ws-app.js?v=20261011-r4", html)
        self.assertNotIn('/assets/dialog-compat.js', html)
        self.assertNotIn('function add(src,onload)', html)

    def test_v4_runtime_modules_exist(self):
        modules = [
            'ws-app.js',
            'ws-notes-store.js',
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
        self.assertIn("from './ws-nav.js?v=20261011-r4", app)
        # Search stays routable for old links but is intentionally not a
        # sidebar destination; the global workspace search owns discovery.
        self.assertNotIn("path: '/workspace/research/search'", nav)
        self.assertIn("view: 'research-search'", app)

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
        app = self.read('assets/ws/ws-app.js')
        notes = self.read('assets/ws/ws-nextcloud-native.js')
        self.assertIn("const localDayKey = (date) => `${date.getFullYear()}-", app)
        self.assertIn("const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;", notes)
        self.assertNotIn("toISOString().slice(0, 10)", app)

    def test_no_page_store_or_sample_pages_remain(self):
        # ws-api.js kept a second copy of every page and opened offline on
        # sample pages from ws-seed.js; the notes index replaced both.
        for name in ('ws-api.js', 'ws-seed.js'):
            self.assertFalse((WS / name).exists(), name)
        self.assertIn("import * as notes from './ws-notes-store.js", self.read('assets/ws/ws-app.js'))

    def test_notes_editor_interactions_are_wired(self):
        # Writing happens in Notes. Its editor carries what the removed block
        # editor offered: a block menu, per-line add and drag, inline
        # formatting, and a per-note menu with favorites, sharing and moving.
        commands = self.read('assets/ws/ws-notes-commands.js')
        notes = self.read('assets/ws/ws-nextcloud-native.js')
        for contract in ('export const COMMANDS', 'export function moveBlock', "'Add a block below'", "'Format selection'"):
            self.assertIn(contract, commands)
        for contract in ('function openRowMenu', 'Add to favorites', "'Share…'", 'Move to', 'function openShare'):
            self.assertIn(contract, notes)

    def test_zip_reference_tree_and_task_interactions_are_wired(self):
        research = self.read('assets/ws/ws-research.js')
        nav = self.read('assets/ws/ws-nav.js')
        app = self.read('assets/ws/ws-app.js')
        # A [[link]] to an unwritten note still opens Notes on a new one.
        self.assertIn("if (id.startsWith('phantom-'))", app)
        self.assertIn("go(`/workspace/page/${item.id}`)", research)
        self.assertIn("Sort: due date", research)
        self.assertIn("rkms-timeline__bar", research)
        # Notebooks have their own sidebar; the index draws no page tree.
        self.assertNotIn("tree: true", nav)

    def test_resource_views_have_download_and_open_actions(self):
        views = self.read('assets/ws/ws-views.js')
        self.assertIn('function resourceRow(item)', views)
        self.assertIn('/api/platform/files/${item.id}/download/', views)
        self.assertIn('Open with…', views)

