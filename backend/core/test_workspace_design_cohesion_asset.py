from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]
WORKSPACE = ROOT / 'workspace.html'
COHESION = ROOT / 'assets' / 'ws' / 'ws-unified-design.css'


class WorkspaceDesignCohesionAssetTests(SimpleTestCase):
    def test_workspace_loads_cohesion_layer_last(self):
        html = WORKSPACE.read_text(encoding='utf-8')
        marker = '/assets/ws/ws-unified-design.css?v=20260920-visual4'
        self.assertIn(marker, html)
        self.assertGreater(
            html.index(marker),
            html.index('/assets/production-overrides.css'),
        )
        self.assertIn('/assets/ws/ws-design-runtime.js?v=20260920-visual4', html)

    def test_cohesion_layer_adopts_all_workspace_surface_families(self):
        source = COHESION.read_text(encoding='utf-8')
        for marker in (
            '--ws-cohesion-r: var(--wc-r, 16px)',
            '.v-panel',
            '.fl-panel',
            '.au-panel',
            '.au-team__stat',
            '.ri__metric',
            '.ri-card',
            '.nc-notes__list',
            '.nc-notes__editor',
            '.rkms-lane',
            '.rkms-table-wrap',
            '.space-md-list',
            '.space-annotation-drawer',
            '.fl-course-chat',
            '.ws-action-dialog',
        ):
            self.assertIn(marker, source)

    def test_cohesion_layer_keeps_brand_tokens_authoritative(self):
        source = COHESION.read_text(encoding='utf-8').lower()
        for forbidden in ('#fff', '#ffffff', '#000', '#000000'):
            self.assertNotIn(forbidden, source)
        self.assertIn('var(--g-surface-raised)', source)
        self.assertIn('var(--g-hairline)', source)
        self.assertIn('var(--g-accent)', source)

    def test_cohesion_css_has_balanced_blocks(self):
        source = COHESION.read_text(encoding='utf-8')
        self.assertEqual(source.count('{'), source.count('}'))
