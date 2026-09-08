from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]


class CoreBlueprintAssetContractTests(SimpleTestCase):
    def read(self, relative_path):
        return (ROOT / relative_path).read_text(encoding='utf-8')

    def test_workspace_routes_core_assets_to_dedicated_runtime(self):
        html = self.read('workspace.html')
        self.assertIn("var blueprint=/^\\/workspace\\/core\\/assets", html)
        self.assertIn('/assets/core-blueprints.css?v=20260908a', html)
        self.assertIn('/assets/core-blueprints.js?v=20260908a', html)
        self.assertIn('/assets/workspace-shell-session.js?v=20260830a', html)
        self.assertLess(html.index('else if(blueprint)'), html.index('else if(platform)'))

    def test_core_navigation_exposes_assets_and_blueprints(self):
        nav = self.read('assets/platform-v3-navigation.js')
        self.assertIn("'/workspace/core/assets','⌘','Assets & Blueprints'", nav)
        self.assertIn("['/workspace/core/assets','Core · Assets & Blueprints']", nav)
        self.assertIn("if(starts('/workspace/core/assets/'))return 'Content Studio Blueprint'", nav)

    def test_blueprint_is_core_guarded_and_keeps_detail_with_owners(self):
        js = self.read('assets/core-blueprints.js')
        self.assertIn("location.replace('/workspace/research')", js)
        self.assertIn('GSA-001', js)
        expected_sections = {
            'Content Strategy & Objectives': 'Sajjad',
            'Content Types & Formats': 'Ahmad + Kiarash',
            'Idea & Content Discovery': 'Ahmad',
            'Research & Scientific Validation': 'Sajjad',
            'Content Planning': 'Ahmad',
            'Content Production': 'Ahmad',
            'Design & Content Experience': 'Kiarash',
            'Review & Quality Control': 'Sajjad + Ahmad + Kiarash',
            'Publishing': 'Ahmad + Hossein',
            'Distribution': 'Ahmad',
            'Repurposing & Content Atomization': 'Ahmad + Kiarash',
            'Measurement & Learning': 'Hossein + Ahmad',
            'Content Archive & Knowledge Integration': 'Hossein',
            'Content Operations & Workflow': 'Hossein',
            'AI & Automation': 'Hossein',
            'Content Risk & Governance': 'Hossein + Sajjad',
        }
        for section, owner in expected_sections.items():
            self.assertIn("title:'%s'" % section, js)
            self.assertIn("owner:'%s'" % owner, js)
        self.assertIn('The owner defines the detailed workflow', js)
        self.assertIn("data-cb-zoom=\"fit\"", js)
        self.assertIn('data-cb-fullscreen', js)

    def test_blueprint_has_expected_end_to_end_lifecycle(self):
        js = self.read('assets/core-blueprints.js')
        expected = "var flowIds=['strategy','discovery','research','planning','production','review','publishing','distribution','measurement','repurposing','archive'];"
        self.assertIn(expected, js)
