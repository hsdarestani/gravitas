"""Domain and safety tests for the remaining imported historical task copy repair."""
import importlib

from django.test import SimpleTestCase


repair = importlib.import_module('core.migrations.0079_repair_remaining_historical_task_copy')


class RemainingHistoricalCopyTests(SimpleTestCase):
    def test_representative_scopes_are_not_generic(self):
        cases = {
            "Fix cross-project permission checks": ("authorization", "regression"),
            "Improve Nextcloud file synchronization": ("storage", "reconciled"),
            "Review LMS learner assessment experience": ("learning", "tested"),
            "Refine scientific film animation scene rendering": ("film", "render"),
            "Investigate API route coverage": ("API", "requests"),
            "Build dashboard progress rings": ("dashboard", "zero-value"),
            "Prepare brand assets for delivery": ("brand", "reviewed"),
            "Implement user mentions and notifications": ("notification", "events"),
            "Improve font rendering and typography": ("typography", "font"),
            "Fix task board hierarchy persistence": ("task", "regression"),
            "Review notes folder and backlink navigation": ("Notes", "notes"),
            "Ensure asset release token cache consistency": ("asset", "cache"),
        }
        for title, (scope_token, acceptance_token) in cases.items():
            with self.subTest(title=title):
                result = repair.propose_copy(title)
                self.assertIsNotNone(result)
                description, done = result
                self.assertIn(title, description)
                self.assertIn(scope_token.lower(), description.lower())
                self.assertIn(acceptance_token.lower(), done.lower())
                self.assertNotEqual(done, repair.LEGACY_DOD)
                self.assertGreater(len(done), 70)

    def test_unclassified_title_is_left_for_review(self):
        self.assertIsNone(repair.propose_copy("Ethereal crystal meadow"))

    def test_completion_is_not_claimed_or_inferred(self):
        description, done = repair.propose_copy("Verify access grants and project identity")
        self.assertNotIn("already accepted", done.lower())
        self.assertNotIn("was completed", description.lower())
        self.assertNotIn("accepted in production", done.lower())
