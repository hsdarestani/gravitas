"""AutoResearch must live only in its owning Research project (#223)."""

from pathlib import Path
from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]


class AutoResearchProjectPlacementTests(SimpleTestCase):
    def read(self, filename):
        return (ROOT / filename).read_text(encoding='utf-8')

    def test_global_research_dashboard_does_not_mount_autoresearch(self):
        dashboard = self.read('assets/ws/ws-home.js')
        self.assertIn('export function renderResearchIntelligence(host)', dashboard)
        self.assertNotIn('if (ctx.canCore) renderResearchIntelligence(layout);', dashboard)
        self.assertIn("/workspace/research/projects/223/autoresearch", dashboard)

    def test_only_owning_project_exposes_tab_and_reuses_existing_renderer(self):
        project = self.read('assets/ws/ws-project.js')
        self.assertIn("const AUTORESEARCH_PROJECT_ID = '223';", project)
        self.assertIn("const AUTORESEARCH_TAB = ['autoresearch', 'AutoResearch'];", project)
        self.assertIn("String(projectId) !== AUTORESEARCH_PROJECT_ID || !P.canOpenCore()", project)
        self.assertIn("else if (tab === 'autoresearch') renderResearchIntelligence(doc);", project)
        self.assertIn("from './ws-home.js?v=", project)

    def test_route_and_navigation_resolve_to_project(self):
        router = self.read('assets/ws/ws-five-layer.js')
        self.assertIn("'overview', 'autoresearch', 'milestones'", router)
        self.assertIn("if (match[2] === 'autoresearch' && match[1] !== '223')", router)
        self.assertIn("return { kind: 'redirect', to:", router)
        link = '/workspace/research/projects/223/autoresearch#research-intelligence-title'
        self.assertIn(link, self.read('assets/ws/ws-ai.js'))
        self.assertIn(link, self.read('backend/core/assistant_api.py'))
        self.assertNotIn('/workspace/research#research-intelligence-title',
                         self.read('backend/core/assistant_api.py'))
