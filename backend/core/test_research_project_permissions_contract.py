from django.test import SimpleTestCase
from pathlib import Path


class ResearchProjectPermissionContractTests(SimpleTestCase):
    def test_project_clients_use_nested_permissions_and_no_legacy_direct_flags(self):
        root = Path(__file__).resolve().parents[2]
        actions = (root / 'assets/ws/ws-project-actions.js').read_text(encoding='utf-8')
        project = (root / 'assets/ws/ws-project.js').read_text(encoding='utf-8')
        self.assertIn('project?.permissions?.can_edit', actions)
        self.assertIn('project?.permissions?.can_manage', actions)
        self.assertNotIn('project.can_edit', actions)
        self.assertNotIn('project.can_manage', actions)
        self.assertIn('project.permissions?.can_edit', project)
        self.assertIn('cockpit.project.permissions?.can_edit', project)
        self.assertIn('project.permissions?.role', project)
        self.assertNotIn('project.can_edit', project)
        self.assertNotIn('cockpit.project.can_edit', project)
        self.assertNotIn('project.role', project)
