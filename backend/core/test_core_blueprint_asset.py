"""Contract tests for Core's Assets & Blueprints section and the Knowledge
workspace.

These assert against the v4 workspace shell in assets/ws/. The previous
version of this file asserted against assets/platform-v3-navigation.js and
assets/workspace-shell-session.js, neither of which has existed since the
shell was rewritten, so every test in it failed on a missing file rather than
on a broken contract. The guarantees are the same ones, moved to the code
that now provides them:

  * Core's navigation offers Assets & Blueprints, and the blueprint under it.
  * All sixteen sections are present, with their owners unchanged.
  * The eleven-stage lifecycle keeps its order.
  * The one-owner-per-task rule survives, because it is the rule the whole
    approval step exists to establish.
  * Core is refused to non-members rather than merely hidden from them.
"""

from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]

WS = ROOT / 'assets' / 'ws'


SECTION_OWNERS = {
    'Content Strategy & Objectives': 'Ahmad',
    'Content Types & Formats': 'Ahmad + Kiarash',
    'Idea & Content Discovery': 'Ahmad',
    'Research & Scientific Validation': 'Sajad',
    'Content Planning': 'Ahmad',
    'Content Production': 'Kiarash + Ahmad',
    'Design & Content Experience': 'Kiarash',
    'Review & Quality Control': 'Sajad',
    'Publishing': 'Kiarash',
    'Distribution': 'Ahmad',
    'Repurposing & Content Atomisation': 'Ahmad',
    'Measurement & Learning': 'Kiarash',
    'Content Archive & Knowledge Integration': 'Hossein',
    'Content Operations & Workflow': 'Hossein',
    'AI & Automation': 'Hossein',
    'Content Risk & Governance': 'Hossein + Sajad',
}


class WorkspaceShellContractTests(SimpleTestCase):
    def read(self, relative_path):
        return (ROOT / relative_path).read_text(encoding='utf-8')

    def test_workspace_html_boots_the_v4_shell(self):
        html = self.read('workspace.html')
        self.assertIn('/assets/ws/ws.css', html)
        self.assertIn("import { start } from '/assets/ws/ws-app.js'", html)


class CoreBlueprintContractTests(SimpleTestCase):
    def read(self, relative_path):
        return (ROOT / relative_path).read_text(encoding='utf-8')

    def test_core_navigation_exposes_assets_and_blueprints(self):
        nav = self.read('assets/ws/ws-nav.js')
        self.assertIn("label: 'Assets & Blueprints'", nav)
        self.assertIn("path: '/workspace/core/assets'", nav)
        self.assertIn("label: 'Content Studio Blueprint'", nav)
        self.assertIn("path: '/workspace/core/assets/content-studio-blueprint'", nav)

    def test_both_asset_routes_resolve_to_their_own_view(self):
        app = self.read('assets/ws/ws-app.js')
        self.assertIn("view: 'core-assets'", app)
        self.assertIn("view: 'core-blueprint'", app)
        # The blueprint's route must be tried before the library's, or the
        # library pattern swallows it and the detail screen is unreachable.
        self.assertLess(app.index("view: 'core-blueprint'"), app.index("view: 'core-assets'"))
        self.assertIn('assets.renderCoreAssets(host, ctx)', app)
        self.assertIn('assets.renderContentStudioBlueprint(host, ctx)', app)

    def test_every_section_is_present_with_its_owner(self):
        js = self.read('assets/ws/ws-core-assets.js')
        for section, owner in SECTION_OWNERS.items():
            self.assertIn("title: '%s'" % section, js)
            self.assertIn("owner: '%s'" % owner, js)

    def test_every_section_has_a_plain_language_description(self):
        js = self.read('assets/ws/ws-core-assets.js')
        self.assertEqual(js.count("desc: '"), len(SECTION_OWNERS))
        self.assertIn('Defines why Gravitas creates content', js)
        self.assertIn('Checks scientific correctness, clarity and quality', js)
        self.assertIn('Tracks performance, captures what worked or failed', js)

    def test_lifecycle_keeps_its_order(self):
        js = self.read('assets/ws/ws-core-assets.js')
        expected = (
            "const LIFECYCLE = [\n"
            "  'strategy', 'discovery', 'research', 'planning', 'production',\n"
            "  'review', 'publishing', 'distribution', 'measurement', 'repurposing', 'archive',\n"
            "];"
        )
        self.assertIn(expected, js)

    def test_approval_precedes_task_breakdown(self):
        js = self.read('assets/ws/ws-core-assets.js')
        self.assertIn('GSA-001', js)
        self.assertIn('Approve scope and ownership', js)
        self.assertIn('Cut sections into tasks', js)
        self.assertIn('Commit deadlines', js)
        self.assertIn('Every task names exactly one owner.', js)
        self.assertIn(
            'Each task created inside Production must have exactly one named owner.',
            js,
        )

    def test_a_section_can_be_cut_into_a_real_task(self):
        js = self.read('assets/ws/ws-core-assets.js')
        self.assertIn("/operating/tasks/", js)
        self.assertIn("method: 'POST'", js)

    def test_core_is_refused_to_non_members(self):
        app = self.read('assets/ws/ws-app.js')
        self.assertIn("go('/workspace/research', { replace: true })", app)


class KnowledgeWorkspaceContractTests(SimpleTestCase):
    def read(self, relative_path):
        return (ROOT / relative_path).read_text(encoding='utf-8')

    def test_the_workspace_is_offered_and_reachable(self):
        nav = self.read('assets/ws/ws-nav.js')
        self.assertIn("id: 'kms'", nav)
        self.assertIn("home: '/workspace/kms'", nav)
        self.assertIn('WORKSPACES.research, WORKSPACES.kms', nav)

    def test_the_learning_loop_has_a_section_each(self):
        nav = self.read('assets/ws/ws-nav.js')
        for path in (
            '/workspace/kms/paths',
            '/workspace/kms/sources',
            '/workspace/kms/base',
            '/workspace/kms/recall',
            '/workspace/kms/skills',
        ):
            self.assertIn("path: '%s'" % path, nav)

    def test_every_knowledge_route_has_a_view(self):
        app = self.read('assets/ws/ws-app.js')
        for view in (
            'renderKmsOverview',
            'renderKmsPaths',
            'renderKmsPath',
            'renderKmsSources',
            'renderKmsBase',
            'renderKmsRecall',
            'renderKmsSkills',
        ):
            self.assertIn('kms.%s(' % view, app)

    def test_pages_are_scoped_by_workspace(self):
        nav = self.read('assets/ws/ws-nav.js')
        api = self.read('assets/ws/ws-api.js')
        # Each notes section declares which branch of the page store it opens.
        self.assertIn("space: 'core'", nav)
        self.assertIn("space: 'research'", nav)
        self.assertIn("space: 'kms'", nav)
        # And a page with no declared space stays where it always was.
        self.assertIn('export function spaceOfNode', api)
        self.assertIn("return 'research';", api)

    def test_core_has_its_own_notes_section(self):
        nav = self.read('assets/ws/ws-nav.js')
        views = self.read('assets/ws/ws-views.js')
        self.assertIn("path: '/workspace/core/notes'", nav)
        self.assertIn('export function renderCoreNotes', views)

    def test_a_level_is_computed_from_two_ingredients(self):
        js = self.read('assets/ws/ws-kms.js')
        # Retention alone and practice alone are both gameable, so the level
        # is the lower of the two. If that ever becomes a max() or a sum, the
        # number stops meaning anything and this test should fail.
        self.assertIn('Math.min(retained, practised)', js)
