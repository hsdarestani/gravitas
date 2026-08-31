import ipaddress
import json
import logging
import socket
from urllib.parse import quote, urlparse

import requests
from django.conf import settings

from . import cloud
from .space_models import AIProviderCredential

logger = logging.getLogger(__name__)

DEFAULT_MODELS = {
    AIProviderCredential.Provider.OPENAI: 'gpt-4.1-mini',
    AIProviderCredential.Provider.ANTHROPIC: 'claude-sonnet-4-20250514',
    AIProviderCredential.Provider.GEMINI: 'gemini-2.5-flash',
    AIProviderCredential.Provider.OPENAI_COMPATIBLE: '',
}
DEFAULT_BASE_URLS = {
    AIProviderCredential.Provider.OPENAI: 'https://api.openai.com/v1',
    AIProviderCredential.Provider.ANTHROPIC: 'https://api.anthropic.com',
    AIProviderCredential.Provider.GEMINI: 'https://generativelanguage.googleapis.com',
}


class AIProviderError(Exception):
    pass


def encrypt_api_key(value):
    return cloud._encrypt(str(value or '').strip())


def decrypt_api_key(value):
    return cloud._decrypt(value)


def _clean_json_text(value):
    text = str(value or '').strip()
    if text.startswith('```'):
        lines = text.splitlines()
        if lines:
            lines = lines[1:]
        if lines and lines[-1].strip().startswith('```'):
            lines = lines[:-1]
        text = '\n'.join(lines).strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AIProviderError('ai_provider_invalid_json') from exc
    if not isinstance(payload, dict):
        raise AIProviderError('ai_provider_invalid_json')
    return payload


def _public_https_base_url(value, provider):
    raw = str(value or DEFAULT_BASE_URLS.get(provider, '')).strip().rstrip('/')
    if not raw:
        raise ValueError('base_url_required')
    parsed = urlparse(raw)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('invalid_base_url')
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError('base_url_unresolvable') from exc
    for entry in addresses:
        try:
            ip = ipaddress.ip_address(entry[4][0])
        except ValueError as exc:
            raise ValueError('invalid_base_url') from exc
        if not ip.is_global:
            raise ValueError('private_base_url_not_allowed')
    return raw


def validate_provider_config(provider, model, base_url):
    if provider not in AIProviderCredential.Provider.values:
        raise ValueError('invalid_ai_provider')
    clean_model = str(model or DEFAULT_MODELS.get(provider, '')).strip()[:220]
    if not clean_model:
        raise ValueError('model_required')
    clean_base = _public_https_base_url(base_url, provider)
    return clean_model, clean_base


def selected_credential(user):
    return AIProviderCredential.objects.filter(user=user, is_default=True).order_by('-updated_at').first()


