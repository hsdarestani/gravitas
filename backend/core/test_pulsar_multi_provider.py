from unittest.mock import Mock, patch

from django.test import SimpleTestCase, override_settings

from .pulsar_runtime.errors import PulsarError
from .pulsar_runtime.providers import (
    ManagedAnthropicProvider,
    ManagedGeminiProvider,
    ManagedOpenAIProvider,
    ModelGateway,
)
from .pulsar_runtime.types import ProviderResponse


class FakeProvider:
    def __init__(self, name, *, fail=False):
        self.name = name
        self.fail = fail
        self.calls = []

    def configured(self):
        return True

    def complete(self, **kwargs):
        self.calls.append(kwargs)
        if self.fail:
            raise PulsarError(self.name + '_failed')
        return ProviderResponse(
            text=self.name + ' answer',
            provider=self.name,
            model=self.name + '-model',
            latency_ms=3,
        )


class PulsarMultiProviderTests(SimpleTestCase):
    def test_gateway_fails_over_to_next_provider(self):
        first = FakeProvider('openai', fail=True)
        second = FakeProvider('anthropic')
        result = ModelGateway(providers=[first, second]).complete(
            system='system',
            user='question',
            tier='general',
        )
        self.assertEqual(result.provider, 'anthropic')
        self.assertEqual(len(first.calls), 1)
        self.assertEqual(len(second.calls), 1)

    @override_settings(PULSAR_PROVIDER_DEEP='anthropic')
    def test_tier_pin_prioritizes_requested_provider(self):
        openai = FakeProvider('openai')
        anthropic = FakeProvider('anthropic')
        result = ModelGateway(providers=[openai, anthropic]).complete(
            system='system',
            user='question',
            tier='deep',
        )
        self.assertEqual(result.provider, 'anthropic')
        self.assertEqual(len(anthropic.calls), 1)
        self.assertEqual(openai.calls, [])

    def test_provider_override_is_strict(self):
        openai = FakeProvider('openai')
        anthropic = FakeProvider('anthropic')
        result = ModelGateway(providers=[openai, anthropic]).complete(
            system='system',
            user='question',
            tier='general',
            provider_override='openai',
        )
        self.assertEqual(result.provider, 'openai')
        self.assertEqual(anthropic.calls, [])

    @override_settings(
        PULSAR_OPENAI_API_KEY='test-key',
        PULSAR_OPENAI_MODEL_GENERAL='openai-test',
    )
    @patch('core.pulsar_runtime.providers.requests.post')
    def test_openai_adapter_parses_text_and_usage(self, post):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            'choices': [{'message': {'content': 'openai answer'}}],
            'usage': {'prompt_tokens': 11, 'completion_tokens': 4},
        }
        post.return_value = response
        result = ManagedOpenAIProvider().complete(
            system='system',
            user='question',
            tier='general',
        )
        self.assertEqual(result.text, 'openai answer')
        self.assertEqual(result.provider, 'openai')
        self.assertEqual(result.input_tokens, 11)
        self.assertEqual(result.output_tokens, 4)

    @override_settings(
        PULSAR_ANTHROPIC_API_KEY='test-key',
        PULSAR_ANTHROPIC_MODEL_GENERAL='anthropic-test',
    )
    @patch('core.pulsar_runtime.providers.requests.post')
    def test_anthropic_adapter_parses_text_and_usage(self, post):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            'content': [{'type': 'text', 'text': 'anthropic answer'}],
            'usage': {'input_tokens': 13, 'output_tokens': 5},
        }
        post.return_value = response
        result = ManagedAnthropicProvider().complete(
            system='system',
            user='question',
            tier='general',
        )
        self.assertEqual(result.text, 'anthropic answer')
        self.assertEqual(result.provider, 'anthropic')
        self.assertEqual(result.input_tokens, 13)
        self.assertEqual(result.output_tokens, 5)

    @override_settings(
        PULSAR_GEMINI_API_KEY='test-key',
        PULSAR_GEMINI_MODEL_GENERAL='gemini-test',
    )
    @patch('core.pulsar_runtime.providers.requests.post')
    def test_gemini_adapter_parses_text_and_usage(self, post):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            'candidates': [{
                'content': {
                    'parts': [{'text': 'gemini answer'}],
                },
            }],
            'usageMetadata': {
                'promptTokenCount': 17,
                'candidatesTokenCount': 6,
            },
        }
        post.return_value = response
        result = ManagedGeminiProvider().complete(
            system='system',
            user='question',
            tier='general',
        )
        self.assertEqual(result.text, 'gemini answer')
        self.assertEqual(result.provider, 'gemini')
        self.assertEqual(result.input_tokens, 17)
        self.assertEqual(result.output_tokens, 6)
