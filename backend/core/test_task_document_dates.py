import hashlib
from copy import deepcopy
from datetime import date

from django.test import SimpleTestCase, TestCase
from core.task_document_dates import propose_document_dates, recover_document_dates


def task(pk=1, **values):
    return {'id': pk, 'workspace_id': 1, 'parent_id': None, 'title': 'Reported work', 'status': 'done',
        'created_at': '2026-10-15T15:00:00+00:00', 'started_at': None,
        'completed_at': '2026-10-26T16:00:00+00:00', 'due_date': None,
        'source_key': 'fixture-key', 'updated_at': '2026-10-26T16:00:00+00:00',
        'source_metadata': {'migration_run_id': 'fixture-import', 'records': [{
            'activity_date_raw': '7sep - 14sep', 'original_status': 'Done',
            'source_reference': 'https://docs.google.com/document/d/fixture/edit?tab=member'}]},
        'date_provenance': {'created_at': {'source': 'canonical_revision:1', 'confidence': 'recorded'},
            'completed_at': {'source': 'canonical_revision:2', 'confidence': 'earliest_known'}}, **values}


class DocumentDateProposalTests(SimpleTestCase):
    def propose(self, rows, supplements=()):
        return propose_document_dates(rows, supplements, today=date(2026, 10, 30))

    def test_nested_human_range_recovers_import_birth_start_and_finish_but_no_deadline(self):
        row = self.propose([task()])[0]
        self.assertTrue(row['values']['created_at'].startswith('2026-09-07'))
        self.assertTrue(row['values']['started_at'].startswith('2026-09-07'))
        self.assertTrue(row['values']['completed_at'].startswith('2026-09-14'))
        self.assertNotIn('due_date', row['values'])
        info = row['date_provenance']['started_at']
        self.assertEqual(info['confidence'], 'inferred')
        self.assertEqual(info['precision'], 'day')
        self.assertIn('fixture', info['source_reference'])

    def test_recorded_events_and_admin_corrections_are_preserved(self):
        source = {key: {'source': 'admin', 'confidence': 'recorded'} for key in ('created_at', 'started_at', 'completed_at', 'due_date')}
        self.assertEqual(self.propose([task(date_provenance=source)]), [])
        row = task(date_provenance={'created_at': {'source': 'observed', 'confidence': 'recorded'},
            'completed_at': {'source': 'existing', 'confidence': 'recorded'}})
        self.assertEqual(self.propose([row]), [])

    def test_parent_uses_matching_child_activity_and_keeps_done_event(self):
        parent = task(1, source_metadata={'migration_run_id': 'fixture-import'}, date_provenance={
            'completed_at': {'source': 'existing', 'confidence': 'recorded'}})
        child = task(2, parent_id=1)
        result = {r['task_id']: r for r in self.propose([parent, child])}
        self.assertTrue(result[1]['values']['started_at'].startswith('2026-09-07'))
        self.assertNotIn('completed_at', result[1]['values'])
        self.assertEqual(result[1]['date_provenance']['started_at']['child_task_ids'], [2])

    def test_pending_plan_does_not_activate_backlog_or_complete_retest(self):
        row = task(status='ready', completed_at=None)
        row['source_metadata']['records'][0]['original_status'] = 'Planned'
        result = self.propose([row])[0]
        self.assertNotIn('started_at', result['values'])
        self.assertNotIn('completed_at', result['values'])
        row['status'] = 'retest'; row['source_metadata']['records'][0]['original_status'] = 'Retest'
        result = self.propose([row])[0]
        self.assertIn('started_at', result['values'])
        self.assertNotIn('completed_at', result['values'])

    def test_estimates_are_idempotent_and_retain_previous_values(self):
        row = task(); before = deepcopy(row)
        proposal = self.propose([row])[0]
        row.update(proposal['values']); row['date_provenance'] = proposal['date_provenance']
        self.assertEqual(self.propose([row]), [])
        self.assertEqual(row['date_provenance']['created_at']['previous_value'], before['created_at'])

    def test_supplement_is_identity_revision_checked_and_due_clear_is_protected(self):
        row = task()
        fact = {'task_id': row['id'], 'source_key': row['source_key'],
            'title_sha256': hashlib.sha256(row['title'].encode()).hexdigest(),
            'expected_updated_at': row['updated_at'], 'facts': [{'due_date': '2026-09-21',
                'info': {'source': 'meeting_inference', 'rationale': 'Two-week commitment.'}}]}
        self.assertEqual(self.propose([row], [fact])[0]['values']['due_date'], '2026-09-21')
        row['date_provenance']['due_date'] = {'source': 'recorded', 'confidence': 'recorded'}
        self.assertNotIn('due_date', self.propose([row], [fact])[0]['values'])
        row['date_provenance'].pop('due_date'); fact['expected_updated_at'] = '2026-10-25T16:00:00Z'
        self.assertNotIn('due_date', self.propose([row], [fact])[0]['values'])

    def test_same_day_estimate_never_precedes_recorded_creation_in_storage(self):
        row = task(source_metadata={}, created_at='2026-09-24T23:00:00Z', date_provenance={
            'created_at': {'source': 'observed'}, 'completed_at': {'source': 'observed'}})
        result = self.propose([row])[0]
        self.assertEqual(result['values']['started_at'], '2026-09-24T23:00:00+00:00')
        self.assertEqual(result['date_provenance']['started_at']['start_upper_bound'], '2026-10-26')

    def test_later_report_revision_does_not_start_work_after_recorded_completion(self):
        row = task(source_metadata={}, created_at='2026-09-21T12:00:00Z', completed_at='2026-10-02T12:00:00Z',
            date_provenance={'created_at': {'source': 'existing', 'confidence': 'recorded'},
                'completed_at': {'source': 'existing', 'confidence': 'recorded'}})
        row['source_metadata'] = {'records': [{'activity_date_raw': '2026-10-10', 'original_status': 'Done'}]}
        result = self.propose([row])[0]
        self.assertTrue(result['values']['started_at'].startswith('2026-09-21'))
        self.assertNotIn('completed_at', result['values'])


