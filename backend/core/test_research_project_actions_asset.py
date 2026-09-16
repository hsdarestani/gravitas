from pathlib import Path

from django.test import SimpleTestCase


class ResearchProjectActionsAssetTests(SimpleTestCase):
    def test_workspace_loads_project_action_controller(self):
        root = Path(__file__).resolve().parents[2]
        workspace = (root / 'workspace.html').read_text(encoding='utf-8')
        self.assertIn('installResearchProjectActions', workspace)
        self.assertIn('/assets/ws/ws-project-actions.js?v=20260916-1', workspace)

    def test_project_tabs_expose_mutations_without_native_dialog(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / 'assets/ws/ws-project-actions.js').read_text(encoding='utf-8')
        for text in (
            'Edit project',
            'Project access',
            'New milestone',
            'Edit milestone',
            'New task',
            'Edit task',
            'New project note',
            'Add source',
            'Upload dataset',
            'Upload file',
            'New discussion',
            'Manage discussions',
            'New experiment',
            'Edit experiment',
            'New deliverable',
            'Edit deliverable',
            'Open planning',
            "permissions?.can_edit",
            "permissions?.can_manage",
            'item.can_edit',
        ):
            self.assertIn(text, source)
        self.assertNotIn('.showModal(', source)
        self.assertNotIn("createElement('dialog')", source)

    def test_project_actions_use_canonical_endpoints(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / 'assets/ws/ws-project-actions.js').read_text(encoding='utf-8')
        for endpoint in (
            '/platform/projects/${projectId}/milestones/',
            '/platform/projects/${projectId}/milestones/${fields.picker.value}/',
            '/platform/projects/${projectId}/tasks/',
            '/platform/tasks/${fields.picker.value}/',
            '/platform/resources/',
            '/platform/files/upload/',
            '/platform/share/',
            '/platform/projects/${projectId}/deliverables/',
            '/platform/projects/${projectId}/deliverables/${fields.picker.value}/',
        ):
            self.assertIn(endpoint, source)