def provider_summary(user):
    selected = selected_credential(user)
    return {
        'selected': 'credential' if selected else 'managed',
        'selected_id': selected.pk if selected else None,
        'managed': {
            'id': 'managed',
            'provider': 'cloudflare-workers-ai',
            'label': 'Gravitas managed AI',
            'model': str(getattr(settings, 'CLOUDFLARE_AI_MODEL', '') or '@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
            'available': bool(getattr(settings, 'CLOUDFLARE_AI_ACCOUNT_ID', '') and getattr(settings, 'CLOUDFLARE_AI_API_TOKEN', '')),
        },
        'nextcloud': {
            'id': 'nextcloud',
            'provider': 'nextcloud-assistant',
            'label': 'Nextcloud Assistant',
            'url': str(getattr(settings, 'NEXTCLOUD_PUBLIC_URL', '') or '').rstrip('/') + '/',
            'native': True,
        },
        'credentials': [credential_json(item) for item in AIProviderCredential.objects.filter(user=user)],
    }


def credential_json(item):
    return {
        'id': item.pk,
        'provider': item.provider,
        'label': item.label,
        'model': item.model,
        'base_url': item.base_url,
        'is_default': item.is_default,
        'has_api_key': bool(item.encrypted_api_key),
        'updated_at': item.updated_at.isoformat() if item.updated_at else None,
    }


def _request_json(method, url, *, headers=None, params=None, payload=None, timeout=60):
    try:
        response = requests.request(
            method, url,
            headers=headers or {}, params=params, json=payload,
            timeout=(8, max(15, int(timeout))),
        )
    except requests.RequestException as exc:
        raise AIProviderError('ai_provider_unavailable') from exc
    if response.status_code < 200 or response.status_code >= 300:
        logger.warning('AI provider HTTP %s from %s', response.status_code, urlparse(url).hostname)
        raise AIProviderError('ai_provider_failed')
    try:
        return response.json()
    except requests.JSONDecodeError as exc:
        raise AIProviderError('ai_provider_invalid_response') from exc


def _messages(prompt):
    system = (
        'You are an expert research mind-map architect. Return only valid JSON. '
        'Use the same language as the user. Create one concrete root, 3-6 primary branches when possible, '
        'secondary concepts below them, no filler titles, no duplicate concepts, and at most three hierarchy levels. '
        'Return an object with title, summary, nodes and edges. Each node needs key, title, body and kind. '
        'Each edge needs source, target, relation and label.'
    )
    return system, prompt


def _openai_graph(item, api_key, prompt, *, timeout):
    system, user = _messages(prompt)
    url = item.base_url.rstrip('/') + '/chat/completions'
    body = {
        'model': item.model,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user},
        ],
        'temperature': 0.2,
        'response_format': {'type': 'json_object'},
    }
    headers = {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}
    try:
        payload = _request_json('POST', url, headers=headers, payload=body, timeout=timeout)
    except AIProviderError:
        # Some OpenAI-compatible services do not implement response_format.
        body.pop('response_format', None)
        payload = _request_json('POST', url, headers=headers, payload=body, timeout=timeout)
    try:
        return _clean_json_text(payload['choices'][0]['message']['content'])
    except (KeyError, IndexError, TypeError) as exc:
        raise AIProviderError('ai_provider_invalid_response') from exc


def _anthropic_graph(item, api_key, prompt, *, timeout):
    system, user = _messages(prompt)
    payload = _request_json(
        'POST', item.base_url.rstrip('/') + '/v1/messages',
        headers={
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        payload={
            'model': item.model,
            'max_tokens': 4000,
            'temperature': 0.2,
            'system': system,
            'messages': [{'role': 'user', 'content': user}],
        },
        timeout=timeout,
    )
    try:
        chunks = [part.get('text', '') for part in payload['content'] if part.get('type') == 'text']
        return _clean_json_text(''.join(chunks))
    except (KeyError, TypeError) as exc:
        raise AIProviderError('ai_provider_invalid_response') from exc


def _gemini_graph(item, api_key, prompt, *, timeout):
    system, user = _messages(prompt)
    model = quote(item.model, safe='-_./')
    payload = _request_json(
        'POST', f"{item.base_url.rstrip('/')}/v1beta/models/{model}:generateContent",
        params={'key': api_key},
        headers={'Content-Type': 'application/json'},
        payload={
            'systemInstruction': {'parts': [{'text': system}]},
            'contents': [{'role': 'user', 'parts': [{'text': user}]}],
            'generationConfig': {
                'temperature': 0.2,
                'responseMimeType': 'application/json',
            },
        },
        timeout=timeout,
    )
    try:
        parts = payload['candidates'][0]['content']['parts']
        return _clean_json_text(''.join(str(part.get('text') or '') for part in parts))
    except (KeyError, IndexError, TypeError) as exc:
        raise AIProviderError('ai_provider_invalid_response') from exc


def provider_graph(user, prompt, *, timeout=60):
    item = selected_credential(user)
    if not item:
        return None, None
    api_key = decrypt_api_key(item.encrypted_api_key)
    if item.provider in {AIProviderCredential.Provider.OPENAI, AIProviderCredential.Provider.OPENAI_COMPATIBLE}:
        graph = _openai_graph(item, api_key, prompt, timeout=timeout)
    elif item.provider == AIProviderCredential.Provider.ANTHROPIC:
        graph = _anthropic_graph(item, api_key, prompt, timeout=timeout)
    elif item.provider == AIProviderCredential.Provider.GEMINI:
        graph = _gemini_graph(item, api_key, prompt, timeout=timeout)
    else:
        raise AIProviderError('invalid_ai_provider')
    return graph, item