class DocumentDatePersistenceTests(TestCase):
    def test_application_audits_once_preserves_task_state_and_is_repeatable(self):
        from django.contrib.auth import get_user_model
        from core.platform_runtime_v3 import ensure_platform_workspaces
        from core.operating_models import OperatingTask
        from core.layer_models import ActivityEvent
        user = get_user_model().objects.create_user(username='document-date-owner')
        workspace = ensure_platform_workspaces(user)['core']
        source = task()
        row = OperatingTask.objects.create(workspace=workspace, owner=user, title=source['title'],
            definition_of_done='Delivered', status='done', source_key='fixture-import-key',
            source_metadata=source['source_metadata'], created_at=source['created_at'],
            completed_at=source['completed_at'], date_provenance=source['date_provenance'])
        original_updated = row.updated_at
        report = recover_document_dates(apply=True, supplements=[])
        row.refresh_from_db()
        self.assertEqual(report['recovered_started_at'], 1)
        self.assertEqual(row.started_at.date(), date(2026, 9, 7))
        self.assertEqual(row.completed_at.date(), date(2026, 9, 14))
        self.assertEqual(row.owner_id, user.pk)
        self.assertEqual(row.status, 'done')
        self.assertGreater(row.updated_at, original_updated)
        self.assertIsNone(row.due_date)
        self.assertEqual(ActivityEvent.objects.filter(action='task.dates_inferred', object_id=str(row.pk)).count(), 1)
        self.assertEqual(recover_document_dates(apply=True, supplements=[])['changed'], 0)
        self.assertEqual(ActivityEvent.objects.filter(action='task.dates_inferred', object_id=str(row.pk)).count(), 1)
