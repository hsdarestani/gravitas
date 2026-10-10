from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]
WS = ROOT / 'assets' / 'ws'


class WorkspaceActionableUiAssetTests(SimpleTestCase):
    """What ws-actionable-ui.js patched in is now drawn by each screen.

    The overlay renamed menu entries, made tiles clickable by matching their
    labels, filtered lists by hiding rows, and replaced Team and Research
    Requests wholesale after they had drawn. Each of those now lives where
    the thing is built, and the module is gone.
    """

    def read(self, name):
        return (WS / name).read_text(encoding='utf-8')

    def test_overlay_is_gone(self):
        self.assertFalse((WS / 'ws-actionable-ui.js').exists())
        self.assertNotIn('ws-actionable-ui', (ROOT / 'workspace.html').read_text(encoding='utf-8'))
        # The styles it injected at boot are a sheet now, at the same point
        # in the cascade: before the unified sheet, which comes last.
        boot = self.read('ws-boot-styles.css')
        for marker in ('.au-team', '.au-panel', '.au-row', '.au-modal', '.v-stat[data-actionable]'):
            self.assertIn(marker, boot)

    def test_menus_carry_their_short_names(self):
        nav = self.read('ws-nav.js')
        for label in ("menu: 'Tasks',", "menu: 'Content',", "menu: 'Team',"):
            self.assertIn(label, nav)
        five = self.read('ws-five-layer.js')
        for entry in ("['Catalog', '/workspace/learning/catalog'", "['Users', '/workspace/core/admin/users'", "['Deck', '/workspace/core/admin/deck'"):
            self.assertIn(entry, five)

    def test_core_team_is_one_renderer_with_real_actions(self):
        team = self.read('ws-core-team.js')
        for marker in (
            "P.call('/platform/team/'",
            "P.call(`/platform/team/${member.id}/password-reset/`",
            "P.call(`/platform/team/${member.id}/storage/`",
            "export async function renderCoreTeam",
        ):
            self.assertIn(marker, team)
        self.assertIn("else if (view === 'core-team') renderCoreTeam(host, ctx);", self.read('ws-app.js'))

    def test_tiles_open_what_they_count(self):
        lms = self.read('ws-member-lms.js')
        self.assertIn("metric(data.library.saved_count, 'Saved', '', reveal(saved.box))", lms)
        self.assertIn("metric(data.discussions.pending, 'Pending review', '', open('?status=pending'))", lms)
        self.assertIn("el('div', 'au-filter-note')", lms)
        self.assertIn("get('status')", lms)
        research = self.read('ws-research.js')
        self.assertIn("get('category')", research)
        home = self.read('ws-home.js')
        self.assertIn("ctx.go('/workspace/research/projects?category=client')", home)

    def test_dialogs_are_workspace_overlays_not_native(self):
        for name in ('ws-research-create.js', 'ws-core-team.js', 'ws-admin-kit.js'):
            source = self.read(name)
            self.assertNotIn('.showModal()', source, name)
            self.assertNotIn("createElement('dialog')", source, name)
        self.assertIn("el('section', 'ws-action-dialog')", self.read('ws-research-create.js'))
