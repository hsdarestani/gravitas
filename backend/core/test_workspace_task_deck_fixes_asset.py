from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]


class WorkspaceTaskDeckFixContractTests(SimpleTestCase):
    def read(self, relative_path):
        return (ROOT / relative_path).read_text(encoding='utf-8')

    def test_workspace_loads_fix_layer(self):
        html = self.read('workspace.html')
        self.assertIn('ws-task-deck-fixes.js', html)
        self.assertIn('installWorkspaceTaskDeckFixes()', html)

    def test_duplicate_active_index_entries_are_collapsed_to_deepest_match(self):
        js = self.read('assets/ws/ws-task-deck-fixes.js')
        self.assertIn('dedupeSelectedNavigation', js)
        self.assertIn("current.slice(0, -1)", js)
        self.assertIn("removeAttribute('aria-current')", js)

    def test_research_surface_exposes_project_and_task_creation(self):
        js = self.read('assets/ws/ws-task-deck-fixes.js')
        self.assertIn("'New project'", js)
        self.assertIn("'New task'", js)
        self.assertIn("P.call('/platform/projects/'", js)
        self.assertIn("/tasks/`,", js)

    def test_core_tasks_are_deck_first(self):
        js = self.read('assets/ws/ws-task-deck-fixes.js')
        self.assertIn("route() !== '/workspace/core/tasks'", js)
        self.assertIn('Nextcloud Deck is the Core task board', js)
        self.assertIn("P.call('/platform/nextcloud/')", js)
        self.assertIn("P.call('/platform/admin/deck/sync/'", js)
