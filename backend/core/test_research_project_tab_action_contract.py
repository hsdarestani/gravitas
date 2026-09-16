from pathlib import Path

from django.test import SimpleTestCase


class ResearchProjectTabActionContractTests(SimpleTestCase):
    def test_every_project_tab_has_a_real_action_surface(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / 'assets/ws/ws-project-actions.js').read_text(encoding='utf-8')
        expected = {
            'overview': ('Edit project', 'Access', 'New task', 'New note', 'Upload'),
            'milestones': ('New milestone', 'Edit milestone', 'Open planning'),
            'tasks': ('New task', 'Edit task', 'Edit request'),
            'notes': ('New note', 'Edit note'),
            'sources': ('Add source', 'Upload dataset', 'New map', 'Edit source'),
            'files': ('Upload file', 'Edit file', 'Data room'),
            'discussions': ('New message', 'Manage'),
            'experiments': ('New experiment', 'Edit experiment', 'New deliverable', 'Edit deliverable'),
        }
        for tab, labels in expected.items():
            self.assertIn(f"info.tab === '{tab}'", source)
            for label in labels:
                self.assertIn(f"add('{label}'", source)
        self.assertIn("add('Refresh', refreshProject)", source)
