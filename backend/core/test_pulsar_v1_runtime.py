from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .pulsar_runtime.errors import PulsarError
from .pulsar_runtime.harness import PulsarHarness
from .pulsar_runtime.providers import ModelGateway
from .pulsar_runtime.types import ProviderResponse


class TelemetryGateway:
    def configured(self):
        return True

    def complete(self, **kwargs):
        return ProviderResponse(
            text='ok',
            provider='test-provider',
            model='test-model',
            latency_ms=9,
            input_tokens=20,
            output_tokens=5,
            estimated_cost_usd=0.002,
        )


class RetryProvider:
    def __init__(self):
        self.calls = []

    def configured(self):
        return True

    def complete(self, **kwargs):
        self.calls.append(kwargs)
        if len(self.calls) == 1:
            raise PulsarError('primary_unavailable')
        return ProviderResponse(
            text='ok',
            provider='test-provider',
            model=kwargs.get('model_override') or 'primary',
            latency_ms=4,
        )


class PulsarV1RuntimeTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='pulsar-v1@example.test',
            email='pulsar-v1@example.test',
            password='Strong-pass-123!',
        )

    def test_harness_exposes_usage_telemetry(self):
        result = PulsarHarness(models=TelemetryGateway()).run_text(
            system='system',
            user='question',
            surface='research',
            skill='research',
            operation='answer',
            actor=self.user,
            metadata={'continuity': False},
        )
        self.assertEqual(result.latency_ms, 9)
        self.assertEqual(result.input_tokens, 20)
        self.assertEqual(result.output_tokens, 5)
        self.assertAlmostEqual(result.estimated_cost_usd, 0.002)

    @override_settings(PULSAR_MODEL_FALLBACK='fallback-model')
    def test_gateway_retries_configured_fallback(self):
        provider = RetryProvider()
        result = ModelGateway(provider=provider).complete(
            system='system',
            user='question',
            tier='general',
        )
        self.assertEqual(result.text, 'ok')
        self.assertEqual(result.model, 'fallback-model')
        self.assertEqual(len(provider.calls), 2)
        self.assertEqual(provider.calls[1]['model_override'], 'fallback-model')
