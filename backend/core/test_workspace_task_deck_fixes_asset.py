from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]


class WorkspaceTaskDeckContractTests(SimpleTestCase):
    """Core Tasks draws its own Deck row (ws-deck-sync.js).

    It used to be inserted by the ws-task-deck-mirror.js overlay, which also
    redrew the board when it thought another overlay had replaced it.
    """

    def read(self, relative_path):
        return (ROOT / relative_path).read_text(encoding='utf-8')

    def test_core_tasks_insert_the_deck_row_themselves(self):
        views = self.read('assets/ws/ws-views.js')
        self.assertIn("import { deckPanel } from './ws-deck-sync.js?v=20261011-r2", views)
        self.assertIn('if (host.isConnected) head.after(deckPanel(', views)

    def test_deck_row_syncs_both_ways(self):
        js = self.read('assets/ws/ws-deck-sync.js')
        self.assertIn('Synced with Nextcloud Deck', js)
        self.assertIn('Title, lane and due date sync both ways', js)
        self.assertIn("P.call('/platform/nextcloud/')", js)
        self.assertIn("P.call('/platform/admin/deck/sync/'", js)
        self.assertNotIn('MutationObserver', js)
        self.assertNotIn('observeSurface', js)

    def test_deck_row_styles_are_in_the_stylesheet(self):
        self.assertIn('.ws-core-deck-mirror__status', self.read('assets/ws/ws.css'))
        self.assertNotIn("createElement('style')", self.read('assets/ws/ws-deck-sync.js'))
