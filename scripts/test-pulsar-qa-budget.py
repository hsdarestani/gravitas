import concurrent.futures
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from pulsar_qa_budget import Budget, BudgetStopped, KNOWN_RESET, WINDOW


def concurrent_reserve(directory):
    try:
        Budget(directory, clock=lambda: KNOWN_RESET + 60).admit(
            count=2, purpose='concurrent-test', fingerprint='tested')
        return True
    except BudgetStopped:
        return False


class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = KNOWN_RESET + 60
        self.budget = Budget(self.temp.name, clock=lambda: self.now)

    def admit(self, **kwargs):
        return self.budget.admit(purpose='test', fingerprint='tested', **kwargs)

    def test_known_daily_exhaustion_stops_without_a_request(self):
        self.now = KNOWN_RESET - 1
        with self.assertRaisesRegex(BudgetStopped, '4006'):
            self.admit()
        with self.budget.state() as state:
            self.assertEqual(state['requests'], [])

    def test_retries_and_new_instances_share_three_call_limit(self):
        self.admit()
        self.admit(count=2)
        with self.assertRaisesRegex(BudgetStopped, 'rolling 24h'):
            Budget(self.temp.name, clock=lambda: self.now).admit(purpose='retry', fingerprint='other-commit')

    def test_reservations_persist_on_failure(self):
        self.admit(count=2)
        self.assertEqual(len(json.loads((Path(self.temp.name) / 'state.json').read_text())['requests']), 2)

    def test_production_requires_matching_recent_successful_preflight(self):
        with self.assertRaisesRegex(BudgetStopped, 'successful real preflight'):
            self.admit(production=True, count=2)
        self.admit()
        self.budget.passed('tested')
        self.admit(production=True, count=2)

    def test_different_fingerprint_cannot_reuse_preflight(self):
        self.budget.passed('different')
        with self.assertRaises(BudgetStopped):
            self.admit(production=True)

    def test_expired_preflight_cannot_release(self):
        self.budget.passed('tested')
        self.now += 7201
        with self.assertRaises(BudgetStopped):
            self.admit(production=True)

    def test_successful_preflight_is_reused_without_a_new_request(self):
        self.admit()
        self.budget.passed('tested')
        self.assertTrue(self.budget.recent_preflight('tested'))
        self.assertFalse(self.budget.recent_preflight('other'))
        with self.budget.state() as state:
            self.assertEqual(len(state['requests']), 1)
        self.now += 7201
        self.assertFalse(self.budget.recent_preflight('tested'))

    def test_quota_failure_blocks_until_next_utc_reset(self):
        self.budget.block()
        with self.assertRaisesRegex(BudgetStopped, '4006'):
            self.admit()
        self.now = KNOWN_RESET + WINDOW + 1
        self.admit()

    def test_utc_midnight_does_not_reset_rolling_request_limit(self):
        self.admit(count=2)
        self.admit()
        self.now = KNOWN_RESET + WINDOW + 1
        with self.assertRaises(BudgetStopped):
            self.admit()
        self.now += 60
        self.admit()

    def test_no_model_switch_can_restore_capacity(self):
        with self.assertRaisesRegex(BudgetStopped, 'model/configuration'):
            self.admit(model='paid-or-untested-model')

    def test_parallel_processes_cannot_overdraw_shared_budget(self):
        with concurrent.futures.ProcessPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(concurrent_reserve, [self.temp.name, self.temp.name]))
        self.assertEqual(sorted(outcomes), [False, True])

    def test_evidence_fingerprint_rejects_changed_application(self):
        spec = importlib.util.spec_from_file_location('evidence', Path(__file__).with_name('verify-pulsar-evidence.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        manifest, report, fingerprint = module.verify()
        self.assertEqual(len(report['conversations']), 42)
        self.assertEqual(len(fingerprint), 64)
        # A single wrong application digest must fail closed without inference.
        root = Path(self.temp.name)
        (root / 'qa/pulsar').mkdir(parents=True)
        manifest['sha256'] = {'changed.py': '0' * 64}
        (root / 'qa/pulsar/evidence.json').write_text(json.dumps(manifest))
        (root / 'changed.py').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'application changed'):
            module.verify(root)


if __name__ == '__main__':
    unittest.main()
