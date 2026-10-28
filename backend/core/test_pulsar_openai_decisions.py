"""Regression tests for optional bounded Decisions API report matching."""
import json
import uuid
from types import SimpleNamespace
from unittest.mock import Mock, patch

import requests
from django.test import SimpleTestCase, override_settings
from django.utils import timezone

from .pulsar_runtime.openai_decisions import choose_report_tasks
from .telegram_work_reports import _compact_entries, preview


@override_settings(
    PULSAR_REPORT_DECISIONS_ENABLED=True,
    PULSAR_REPORT_DECISIONS_API_KEY='test-only-token',
)
class DecisionsReportMatchingTests(SimpleTestCase):
    def setUp(self):
        self.tasks = [
            SimpleNamespace(pk=1113, title='Finalize and Upload the Website Video',
                            project_id=None, definition_of_done='Website film for internal review'),
            SimpleNamespace(pk=541, title='Create website UX flow document',
                            project_id=None, definition_of_done='User journey diagram'),
            SimpleNamespace(pk=719, title='Finalize public website UX flow',
                            project_id=None, definition_of_done='Approved UX workflow'),
        ]
        self.updates = [{'title': 'Made a realistic version video for website',
                         'progress': 'Completed', 'task_id': None}]

    def candidates(self, tasks, phrase, limit=6):
        return [{'id': task.pk, 'title': task.title, 'project': 'Core'}
                for task in tasks][:limit]

    def _mock_reply(self, *, choice='1113', confidence=.96, probability=.95, other=.03):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            'answers': [{
                'type': 'choice', 'name': 'activity_0', 'choice': choice,
                'confidence': confidence,
                'probabilities': [
                    {'value': choice, 'probability': probability},
                    {'value': 'none' if choice != 'none' else '1113', 'probability': other},
                ],
            }],
        }
        return response

    @patch('core.pulsar_runtime.openai_decisions.requests.post')
    def test_uses_real_decisions_contract_and_authorized_candidate_ids(self, post):
        post.return_value = self._mock_reply()
        matches = choose_report_tasks(self.updates, self.tasks, self.candidates)
        self.assertEqual(matches, {0: 1113})
        args = post.call_args.kwargs
        self.assertTrue(post.call_args.args[0].endswith('/v1/decisions'))
        self.assertEqual(args['json']['model'], 'gpt-6-luna')
        self.assertEqual(args['json']['questions'][0]['type'], 'choice')
        self.assertEqual(
            {choice['value'] for choice in args['json']['questions'][0]['choices']},
            {'none', '1113', '541', '719'},
        )
        self.assertNotIn('test-only-token', str(args['json']))

    @patch('core.pulsar_runtime.openai_decisions.requests.post')
    def test_ambiguous_or_none_choice_stays_unmatched(self, post):
        for response in (
            self._mock_reply(confidence=.66),
            self._mock_reply(probability=.62, other=.32),
            self._mock_reply(choice='none', probability=.96),
            self._mock_reply(choice='999999'),
        ):
            post.return_value = response
            self.assertEqual(choose_report_tasks(self.updates, self.tasks, self.candidates), {})

    @patch('core.pulsar_runtime.openai_decisions.requests.post')
    def test_external_failure_preserves_non_mutating_report(self, post):
        post.side_effect = requests.Timeout('slow')
        self.assertEqual(choose_report_tasks(self.updates, self.tasks, self.candidates), {})

    @override_settings(PULSAR_REPORT_DECISIONS_ENABLED=False)
    @patch('core.pulsar_runtime.openai_decisions.requests.post')
    def test_default_disabled_skips_external_api(self, post):
        self.assertEqual(choose_report_tasks(self.updates, self.tasks, self.candidates), {})
        post.assert_not_called()




