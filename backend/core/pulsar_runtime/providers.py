import json
import logging
import time
from urllib.parse import quote

import requests
from django.conf import settings

from .errors import PulsarError
from .types import ProviderResponse


logger = logging.getLogger(__name__)


def _clean_setting(name, default=''):
    return str(getattr(settings, name, default) or '').strip()


def _csv_setting(name, default=''):
    raw = _clean_setting(name, default)
    return [item.strip().lower() for item in raw.split(',') if item.strip()]


def _pricing():
    raw = _clean_setting('PULSAR_MODEL_PRICING_JSON')
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning('Invalid PULSAR_MODEL_PRICING_JSON; cost telemetry disabled')
        return {}
    return value if isinstance(value, dict) else {}


def _estimate_cost(model, input_tokens, output_tokens):
    row = _pricing().get(model) if model else None
    if not isinstance(row, dict):
        return 0.0
    try:
        input_rate = float(row.get('input_per_million') or 0)
        output_rate = float(row.get('output_per_million') or 0)
    except (TypeError, ValueError):
        return 0.0
    return (
        (max(0, int(input_tokens or 0)) / 1_000_000) * input_rate
        + (max(0, int(output_tokens or 0)) / 1_000_000) * output_rate
    )


def _usage_value(payload, *names):
    if not isinstance(payload, dict):
        return 0
    for name in names:
        value = payload.get(name)
        if value not in (None, ''):
            try:
                return int(value)
            except (TypeError, ValueError):
                continue
    return 0


def _response(text, *, provider, model, started, usage=None):
    text = str(text or '').strip()
    if not text:
        raise PulsarError(f'{provider}_empty')
    usage = usage if isinstance(usage, dict) else {}
    input_tokens = _usage_value(
        usage,
        'input_tokens', 'prompt_tokens', 'promptTokenCount', 'inputTokens',
    )
    output_tokens = _usage_value(
        usage,
        'output_tokens', 'completion_tokens', 'candidatesTokenCount', 'outputTokens',
    )
    return ProviderResponse(
        text=text,
        provider=provider,
        model=model,
        latency_ms=max(0, int((time.monotonic() - started) * 1000)),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        estimated_cost_usd=_estimate_cost(model, input_tokens, output_tokens),
    )


def _cloudflare_model(tier):
    tier = str(tier or 'general').strip().lower()
    setting_name = {
        'fast': 'PULSAR_MODEL_FAST',
        'general': 'PULSAR_MODEL_GENERAL',
        'deep': 'PULSAR_MODEL_DEEP',
    }.get(tier, 'PULSAR_MODEL_GENERAL')
    return (
        _clean_setting(setting_name)
        or _clean_setting('CLOUDFLARE_AI_MODEL')
        or '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
    )


def _managed_model(prefix, tier):
    tier = str(tier or 'general').strip().upper()
    return (
        _clean_setting(f'PULSAR_{prefix}_MODEL_{tier}')
        or _clean_setting(f'PULSAR_{prefix}_MODEL_GENERAL')
    )


