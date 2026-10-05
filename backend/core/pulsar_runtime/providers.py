import logging
import time

import requests
from django.conf import settings

from .errors import PulsarError
from .types import ProviderResponse


logger = logging.getLogger(__name__)


def _clean_setting(name, default=''):
    return str(getattr(settings, name, default) or '').strip()


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

    def complete(self, *, system, user, max_tokens=900, temperature=0.2, tier='general'):
        account_id = _clean_setting('CLOUDFLARE_AI_ACCOUNT_ID')
        token = _clean_setting('CLOUDFLARE_AI_API_TOKEN')
        model = _model_for_tier(tier)
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
        else:
            answer = result
        answer = str(answer or '').strip()
        if not answer:
            raise PulsarError('cloudflare_ai_empty')

        return ProviderResponse(
            text=answer,
            provider=self.name,
            model=model,
            latency_ms=max(0, int((time.monotonic() - started) * 1000)),
        )


class ModelGateway:
    """Replaceable model-provider boundary used by the Pulsar Harness."""

    def __init__(self, provider=None):
        self.provider = provider or ManagedCloudflareProvider()

    def configured(self):
        return bool(self.provider.configured())

    def complete(self, **kwargs):
        return self.provider.complete(**kwargs)
