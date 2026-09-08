from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]


class CoreBlueprintAssetContractTests(SimpleTestCase):
    def read(self, relative_path):
        return (ROOT / relative_path).read_text(encoding='utf-8')

    def test_workspace_routes_core_assets_to_dedicated_runtime(self):
        html = self.read('workspace.html')
        self.assertIn("var blueprint=/^\\/workspace\\/core\\/assets", html)
        self.assertIn('/assets/core-blueprints.css?v=20260908b', html)
        self.assertIn('/assets/core-blueprints.js?v=20260908b', html)
        self.assertIn('/assets/workspace-shell-session.js?v=20260830a', html)
        self.assertLess(html.index('else if(blueprint)'), html.index('else if(platform)'))

    def test_core_navigation_exposes_assets_and_blueprints(self):
        nav = self.read('assets/platform-v3-navigation.js')
        self.assertIn("'/workspace/core/assets','⌘','Assets & Blueprints'", nav)
        self.assertIn("['/workspace/core/assets','Core · Assets & Blueprints']", nav)
        self.assertIn("if(starts('/workspace/core/assets/'))return 'Content Studio Blueprint'", nav)

    def test_blueprint_is_core_guarded_and_has_approval_owners(self):
        js = self.read('assets/core-blueprints.js')
        self.assertIn("location.replace('/workspace/research')", js)
        self.assertIn('GSA-001', js)
        expected_sections = {
            'Content Strategy & Objectives': 'Ahmad',
            'Content Types & Formats': 'Ahmad + Kiarash',
            'Idea & Content Discovery': 'Ahmad',
            'Research & Scientific Validation': 'Sajjad',
            'Content Planning': 'Ahmad',
            'Content Production': 'Kiarash + Ahmad',
            'Design & Content Experience': 'Kiarash',
            'Review & Quality Control': 'Sajjad',
            'Publishing': 'Kiarash',
            'Distribution': 'Ahmad',
            'Repurposing & Content Atomization': 'Ahmad',
            'Measurement & Learning': 'Kiarash',
            'Content Archive & Knowledge Integration': 'Hossein',
            'Content Operations & Workflow': 'Hossein',
            'AI & Automation': 'Hossein',
            'Content Risk & Governance': 'Hossein + Sajjad',
        }
        for section, owner in expected_sections.items():
            self.assertIn("title:'%s'" % section, js)
            self.assertIn("owner:'%s'" % owner, js)
        self.assertIn('Every production task must still have one clear owner.', js)
        self.assertIn('Every task has exactly one owner.', js)
        self.assertIn('Commit deadlines', js)
        self.assertIn('data-cb-copy-link', js)
        self.assertIn('data-cb-copy-summary', js)

    def test_every_blueprint_section_has_plain_language_description(self):
        js = self.read('assets/core-blueprints.js')
        self.assertEqual(js.count("desc:'"), 16)
        self.assertIn('Defines why Gravitas creates content', js)
        self.assertIn('Checks scientific correctness, clarity and quality', js)
        self.assertIn('Tracks performance, captures what worked or failed', js)

    def test_blueprint_has_expected_end_to_end_lifecycle(self):
        js = self.read('assets/core-blueprints.js')
        expected = "var flowIds=['strategy','discovery','research','planning','production','review','publishing','distribution','measurement','repurposing','archive'];"
        self.assertIn(expected, js)

    def test_blueprint_layout_has_true_responsive_breakpoints(self):
        css = self.read('assets/core-blueprints.css')
        self.assertIn('@media(max-width:900px)', css)
        self.assertIn('@media(max-width:620px)', css)
        self.assertIn('.cb-flow{grid-template-columns:1fr', css)
        self.assertIn('.cb-map{transform:none!important;width:100%!important}', css)
        self.assertNotIn('min-width:1180px', css)