class ManagedCloudflareProvider:
    name = 'cloudflare'

    def configured(self):
        return bool(
            _clean_setting('CLOUDFLARE_AI_ACCOUNT_ID')
            and _clean_setting('CLOUDFLARE_AI_API_TOKEN')
        )

    def complete(
        self,
        *,
        system,
        user,
        max_tokens=900,
        temperature=0.2,
        tier='general',
        model_override=None,
    ):
        account_id = _clean_setting('CLOUDFLARE_AI_ACCOUNT_ID')
        token = _clean_setting('CLOUDFLARE_AI_API_TOKEN')
        model = str(model_override or _cloudflare_model(tier)).strip()
        timeout = int(getattr(settings, 'CLOUDFLARE_AI_TIMEOUT', 45) or 45)
        if not account_id or not token:
            raise PulsarError('cloudflare_ai_not_configured')

        started = time.monotonic()
        try:
            response = requests.post(
                f'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}',
                headers={
                    'Authorization': f'Bearer {token}',
                    'Content-Type': 'application/json',
                },
                json={
                    'messages': [
                        {'role': 'system', 'content': str(system)},
                        {'role': 'user', 'content': str(user)},
                    ],
                    'max_tokens': int(max_tokens),
                    'temperature': float(temperature),
                },
                timeout=(8, max(15, timeout)),
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            logger.warning('Pulsar Cloudflare request failed: %s', exc)
            raise PulsarError('cloudflare_ai_failed') from exc

        if payload.get('success') is False:
            raise PulsarError('cloudflare_ai_failed')
        result = payload.get('result')
        usage = payload.get('usage') if isinstance(payload.get('usage'), dict) else {}
        if isinstance(result, dict):
            answer = result.get('response') or result.get('text') or result.get('answer')
            if isinstance(result.get('usage'), dict):
                usage = result.get('usage')
        else:
            answer = result
        return _response(
            answer,
            provider=self.name,
            model=model,
            started=started,
            usage=usage,
        )


class ManagedOpenAIProvider:
    name = 'openai'

    def configured(self):
        return bool(
            _clean_setting('PULSAR_OPENAI_API_KEY')
            and _managed_model('OPENAI', 'general')
        )

    def complete(
        self,
        *,
        system,
        user,
        max_tokens=900,
        temperature=0.2,
        tier='general',
        model_override=None,
    ):
        key = _clean_setting('PULSAR_OPENAI_API_KEY')
        model = str(model_override or _managed_model('OPENAI', tier)).strip()
        base_url = _clean_setting('PULSAR_OPENAI_BASE_URL', 'https://api.openai.com/v1').rstrip('/')
        timeout = int(getattr(settings, 'PULSAR_OPENAI_TIMEOUT', 45) or 45)
        if not key or not model:
            raise PulsarError('openai_not_configured')
        started = time.monotonic()
        try:
            response = requests.post(
                base_url + '/chat/completions',
                headers={
                    'Authorization': f'Bearer {key}',
                    'Content-Type': 'application/json',
                },
                json={
                    'model': model,
                    'messages': [
                        {'role': 'system', 'content': str(system)},
                        {'role': 'user', 'content': str(user)},
                    ],
                    'max_tokens': int(max_tokens),
                    'temperature': float(temperature),
                },
                timeout=(8, max(15, timeout)),
            )
            response.raise_for_status()
            payload = response.json()
            answer = payload['choices'][0]['message']['content']
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as exc:
            logger.warning('Pulsar OpenAI request failed: %s', exc)
            raise PulsarError('openai_failed') from exc
        return _response(
            answer,
            provider=self.name,
            model=model,
            started=started,
            usage=payload.get('usage'),
        )


class ManagedAnthropicProvider:
    name = 'anthropic'

    def configured(self):
        return bool(
            _clean_setting('PULSAR_ANTHROPIC_API_KEY')
            and _managed_model('ANTHROPIC', 'general')
        )

    def complete(
        self,
        *,
        system,
        user,
        max_tokens=900,
        temperature=0.2,
        tier='general',
        model_override=None,
    ):
        key = _clean_setting('PULSAR_ANTHROPIC_API_KEY')
        model = str(model_override or _managed_model('ANTHROPIC', tier)).strip()
        base_url = _clean_setting('PULSAR_ANTHROPIC_BASE_URL', 'https://api.anthropic.com').rstrip('/')
        timeout = int(getattr(settings, 'PULSAR_ANTHROPIC_TIMEOUT', 45) or 45)
        if not key or not model:
            raise PulsarError('anthropic_not_configured')
        started = time.monotonic()
        try:
            response = requests.post(
                base_url + '/v1/messages',
                headers={
                    'x-api-key': key,
                    'anthropic-version': _clean_setting(
                        'PULSAR_ANTHROPIC_VERSION',
                        '2023-06-01',
                    ),
                    'Content-Type': 'application/json',
                },
                json={
                    'model': model,
                    'system': str(system),
                    'messages': [{'role': 'user', 'content': str(user)}],
                    'max_tokens': int(max_tokens),
                    'temperature': float(temperature),
                },
                timeout=(8, max(15, timeout)),
            )
            response.raise_for_status()
            payload = response.json()
            blocks = payload.get('content') or []
            answer = ''.join(
                str(block.get('text') or '')
                for block in blocks
                if isinstance(block, dict) and block.get('type') == 'text'
            )
        except (requests.RequestException, ValueError, TypeError) as exc:
            logger.warning('Pulsar Anthropic request failed: %s', exc)
            raise PulsarError('anthropic_failed') from exc
        return _response(
            answer,
            provider=self.name,
            model=model,
            started=started,
            usage=payload.get('usage'),
        )


class ManagedGeminiProvider:
    name = 'gemini'

    def configured(self):
        return bool(
            _clean_setting('PULSAR_GEMINI_API_KEY')
            and _managed_model('GEMINI', 'general')
        )

    def complete(
        self,
        *,
        system,
        user,
        max_tokens=900,
        temperature=0.2,
        tier='general',
        model_override=None,
    ):
        key = _clean_setting('PULSAR_GEMINI_API_KEY')
        model = str(model_override or _managed_model('GEMINI', tier)).strip()
        base_url = _clean_setting(
            'PULSAR_GEMINI_BASE_URL',
            'https://generativelanguage.googleapis.com',
        ).rstrip('/')
        timeout = int(getattr(settings, 'PULSAR_GEMINI_TIMEOUT', 45) or 45)
        if not key or not model:
            raise PulsarError('gemini_not_configured')
        started = time.monotonic()
        encoded_model = quote(model, safe='-_./')
        try:
            response = requests.post(
                f'{base_url}/v1beta/models/{encoded_model}:generateContent',
                params={'key': key},
                headers={'Content-Type': 'application/json'},
                json={
                    'systemInstruction': {'parts': [{'text': str(system)}]},
                    'contents': [{'role': 'user', 'parts': [{'text': str(user)}]}],
                    'generationConfig': {
                        'temperature': float(temperature),
                        'maxOutputTokens': int(max_tokens),
                    },
                },
                timeout=(8, max(15, timeout)),
            )
            response.raise_for_status()
            payload = response.json()
            parts = payload['candidates'][0]['content']['parts']
            answer = ''.join(str(part.get('text') or '') for part in parts)
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as exc:
            logger.warning('Pulsar Gemini request failed: %s', exc)
            raise PulsarError('gemini_failed') from exc
        return _response(
            answer,
            provider=self.name,
            model=model,
            started=started,
            usage=payload.get('usageMetadata'),
        )


PROVIDER_FACTORIES = {
    'cloudflare': ManagedCloudflareProvider,
    'cloudflare-workers-ai': ManagedCloudflareProvider,
    'openai': ManagedOpenAIProvider,
    'anthropic': ManagedAnthropicProvider,
    'gemini': ManagedGeminiProvider,
}


class ModelGateway:
    """Multi-provider boundary used by the Pulsar Harness.

    Tier selection belongs to the DecisionRouter. The gateway then chooses the
    configured provider order for that tier and fails over without changing the
    Harness, Skills, tools or memory contracts.
    """

    def __init__(self, provider=None, providers=None):
        if provider is not None:
            self.providers = [provider]
        elif providers is not None:
            self.providers = list(providers)
        else:
            names = _csv_setting(
                'PULSAR_PROVIDER_ORDER',
                'cloudflare,openai,anthropic,gemini',
            )
            self.providers = []
            seen = set()
            for name in names:
                factory = PROVIDER_FACTORIES.get(name)
                canonical = getattr(factory, 'name', name) if factory else name
                if factory and canonical not in seen:
                    self.providers.append(factory())
                    seen.add(canonical)

    def configured(self):
        return any(provider.configured() for provider in self.providers)

    def status(self):
        return [
            {
                'provider': provider.name,
                'configured': bool(provider.configured()),
            }
            for provider in self.providers
        ]

    def _ordered(self, tier, provider_override=None):
        if provider_override:
            target = str(provider_override).strip().lower()
            matched = [
                provider for provider in self.providers
                if provider.name == target
                or (target == 'cloudflare-workers-ai' and provider.name == 'cloudflare')
            ]
            if not matched:
                raise PulsarError('pulsar_provider_not_available')
            return matched

        pin = _clean_setting(f'PULSAR_PROVIDER_{str(tier or "general").upper()}').lower()
        configured = [provider for provider in self.providers if provider.configured()]
        if not pin:
            return configured
        preferred = [provider for provider in configured if provider.name == pin]
        rest = [provider for provider in configured if provider.name != pin]
        return preferred + rest

    def complete(self, *, provider_override=None, **kwargs):
        tier = kwargs.get('tier', 'general')
        providers = self._ordered(tier, provider_override=provider_override)
        if not providers:
            raise PulsarError('pulsar_no_model_provider_configured')

        errors = []
        for provider in providers:
            try:
                return provider.complete(**kwargs)
            except PulsarError as exc:
                errors.append(f'{provider.name}:{exc}')
                fallback = _clean_setting('PULSAR_MODEL_FALLBACK')
                if fallback:
                    try:
                        return provider.complete(**kwargs, model_override=fallback)
                    except PulsarError as fallback_exc:
                        errors.append(f'{provider.name}:fallback:{fallback_exc}')
                if provider_override:
                    break
                logger.warning(
                    'Pulsar provider %s failed; trying next configured provider',
                    provider.name,
                )
        raise PulsarError('pulsar_all_model_providers_failed:' + '|'.join(errors))
