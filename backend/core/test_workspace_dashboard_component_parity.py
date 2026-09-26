from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]
WS = ROOT / 'assets' / 'ws'


class WorkspaceDashboardComponentParityTests(SimpleTestCase):
    def read(self, name):
        return (WS / name).read_text(encoding='utf-8')

    def test_progress_is_built_from_dashboard_kit(self):
        source = self.read('ws-member-progress.js')
        self.assertIn("import * as C from './ws-charts.js", source)
        self.assertIn('const layout = C.bento()', source)
        self.assertIn('C.statTile({', source)
        self.assertIn("C.card({ title", source)
        self.assertIn('C.listItem({', source)

    def test_learning_overview_uses_dashboard_bento(self):
        source = self.read('ws-member-lms.js')
        self.assertIn('const layout = C.bento()', source)
        self.assertIn("label: 'In progress'", source)
        self.assertIn("current.box.dataset.span = '8'", source)
        self.assertIn("pathsBox.box.dataset.span = '6'", source)

    def test_core_and_research_overviews_use_dashboard_bento(self):
        source = self.read('ws-home.js')
        self.assertIn("import * as C from './ws-charts.js", source)
        self.assertIn("label: 'Open tasks'", source)
        self.assertIn("label: 'Active projects'", source)
        self.assertIn("today.dataset.span = '8'", source)
        self.assertIn("projects.dataset.span = '8'", source)
        self.assertIn("const section = el('section', 'ri wc-card')", source)
        self.assertIn('workspaceOverviewHead(scope, P.platform.user)', source)

    def test_shared_renderers_emit_real_dashboard_classes(self):
        shared = self.read('ws-views.js')
        self.assertIn("'v-panel wc-card'", shared)
        self.assertIn("'v-stats wc-tiles'", shared)
        self.assertIn('wc-item--button', shared)
        for name in ('ws-admin.js', 'ws-project.js', 'ws-member-lms.js'):
            source = self.read(name)
            self.assertIn('wc-card', source, name)
            self.assertIn('wc-item', source, name)

    def test_workspace_force_loads_rebuilt_renderers(self):
        html = (ROOT / 'workspace.html').read_text(encoding='utf-8')
        self.assertIn('/assets/ws/ws-app.js?v=20260926-calendar3', html)
        self.assertIn('/assets/ws/ws-five-layer.js?v=20260924-railsync1', html)
        self.assertIn('/assets/ws/ws-charts.css?v=20260924-unify1', html)
        self.assertIn('/assets/ws/ws-unified-design.css?v=20260924-rhythm1', html)

        app = self.read('ws-app.js')
        self.assertIn("./ws-home.js?v=20260924-unify1", app)
        self.assertIn("./ws-views.js?v=20260926-calendar3", app)
        self.assertIn("./ws-meetings.js?v=20260926-calendar2", app)

        five = self.read('ws-five-layer.js')
        for marker in (
            "./ws-member-lms.js?v=20260924-unify1",
            "./ws-member-progress.js?v=20260924-unify1",
            "./ws-admin.js?v=20260920-visual4",
            "./ws-project.js?v=20260920-visual4",
        ):
            self.assertIn(marker, five)
