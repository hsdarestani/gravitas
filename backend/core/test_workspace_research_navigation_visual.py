from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]
NAV = ROOT / 'assets' / 'ws' / 'ws-nav.js'
APP = ROOT / 'assets' / 'ws' / 'ws-app.js'
HOME = ROOT / 'assets' / 'ws' / 'ws-home.js'
RESEARCH = ROOT / 'assets' / 'ws' / 'ws-research.js'
LMS = ROOT / 'assets' / 'ws' / 'ws-member-lms.js'
PROGRESS = ROOT / 'assets' / 'ws' / 'ws-member-progress.js'
NOTES = ROOT / 'assets' / 'ws' / 'ws-nextcloud-native.js'


class WorkspaceResearchNavigationVisualTests(SimpleTestCase):
    def test_research_navigation_is_flat_and_task_oriented(self):
        source = NAV.read_text(encoding='utf-8')
        for label in (
            "label: 'Overview'",
            "label: 'Projects'",
            "label: 'Notes'",
            "label: 'Files & Data'",
            "label: 'Tasks'",
            "label: 'Researchers'",
            "label: 'Opportunities'",
        ):
            self.assertIn(label, source)

        research_block = source.split('export const RESEARCH_SECTIONS = [', 1)[1].split('\n];', 1)[0]
        self.assertNotIn("label: 'Editor'", research_block)
        self.assertNotIn("label: 'Folder'", research_block)
        self.assertNotIn("label: 'Collaboration'", research_block)
        self.assertNotIn("label: 'Search'", research_block)
        self.assertNotIn("tree: true", research_block)
        self.assertIn("group: 'Work'", research_block)
        self.assertIn("group: 'Connect'", research_block)

    def test_research_index_has_visual_grouping_and_series_icons(self):
        app = APP.read_text(encoding='utf-8')
        self.assertIn("'ws-index-group'", app)
        self.assertIn("row.dataset.series = series", app)
        self.assertIn("section.group", app)

    def test_workspace_overviews_use_real_dashboard_visuals(self):
        home = HOME.read_text(encoding='utf-8')
        research = RESEARCH.read_text(encoding='utf-8')
        lms = LMS.read_text(encoding='utf-8')
        progress = PROGRESS.read_text(encoding='utf-8')
        notes = NOTES.read_text(encoding='utf-8')

        self.assertIn("featured: true", home)
        self.assertIn("C.barRows", home)
        self.assertIn("dashboardSummary", research)
        self.assertIn("dashboardBars", research)
        self.assertIn("featured: true", lms)
        self.assertIn("C.gauge", lms)
        self.assertIn("featured: true", progress)
        self.assertIn("C.gauge", progress)
        self.assertIn("C.barRows", progress)
        self.assertIn("summaryTiles", notes)
        self.assertIn("C.statTile", notes)

    def test_visual4_cache_chain_reaches_changed_renderers(self):
        html = (ROOT / 'workspace.html').read_text(encoding='utf-8')
        app = APP.read_text(encoding='utf-8')
        five = (ROOT / 'assets' / 'ws' / 'ws-five-layer.js').read_text(encoding='utf-8')
        runtime = (ROOT / 'assets' / 'ws' / 'ws-design-runtime.js').read_text(encoding='utf-8')

        for marker in (
            '/assets/ws/ws-app.js?v=20260926-dragclose1',
            '/assets/ws/ws-five-layer.js?v=20260924-railsync1',
            '/assets/ws/ws-nextcloud-native.js?v=20260924-unify1',
            '/assets/ws/ws-unified-design.css?v=20260924-rhythm1',
            '/assets/ws/ws-design-runtime.js?v=20260924-rhythm1',
        ):
            self.assertIn(marker, html)

        self.assertIn("./ws-research.js?v=20260924-rhythm1", app)
        self.assertIn("./ws-nav.js?v=20260920-visual4", app)
        self.assertIn("./ws-home.js?v=20260924-unify1", app)
        self.assertIn("./ws-member-lms.js?v=20260924-unify1", five)
        self.assertIn("./ws-member-progress.js?v=20260924-unify1", five)
        self.assertIn("DESIGN_VERSION = '20260924-rhythm1'", runtime)
