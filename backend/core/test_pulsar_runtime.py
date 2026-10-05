from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from .pulsar_runtime.decisions import DecisionRouter
from .pulsar_runtime.harness import PulsarHarness
from .pulsar_runtime.skills import SkillRegistry
from .pulsar_runtime.types import ProviderResponse


class FakeGateway:
    def __init__(self):
        self.calls = []

    def configured(self):
        return True

    def complete(self, **kwargs):
        self.calls.append(kwargs)
        return ProviderResponse(
            text='ok',
            provider='fake-provider',
            model='fake-model',
            latency_ms=7,
        )


class PulsarRuntimeTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='pulsar-runtime@example.test',
            email='pulsar-runtime@example.test',
            password='Strong-pass-123!',
        )
    def test_skill_registry_maps_learning_and_research_surfaces(self):
        registry = SkillRegistry()
        self.assertEqual(registry.resolve(surface='lms').name, 'learning')
        self.assertEqual(registry.resolve(surface='research').name, 'research')
        self.assertEqual(registry.resolve(surface='telegram').name, 'project_task')

    def test_harness_routes_through_shared_skill_and_model_gateway(self):
        gateway = FakeGateway()
        harness = PulsarHarness(models=gateway)

        result = harness.run_text(
            system='system',
            user='question',
            surface='lms',
            operation='answer',
            thread_id='thread-1',
            user_id=self.user.pk,
            actor=self.user,
        )

        self.assertEqual(result.text, 'ok')
        self.assertEqual(result.skill, 'learning')
        self.assertEqual(result.model_tier, 'general')
        self.assertEqual(result.provider, 'fake-provider')
        self.assertEqual(gateway.calls[0]['tier'], 'general')
        self.assertTrue(result.run_id)

    def test_research_synthesis_routes_to_deep_tier(self):
        gateway = FakeGateway()
        harness = PulsarHarness(models=gateway)

        result = harness.run_text(
            system='system',
            user='synthesize',
            surface='research',
            operation='synthesis',
            actor=self.user,
        )

        self.assertEqual(result.skill, 'research')
        self.assertEqual(result.model_tier, 'deep')
        self.assertEqual(gateway.calls[0]['tier'], 'deep')



    @patch('core.pulsar_runtime.decisions.requests.post')
    def test_jev_choice_can_drive_model_tier_when_configured(self, post):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            'model': 'jev-1.13.0',
            'answers': {
                'model_tier': {
                    'type': 'choice',
                    'choice': 'deep',
                    'confidence': 0.91,
                    'probabilities': {'fast': 0.01, 'general': 0.08, 'deep': 0.91},
                },
            },
            'usage': {'input_tokens': 30, 'output_tokens': 0},
        }
        post.return_value = response
        router = DecisionRouter(
            provider='jev',
            model='jev-latest',
            base_url='https://system-one.example/v1',
            api_key='test-key',
        )
        selection = router.select_model(
            skill=SkillRegistry().resolve(surface='research'),
            operation='synthesis',
            surface='research',
        )
        self.assertEqual(selection.tier, 'deep')
        self.assertEqual(selection.decision_source, 'jev')
        self.assertEqual(selection.decision_model, 'jev-1.13.0')
        request = post.call_args.kwargs
        self.assertEqual(request['json']['questions']['model_tier']['type'], 'choice')

    def test_external_decision_provider_is_safe_contract_fallback_in_v01(self):
        router = DecisionRouter(provider='jev', model='system-one')
        selection = router.select_model(
            skill=SkillRegistry().resolve(surface='telegram'),
            operation='interpret',
            surface='telegram',
        )

        self.assertEqual(selection.tier, 'fast')
        self.assertEqual(selection.decision_source, 'jev:contract-fallback')
        self.assertEqual(selection.decision_model, 'system-one')
