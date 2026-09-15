from django.test import SimpleTestCase
from pathlib import Path


class ResearchProjectPermissionContractTests(SimpleTestCase):
    def test_project_cockpit_permissions_are_read_from_nested_permissions(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / 'assets/ws/ws-project-actions.js').read_text(encoding='utf-8')
        self.assertIn('project?.permissions?.can_edit', source)
        self.assertIn('project?.permissions?.can_manage', source)
        self.assertNotIn('project.can_edit', source)
        self.assertNotIn('project.can_manage', source)
