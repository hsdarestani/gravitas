from datetime import date
from django.test import SimpleTestCase
from core.task_date_inference import activity_window, document_activity_rows


class ActivityWindowTests(SimpleTestCase):
    def test_iso_days_and_ranges(self):
        self.assertEqual(activity_window('2026-09-07 to 2026-09-14'), (date(2026, 9, 7), date(2026, 9, 14)))
        self.assertEqual(activity_window('2026-09-13'), (date(2026, 9, 13), date(2026, 9, 13)))

    def test_human_written_cross_month_and_short_ranges(self):
        cases = {'1-10 sep': (9, 1, 9, 10), '7sep - 15sep': (9, 7, 9, 15),
                 '29 sep – 1oct': (9, 29, 10, 1), '26 aug - 9 oct': (8, 26, 10, 9),
                 '20 - 30 sep': (9, 20, 9, 30)}
        for raw, (m1, d1, m2, d2) in cases.items():
            self.assertEqual(activity_window(raw), (date(2026, m1, d1), date(2026, m2, d2)), raw)

    def test_no_unstated_deadline_or_made_up_range(self):
        for raw in ('not specified', '', '31 feb', '2026-10-12 to 2026-09-01'):
            self.assertIsNone(activity_window(raw), raw)

    def test_native_locations_and_reported_status_are_preserved(self):
        doc = {'documentId': 'fixture-doc', 'revisionId': 'revision-1', 'paragraphs': [
            {'text': 'Task 1: Example', 'tabId': 'member', 'startIndex': 1, 'endIndex': 17},
            {'text': 'Prepare the draft | Done | 2026-09-01 to 2026-09-03', 'tabId': 'member', 'startIndex': 18, 'endIndex': 85}]}
        row = document_activity_rows(doc, {'member': 'Member'})[0]
        self.assertEqual(row['start'], '2026-09-01')
        self.assertEqual(row['end'], '2026-09-03')
        self.assertEqual(row['paragraph_start'], 18)
        self.assertEqual(row['status'], 'done')
        self.assertNotIn('due_date', row)
