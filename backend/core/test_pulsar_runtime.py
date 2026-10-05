from django.test import SimpleTestCase

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


class PulsarRuntimeTests(SimpleTestCase):
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
            user_id=42,
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
        )

        self.assertEqual(result.skill, 'research')
        self.assertEqual(result.model_tier, 'deep')
        self.assertEqual(gateway.calls[0]['tier'], 'deep')

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
