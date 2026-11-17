import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from core.forum_models import ForumModerationBudget, ForumModerationDecision

TOKEN = 'test-only-scope-' * 4
URL = '/api/forum/moderation/classify/'
CANDIDATE = {
    'submission': '41:0', 'title': 'First discussion',
    'body': 'A benign reproducibility question and a clearly identifiable quote.',
}


@override_settings(GRAVITAS_FORUM_MODERATION_TOKEN=TOKEN)
@patch('core.forum_moderation.pulsar_runtime.configured', return_value=True)
@patch('core.forum_moderation.pulsar_runtime.run_text')
class ForumModerationTests(TestCase):
    def send(self, candidate=CANDIDATE, token=TOKEN):
        return self.client.post(URL, candidate, content_type='application/json',
                                headers={'Authorization': 'Bearer ' + token})

    def response(self, model, action='approve', reason='ordinary_discussion', confidence=99, evidence=''):
        model.return_value = SimpleNamespace(text=json.dumps({
            'decision': action, 'reason': reason, 'confidence': confidence, 'evidence': evidence,
        }))

    def test_rejects_missing_scope_and_oversized_input_before_model_use(self, model, configured):
        self.assertEqual(self.send(token='different-token').status_code, 404)
        self.assertEqual(self.send({**CANDIDATE, 'body': 'x' * 3001}).status_code, 400)
        self.assertEqual(self.send({**CANDIDATE, 'extra': 'x'}).status_code, 400)
        model.assert_not_called()

    def test_decisions_are_idempotent_and_revisions_use_a_new_budget_slot(self, model, configured):
        self.response(model)
        self.assertEqual(self.send().json()['decision'], 'approve')
        self.assertEqual(self.send().json()['decision'], 'approve')
        self.assertEqual(model.call_count, 1)
        self.assertEqual(self.send({**CANDIDATE, 'submission': '41:1'}).json()['decision'], 'approve')
        self.assertEqual(model.call_count, 2)
        self.assertEqual(ForumModerationBudget.objects.get().attempts, 2)
        self.assertEqual(model.call_args.kwargs['metadata'], {'continuity': False})

    def test_reject_requires_a_policy_reason_and_literal_evidence(self, model, configured):
        self.response(model, 'reject', 'credential_solicitation', evidence='a clearly identifiable quote')
        self.assertEqual(self.send().json()['decision'], 'reject')
        self.response(model, 'reject', 'targeted_threat', evidence='text the model invented')
        self.assertEqual(self.send({**CANDIDATE, 'submission': '42:0'}).json()['decision'], 'review')
        self.response(model, 'suspend', 'targeted_threat', evidence='a clearly identifiable quote')
        self.assertEqual(self.send({**CANDIDATE, 'submission': '43:0'}).json()['decision'], 'review')

    def test_quota_and_low_confidence_leave_item_in_review(self, model, configured):
        self.response(model, confidence=84)
        self.assertEqual(self.send().json()['decision'], 'review')
        ForumModerationBudget.objects.all().update(attempts=50)
        self.assertEqual(self.send({**CANDIDATE, 'submission': '44:0'}).json(),
                         {'decision': 'review', 'reason': 'daily_budget_reached'})
        self.assertEqual(model.call_count, 1)

    def test_safe_scientific_uncertainty_is_approved_at_moderate_confidence(self, model, configured):
        self.response(model, confidence=86)
        candidate = {
            'submission': '48:0',
            'title': 'How do we test hypotheses?',
            'body': 'How can we distinguish reproducible observations from hypotheses in a research discussion? I propose documenting methods, measurements, uncertainty and limitations before drawing conclusions.',
        }
        result = self.send(candidate)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['decision'], 'approve')
        self.assertEqual(result.json()['reason'], 'ordinary_discussion')
        self.assertEqual(model.call_args.kwargs['operation'], 'moderation')
        self.assertEqual(model.call_args.kwargs['temperature'], 0)
        self.assertGreaterEqual(model.call_args.kwargs['max_tokens'], 240)

    def test_fenced_json_accepted_but_extra_prose_not_trusted(self, model, configured):
        value = json.dumps({'decision': 'approve', 'reason': 'ordinary_discussion',
                            'confidence': 91, 'evidence': ''})
        model.return_value = SimpleNamespace(text='```json\n' + value + '\n```')
        self.assertEqual(self.send({**CANDIDATE, 'submission': '49:0'}).json()['decision'], 'approve')
        model.return_value = SimpleNamespace(text='Approved:\n' + value)
        self.assertEqual(self.send({**CANDIDATE, 'submission': '50:0'}).json()['decision'], 'review')

    def test_model_python_style_object_is_normalized_without_execution(self, model, configured):
        model.return_value = SimpleNamespace(text=(
            "{'decision': 'approve', 'reason': 'ordinary_discussion', "
            "'confidence': 92, 'evidence': ''}"
        ))
        self.assertEqual(self.send({**CANDIDATE, 'submission': '55:0'}).json()['decision'], 'approve')
        model.return_value = SimpleNamespace(text=(
            "{decision:'approve', reason:'ordinary_discussion', "
            "confidence:90, evidence:''}"
        ))
        self.assertEqual(self.send({**CANDIDATE, 'submission': '56:0'}).json()['decision'], 'approve')
        model.return_value = SimpleNamespace(text=(
            "{decision:approve, reason:ordinary_discussion, "
            "confidence:91, evidence:''}"
        ))
        self.assertEqual(self.send({**CANDIDATE, 'submission': '57:0'}).json()['decision'], 'approve')
        # No eval: function calls are not literals and must stay manual review.
        model.return_value = SimpleNamespace(text=(
            "{'decision': __import__('os').getcwd(), "
            "'reason': 'ordinary_discussion', 'confidence': 99, 'evidence': ''}"
        ))
        self.assertEqual(self.send({**CANDIDATE, 'submission': '58:0'}).json()['decision'], 'review')

    def test_rejection_requires_very_high_confidence_and_verbatim_body(self, model, configured):
        evidence = 'a clearly identifiable quote'
        self.response(model, 'reject', 'credential_solicitation', 97, evidence)
        self.assertEqual(self.send({**CANDIDATE, 'submission': '51:0'}).json()['decision'], 'review')
        self.response(model, 'reject', 'credential_solicitation', 98, evidence)
        self.assertEqual(self.send({**CANDIDATE, 'submission': '52:0'}).json()['decision'], 'reject')
        self.response(model, 'reject', 'credential_solicitation', 100, 'fabricated violation text')
        self.assertEqual(self.send({**CANDIDATE, 'submission': '53:0'}).json()['decision'], 'review')
        model.return_value = SimpleNamespace(text=json.dumps({
            'decision': 'approve', 'reason': 'ordinary_discussion',
            'confidence': True, 'evidence': '',
        }))
        self.assertEqual(self.send({**CANDIDATE, 'submission': '54:0'}).json()['decision'], 'review')

    def test_provider_failure_is_retried_with_backoff_and_exhaustion_is_manual(self, model, configured):
        model.side_effect = TimeoutError
        for attempt in range(3):
            self.assertEqual(self.send().status_code, 202)
            self.assertEqual(self.send().status_code, 202)
            self.assertEqual(model.call_count, attempt + 1)
            ForumModerationDecision.objects.all().update(lease_until=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.send().json(), {'decision': 'review', 'reason': 'provider_unavailable'})
        self.assertEqual(model.call_count, 3)
