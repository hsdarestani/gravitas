from django.test import SimpleTestCase

from .pulsar_evalset import EVAL_CASES, summary


class PulsarEvalsetTests(SimpleTestCase):
    def test_evalset_has_release_scale_coverage(self):
        info = summary()
        self.assertGreaterEqual(info['total'], 80)
        self.assertLessEqual(info['total'], 120)
        self.assertTrue(info['ids_unique'])
        self.assertGreaterEqual(len(info['categories']), 7)
        for count in info['categories'].values():
            self.assertGreaterEqual(count, 10)

    def test_every_case_has_id_category_and_unique_identity(self):
        ids = [item['id'] for item in EVAL_CASES]
        self.assertEqual(len(ids), len(set(ids)))
        for item in EVAL_CASES:
            self.assertTrue(item['id'])
            self.assertTrue(item['category'])
