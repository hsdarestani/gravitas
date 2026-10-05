import logging

import requests
from django.conf import settings

from .errors import PulsarError


logger = logging.getLogger(__name__)
EMBEDDING_DIMENSIONS = 1024


def configured():
    return bool(
        str(getattr(settings, 'CLOUDFLARE_AI_ACCOUNT_ID', '') or '').strip()
        and str(getattr(settings, 'CLOUDFLARE_AI_API_TOKEN', '') or '').strip()
        and str(getattr(settings, 'PULSAR_EMBEDDING_MODEL', '') or '').strip()
    )


def embed_texts(texts):
    rows = [str(value or '').strip() for value in texts]
    if not rows or any(not value for value in rows):
        raise PulsarError('embedding_text_required')
    if not configured():
        raise PulsarError('embedding_not_configured')

    account_id = str(settings.CLOUDFLARE_AI_ACCOUNT_ID).strip()
    token = str(settings.CLOUDFLARE_AI_API_TOKEN).strip()
    model = str(settings.PULSAR_EMBEDDING_MODEL).strip()
    timeout = int(getattr(settings, 'PULSAR_EMBEDDING_TIMEOUT', 30) or 30)
    endpoint = f'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}'
    try:
        response = requests.post(
            endpoint,
            headers={
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/json',
            },
            json={'text': rows},
            timeout=(5, max(10, timeout)),
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning('Pulsar embedding request failed: %s', exc)
        raise PulsarError('embedding_failed') from exc

    if payload.get('success') is False:
        raise PulsarError('embedding_failed')
    result = payload.get('result')
    data = result.get('data') if isinstance(result, dict) else None
    if not isinstance(data, list):
        raise PulsarError('embedding_invalid_response')
    if data and isinstance(data[0], (int, float)):
        data = [data]
    if len(data) != len(rows):
        raise PulsarError('embedding_count_mismatch')
    clean = []
    for vector in data:
        if not isinstance(vector, list) or len(vector) != EMBEDDING_DIMENSIONS:
            raise PulsarError('embedding_dimension_mismatch')
        clean.append([float(value) for value in vector])
    return clean
