import json
import logging
import time

import requests
from django.conf import settings

from .errors import PulsarError
from .types import ProviderResponse


logger = logging.getLogger(__name__)


def _clean_setting(name, default=''):
    return str(getattr(settings, name, default) or '').strip()


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


def _model_for_tier(tier):
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


class ManagedCloudflareProvider:
    name = 'cloudflare-workers-ai'

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
        model = str(model_override or _model_for_tier(tier)).strip()
        timeout = int(getattr(settings, 'CLOUDFLARE_AI_TIMEOUT', 45) or 45)
        if not account_id or not token:
            raise PulsarError('cloudflare_ai_not_configured')

        endpoint = f'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}'
        started = time.monotonic()
        try:
            response = requests.post(
                endpoint,
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
            logger.warning('Pulsar Cloudflare error payload: %s', payload.get('errors'))
            raise PulsarError('cloudflare_ai_failed')

        result = payload.get('result')
        if isinstance(result, dict):
            answer = result.get('response') or result.get('text') or result.get('answer')
            usage = result.get('usage') if isinstance(result.get('usage'), dict) else {}
        else:
            answer = result
            usage = {}
        if not usage and isinstance(payload.get('usage'), dict):
            usage = payload.get('usage')
        answer = str(answer or '').strip()
        if not answer:
            raise PulsarError('cloudflare_ai_empty')

        input_tokens = int(
            usage.get('input_tokens')
            or usage.get('prompt_tokens')
            or usage.get('promptTokens')
            or 0
        )
        output_tokens = int(
            usage.get('output_tokens')
            or usage.get('completion_tokens')
            or usage.get('completionTokens')
            or 0
        )
        return ProviderResponse(
            text=answer,
            provider=self.name,
            model=model,
            latency_ms=max(0, int((time.monotonic() - started) * 1000)),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost_usd=_estimate_cost(model, input_tokens, output_tokens),
        )


class ModelGateway:
    """Replaceable model-provider boundary used by the Pulsar Harness."""

    def __init__(self, provider=None):
        self.provider = provider or ManagedCloudflareProvider()

    def configured(self):
        return bool(self.provider.configured())

    def complete(self, **kwargs):
        try:
            return self.provider.complete(**kwargs)
        except PulsarError:
            fallback = _clean_setting('PULSAR_MODEL_FALLBACK')
            if not fallback:
                raise
            logger.warning(
                'Pulsar primary model failed; retrying configured fallback model %s',
                fallback,
            )
            return self.provider.complete(**kwargs, model_override=fallback)