@override_settings(
    PULSAR_REPORT_DECISIONS_ENABLED=True,
    PULSAR_REPORT_DECISIONS_API_KEY='',
    PULSAR_OPENAI_API_KEY='',
    CLOUDFLARE_AI_ACCOUNT_ID='connected-account',
    CLOUDFLARE_AI_API_TOKEN='connected-token',
)
class CloudflareDecisionFallbackTests(SimpleTestCase):
    """A connected Cloudflare provider must work without any OpenAI key."""

    setUp = DecisionsReportMatchingTests.setUp

    def candidates(self, tasks, phrase, limit=6):
        return DecisionsReportMatchingTests.candidates(self, tasks, phrase, limit)

    def _cloudflare_response(self, choice='1113', certainty='high',
                             match_type='same_deliverable'):
        return SimpleNamespace(text=json.dumps({
            'answers': [{
                'name': 'activity_0',
                'choice': choice,
                'certainty': certainty,
                'match_type': match_type,
            }],
        }))

    @patch('core.pulsar_runtime.providers.ManagedCloudflareProvider.complete')
    @patch('core.pulsar_runtime.openai_decisions.requests.post')
    def test_cloudflare_provider_matches_without_openai_key(self, openai_post, complete):
        complete.return_value = self._cloudflare_response()
        result = choose_report_tasks(self.updates, self.tasks, self.candidates)
        self.assertEqual(result, {0: 1113})
        openai_post.assert_not_called()
        self.assertEqual(complete.call_args.kwargs['tier'], 'fast')

    @patch('core.pulsar_runtime.providers.ManagedCloudflareProvider.complete')
    @patch('core.pulsar_runtime.openai_decisions.requests.post')
    def test_cloudflare_rejects_ux_and_uncertain_links(self, openai_post, complete):
        for response in (
            self._cloudflare_response(choice='541'),
            self._cloudflare_response(certainty='low'),
            self._cloudflare_response(match_type='different_deliverable'),
            self._cloudflare_response(choice='999999'),
            self._cloudflare_response(choice='none'),
        ):
            complete.return_value = response
            self.assertEqual(choose_report_tasks(
                self.updates, self.tasks, self.candidates), {})
        openai_post.assert_not_called()

    @patch('core.pulsar_runtime.providers.ManagedCloudflareProvider.complete')
    def test_cloudflare_service_error_preserves_unmatched_activity(self, complete):
        complete.side_effect = requests.Timeout('offline')
        self.assertEqual(choose_report_tasks(
            self.updates, self.tasks, self.candidates), {})

    @override_settings(PULSAR_REPORT_DECISIONS_ENABLED=False)
    @patch('core.pulsar_runtime.providers.ManagedCloudflareProvider.complete')
    def test_explicit_off_switch_disables_cloudflare_decisions(self, complete):
        self.assertEqual(choose_report_tasks(
            self.updates, self.tasks, self.candidates), {})
        complete.assert_not_called()


class CompactPreviewTests(SimpleTestCase):
    def test_three_website_variants_group_without_losing_source_rows(self):
        updates = [
            {'title': 'Made a realistic version video for website', 'progress': 'Completed'},
            {'title': 'Made a reel version video for website', 'progress': 'Completed'},
            {'title': 'Made a vox version video for website', 'progress': 'Completed'},
            {'title': 'Social media R&D', 'progress': 'In progress'},
        ]
        result = _compact_entries(updates)
        self.assertEqual(len(updates), 4)
        self.assertEqual(len(result), 2)
        self.assertIn('realistic, reel, vox', result[0]['title'])
        self.assertEqual(result[1]['title'], 'Social media R&D')

    def test_preview_no_guessy_suggestions_or_empty_fields(self):
        report = SimpleNamespace(
            report_date=timezone.localdate(), created_at=timezone.now(),
            pk=uuid.uuid4(), revision=1,
            interpretation={'updates': [
                {'title': 'Completed the Instagram Reel', 'progress': 'Completed',
                 'task_id': None, 'candidates': [
                     {'id': 541, 'title': 'UX flow', 'project': 'Core'}]}]},
        )
        message = preview(report)
        self.assertNotIn('Possible tasks', message['text'])
        self.assertNotIn('Deliverable:', message['text'])
        self.assertNotIn('Status suggestion', message['text'])
        self.assertIn('Instagram Reel', message['text'])
        self.assertEqual(len(message['reply_markup']['inline_keyboard']), 1)
