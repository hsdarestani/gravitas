from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]


class WorkspaceTaskDeckFixContractTests(SimpleTestCase):
    def read(self, relative_path):
        return (ROOT / relative_path).read_text(encoding='utf-8')

    def test_workspace_loads_fix_and_mirror_layers(self):
        html = self.read('workspace.html')
        self.assertIn('ws-task-deck-fixes.js', html)
        self.assertIn('installWorkspaceTaskDeckFixes()', html)
        self.assertIn('ws-task-deck-mirror.js', html)
        self.assertIn('installTaskDeckMirror()', html)

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

    def test_core_tasks_keep_native_gravitas_and_bidirectional_deck_mirror(self):
        js = self.read('assets/ws/ws-task-deck-mirror.js')
        self.assertIn('renderCoreTasks(host, { go })', js)
        self.assertIn('Gravitas ↔ Nextcloud Deck', js)
        self.assertIn('Tasks stay available in both places', js)
        self.assertIn("panel.dataset.coreDeckSurface = 'true'", js)
        self.assertIn("P.call('/platform/nextcloud/')", js)
        self.assertIn("P.call('/platform/admin/deck/sync/'", js)
        self.assertIn("dispatchEvent(new PopStateEvent('popstate'))", js)
        self.assertNotIn('child.remove()', js)
