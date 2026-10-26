"""Safety and semantic-coverage tests for the historical task copy repair."""
import importlib

from django.test import SimpleTestCase


repair = importlib.import_module('core.migrations.0078_repair_imported_task_copy')


class ImportedTaskCopyTests(SimpleTestCase):
    def test_source_specific_scope_and_verifiable_done(self):
        cases = {
            'Investigate production uptime and provisioning failures': 'failure',
            'Repair notes synchronization and conflict handling': 'conflict',
            'Create scenario for video 2': 'scenario',
            'Improve course cover management': 'course cover',
            'Review reader library seen state': 'seen',
            'Implement dashboard chart kit': 'chart',
            'Update avatar cropping and profile image': 'profile',
            'Create learner assessment and quiz redesign': 'assessment',
            'Improve workspace date and time picker': 'date',
            'Research and explore a brand name': 'naming',
            'Document project decisions for continuity between sessions': 'decision',
            'Map the user journey for each audience': 'journey',
        }
        for title, expected in cases.items():
            with self.subTest(title=title):
                result = repair.copy_for_title(title)
                self.assertIsNotNone(result)
                description, done = result
                self.assertIn(expected, (description + ' ' + done).lower())
                self.assertGreater(len(description), 75)
                self.assertGreater(len(done), 75)
                self.assertNotEqual(done, repair.ORIGINAL_DOD)

    def test_unknown_title_requires_review_not_synthetic_copy(self):
        self.assertIsNone(repair.copy_for_title('Calibrate the red crystal fractal'))
