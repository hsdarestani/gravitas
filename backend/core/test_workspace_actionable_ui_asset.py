from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]
WORKSPACE = ROOT / 'workspace.html'
ASSET = ROOT / 'assets' / 'ws' / 'ws-actionable-ui.js'


class WorkspaceActionableUiAssetTests(SimpleTestCase):
    def test_workspace_loads_actionable_ui(self):
        html = WORKSPACE.read_text(encoding='utf-8')
        self.assertIn('/assets/ws/ws-actionable-ui.js?v=20260920-perf1', html)

    def test_actionable_ui_exposes_real_actions(self):
        source = ASSET.read_text(encoding='utf-8')
        for marker in (
            "['Tasks & Execution', 'Tasks']",
            "['Team & Access', 'Team']",
            "P.call('/platform/team/'",
            "P.call(`/platform/team/${member.id}/password-reset/`",
            "P.call(`/platform/team/${member.id}/storage/`",
            "P.researchRequests()",
            "'/workspace/research/projects?category=client'",
            "'/workspace/operating?show=milestones'",
        ):
            self.assertIn(marker, source)

    def test_actionable_ui_uses_workspace_overlay_not_native_dialog(self):
        source = ASSET.read_text(encoding='utf-8')
        self.assertNotIn('.showModal()', source)
        self.assertNotIn("createElement('dialog')", source)
        self.assertNotIn('createElement("dialog")', source)
