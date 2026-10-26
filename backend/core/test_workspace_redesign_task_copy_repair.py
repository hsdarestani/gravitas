"""Regression checks for the remaining generic workspace-redesign copy."""
import importlib
from django.test import SimpleTestCase

mod = importlib.import_module('core.migrations.0080_repair_workspace_redesign_task_copy')

class WorkspaceRedesignCopyTests(SimpleTestCase):
    def test_workspace_redesign_is_scoped_and_verifiable(self):
        description, done = mod.propose_copy(
            'Redesign workspace panels and resolve serious interface defects')
        self.assertIn('navigation', description)
        self.assertIn('desktop and mobile', done)
        self.assertIn('regression', done)
        self.assertNotEqual(done, mod.LEGACY_DOD)

    def test_non_redesign_title_remains_unchanged(self):
        self.assertIsNone(mod.propose_copy('Research library categorization'))
        self.assertIsNone(mod.propose_copy('Redesign research methodology'))
