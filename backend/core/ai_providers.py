import json
import time
from urllib.parse import quote

import requests
from django.conf import settings
from django.db import transaction

from . import cloud
from .space_models import AIProviderAccount


class AIProviderError(Exception):
    pass


PROVIDER_DEFAULTS = {
    AIProviderAccount.Provider.NEXTCLOUD: {'label': 'Nextcloud AI', 'model': ''},
    AIProviderAccount.Provider.GRAVITAS: {'label': 'Gravitas AI', 'model': ''},
    AIProviderAccount.Provider.OPENAI: {'label': 'OpenAI', 'model': 'gpt-5-mini'},
    AIProviderAccount.Provider.ANTHROPIC: {'label': 'Anthropic', 'model': 'claude-sonnet-4-5'},
    AIProviderAccount.Provider.GEMINI: {'label': 'Google Gemini', 'model': 'gemini-2.5-flash'},
    AIProviderAccount.Provider.OPENAI_COMPATIBLE: {'label': 'Custom AI', 'model': ''},
}


def encrypt_secret(value):
    return cloud._encrypt(str(value)) if value else ''


def decrypt_secret(value):
    if not value:
        return ''
    try:
        return cloud._decrypt(value)
    except cloud.CloudError as exc:
        raise AIProviderError('provider_credentials_unavailable') from exc


def serialize_provider(item):
    return {
        'id': item.pk,
        'provider': item.provider,
        'label': item.label,
        'model': item.model,
        'base_url': item.base_url,
        'enabled': item.enabled,
        'is_default': item.is_default,
        'has_api_key': bool(item.encrypted_api_key),
        'metadata': item.metadata,
        'updated_at': item.updated_at.isoformat(),
    }


def builtins(user):
    configured = list(AIProviderAccount.objects.filter(user=user))
    providers = {item.provider for item in configured if item.enabled}
    return [
        {
            'provider': AIProviderAccount.Provider.NEXTCLOUD,
            'label': 'Nextcloud AI',
            'description': 'Uses the AI Task Processing providers connected to your Nextcloud account.',
            'available': bool(getattr(user, 'gravitas_nextcloud', None)),
            'managed': True,
        },
        {
            'provider': AIProviderAccount.Provider.GRAVITAS,
            'label': 'Gravitas AI',
            'description': 'Uses the managed Gravitas model when configured by the platform.',
            'available': bool(getattr(settings, 'CLOUDFLARE_AI_ACCOUNT_ID', '') and getattr(settings, 'CLOUDFLARE_AI_API_TOKEN', '')),
            'managed': True,
        },
        {
            'provider': key,
            'label': PROVIDER_DEFAULTS[key]['label'],
            'description': 'Bring your own account/API key.',
            'available': key in providers,
            'managed': False,
        }
        for key in (
            AIProviderAccount.Provider.OPENAI,
            AIProviderAccount.Provider.ANTHROPIC,
            AIProviderAccount.Provider.GEMINI,
            AIProviderAccount.Provider.OPENAI_COMPATIBLE,
        )
    ]


def save_provider(user, data, item=None):
    provider = str(data.get('provider') or (item.provider if item else '')).strip()
    if provider not in AIProviderAccount.Provider.values:
        raise ValueError('invalid_provider')
    defaults = PROVIDER_DEFAULTS[provider]
    label = str(data.get('label') or (item.label if item else '') or defaults['label']).strip()[:120]
    if not label:
        raise ValueError('label_required')
    model = str(data.get('model') if 'model' in data else (item.model if item else defaults['model'])).strip()[:180]
    base_url = str(data.get('base_url') if 'base_url' in data else (item.base_url if item else '')).strip()[:1000]
    if provider == AIProviderAccount.Provider.OPENAI_COMPATIBLE and not base_url:
        raise ValueError('base_url_required')
    if provider in {AIProviderAccount.Provider.NEXTCLOUD, AIProviderAccount.Provider.GRAVITAS}:
        api_key = ''
    else:
        api_key = data.get('api_key')
        if item is None and not api_key:
            raise ValueError('api_key_required')
    with transaction.atomic():
        if item is None:
            item = AIProviderAccount(user=user, provider=provider, label=label)
        item.provider = provider
        item.label = label
        item.model = model
        item.base_url = base_url
        item.enabled = bool(data.get('enabled', item.enabled if item.pk else True))
        item.metadata = data.get('metadata') if isinstance(data.get('metadata'), dict) else (item.metadata or {})
        if api_key:
            item.encrypted_api_key = encrypt_secret(api_key)
        if data.get('clear_api_key'):
            item.encrypted_api_key = ''
        requested_default = bool(data.get('is_default', item.is_default if item.pk else False))
        item.is_default = requested_default
        if requested_default:
            AIProviderAccount.objects.filter(user=user, is_default=True).exclude(pk=item.pk).update(is_default=False)
        item.save()
    return item


def default_provider(user):
    explicit = AIProviderAccount.objects.filter(user=user, enabled=True, is_default=True).first()
    if explicit:
        return explicit
    first = AIProviderAccount.objects.filter(user=user, enabled=True).first()
    if first:
        return first
    # Prefer Nextcloud AI when a native identity exists, otherwise managed AI.
    if getattr(user, 'gravitas_nextcloud', None):
        return AIProviderAccount(user=user, provider='nextcloud', label='Nextcloud AI', enabled=True)
    if getattr(settings, 'CLOUDFLARE_AI_ACCOUNT_ID', '') and getattr(settings, 'CLOUDFLARE_AI_API_TOKEN', ''):
        return AIProviderAccount(user=user, provider='gravitas', label='Gravitas AI', enabled=True)
    raise AIProviderError('no_ai_provider_configured')


def _messages(prompt, system_prompt=''):
    result = []
    if system_prompt:
        result.append({'role': 'system', 'content': system_prompt})
    result.append({'role': 'user', 'content': prompt})
    return result


def _raise_http(response, code):
    if response.status_code >= 400:
        raise AIProviderError(code)
    try:
        return response.json()
    except ValueError as exc:
        raise AIProviderError(f'{code}_invalid_response') from exc


def _openai(account, prompt, system_prompt):
    key = decrypt_secret(account.encrypted_api_key)
    model = account.model or PROVIDER_DEFAULTS['openai']['model']
    response = requests.post(
        'https://api.openai.com/v1/chat/completions',
        headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
        json={'model': model, 'messages': _messages(prompt, system_prompt), 'temperature': 0.2},
        timeout=60,
    )
    data = _raise_http(response, 'openai_failed')
    try:
        return data['choices'][0]['message']['content']
    except (KeyError, IndexError, TypeError) as exc:
        raise AIProviderError('openai_invalid_response') from exc


def _anthropic(account, prompt, system_prompt):
    key = decrypt_secret(account.encrypted_api_key)
    model = account.model or PROVIDER_DEFAULTS['anthropic']['model']
    payload = {'model': model, 'max_tokens': 4096, 'messages': [{'role': 'user', 'content': prompt}]}
    if system_prompt:
        payload['system'] = system_prompt
    response = requests.post(
        'https://api.anthropic.com/v1/messages',
        headers={'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'},
        json=payload,
        timeout=60,
    )
    data = _raise_http(response, 'anthropic_failed')
    try:
        return ''.join(part.get('text', '') for part in data['content'] if part.get('type') == 'text')
    except (KeyError, TypeError) as exc:
        raise AIProviderError('anthropic_invalid_response') from exc


def _gemini(account, prompt, system_prompt):
    key = decrypt_secret(account.encrypted_api_key)
    model = account.model or PROVIDER_DEFAULTS['gemini']['model']
    text = f'{system_prompt}\n\n{prompt}'.strip() if system_prompt else prompt
    response = requests.post(
        f'https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe="-._")}:generateContent',
        params={'key': key},
        headers={'Content-Type': 'application/json'},
        json={'contents': [{'parts': [{'text': text}]}], 'generationConfig': {'temperature': 0.2}},
        timeout=60,
    )
    data = _raise_http(response, 'gemini_failed')
    try:
        return ''.join(part.get('text', '') for part in data['candidates'][0]['content']['parts'])
    except (KeyError, IndexError, TypeError) as exc:
        raise AIProviderError('gemini_invalid_response') from exc


def _compatible(account, prompt, system_prompt):
    key = decrypt_secret(account.encrypted_api_key)
    base = account.base_url.rstrip('/')
    endpoint = base + ('/chat/completions' if base.endswith('/v1') else '/v1/chat/completions' if '/v1' not in base.rsplit('/', 1)[-1] else '/chat/completions')
    response = requests.post(
        endpoint,
        headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
        json={'model': account.model, 'messages': _messages(prompt, system_prompt), 'temperature': 0.2},
        timeout=60,
    )
    data = _raise_http(response, 'compatible_provider_failed')
    try:
        return data['choices'][0]['message']['content']
    except (KeyError, IndexError, TypeError) as exc:
        raise AIProviderError('compatible_provider_invalid_response') from exc


def _gravitas(prompt, system_prompt):
    account_id = str(getattr(settings, 'CLOUDFLARE_AI_ACCOUNT_ID', '') or '').strip()
    token = str(getattr(settings, 'CLOUDFLARE_AI_API_TOKEN', '') or '').strip()
    model = str(getattr(settings, 'CLOUDFLARE_AI_MODEL', '@cf/meta/llama-3.3-70b-instruct-fp8-fast') or '').strip()
    if not account_id or not token:
        raise AIProviderError('gravitas_ai_not_configured')
    response = requests.post(
        f'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        json={'messages': _messages(prompt, system_prompt), 'temperature': 0.2, 'max_tokens': 4096},
        timeout=int(getattr(settings, 'CLOUDFLARE_AI_TIMEOUT', 45) or 45),
    )
    data = _raise_http(response, 'gravitas_ai_failed')
    if not data.get('success'):
        raise AIProviderError('gravitas_ai_failed')
    result = data.get('result') or {}
    return result.get('response') if isinstance(result, dict) else str(result)


def _nextcloud(user, prompt, system_prompt):
    identity = cloud.ensure_identity(user, getattr(getattr(user, 'gravitas_storage_plan', None), 'quota_bytes', settings.GRAVITAS_DEFAULT_QUOTA_BYTES))
    text = f'{system_prompt}\n\n{prompt}'.strip() if system_prompt else prompt
    response = cloud._request(
        'POST',
        f'{settings.NEXTCLOUD_INTERNAL_URL}/ocs/v2.php/taskprocessing/schedule',
        auth=cloud._auth(identity),
        expected={200},
        headers={'OCS-APIRequest': 'true', 'Accept': 'application/json', 'Content-Type': 'application/json'},
        params={'format': 'json'},
        json={'input': {'input': text}, 'type': 'core:text2text', 'appId': 'gravitas'},
    )
    data = cloud._ocs_data(response, 'Could not schedule Nextcloud AI task') or {}
    task_id = data.get('id') if isinstance(data, dict) else data
    if task_id is None:
        raise AIProviderError('nextcloud_ai_schedule_failed')
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        response = cloud._request(
            'GET',
            f'{settings.NEXTCLOUD_INTERNAL_URL}/ocs/v2.php/taskprocessing/task/{task_id}',
            auth=cloud._auth(identity), expected={200},
            headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'}, params={'format': 'json'},
        )
        task = cloud._ocs_data(response, 'Could not read Nextcloud AI task') or {}
        status = str(task.get('status') or '').upper()
        if status in {'STATUS_SUCCESSFUL', 'SUCCESSFUL', '3'}:
            output = task.get('output') or {}
            return output.get('output') if isinstance(output, dict) else str(output)
        if status in {'STATUS_FAILED', 'FAILED', '4'}:
            raise AIProviderError('nextcloud_ai_failed')
        time.sleep(0.65)
    raise AIProviderError('nextcloud_ai_timeout')


def generate_text(user, prompt, system_prompt='', provider_id=None):
    account = None
    if provider_id:
        account = AIProviderAccount.objects.filter(pk=provider_id, user=user, enabled=True).first()
        if not account:
            raise AIProviderError('ai_provider_not_found')
    account = account or default_provider(user)
    provider = account.provider
    if provider == AIProviderAccount.Provider.NEXTCLOUD:
        return _nextcloud(user, prompt, system_prompt)
    if provider == AIProviderAccount.Provider.GRAVITAS:
        return _gravitas(prompt, system_prompt)
    if provider == AIProviderAccount.Provider.OPENAI:
        return _openai(account, prompt, system_prompt)
    if provider == AIProviderAccount.Provider.ANTHROPIC:
        return _anthropic(account, prompt, system_prompt)
    if provider == AIProviderAccount.Provider.GEMINI:
        return _gemini(account, prompt, system_prompt)
    if provider == AIProviderAccount.Provider.OPENAI_COMPATIBLE:
        return _compatible(account, prompt, system_prompt)
    raise AIProviderError('unsupported_ai_provider')


def parse_json_output(text):
    raw = str(text or '').strip()
    if raw.startswith('```'):
        lines = raw.splitlines()
        if lines and lines[0].startswith('```'):
            lines = lines[1:]
        if lines and lines[-1].strip() == '```':
            lines = lines[:-1]
        raw = '\n'.join(lines).strip()
    start, end = raw.find('{'), raw.rfind('}')
    if start >= 0 and end > start:
        raw = raw[start:end + 1]
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise AIProviderError('ai_invalid_json') from exc


def generate_mindmap_graph(user, prompt, max_nodes=14, provider_id=None):
    kinds = 'concept, question, hypothesis, evidence, source, dataset, method, result, task, note'
    system = (
        'You are a research mind-map architect. Return JSON only with keys title, summary, nodes, edges. '
        'Each node must contain key, title, body, kind. Allowed kinds: ' + kinds + '. '
        'Each edge must contain source, target, relation, label. Use one root and 3-6 primary branches, '
        'maximum depth 3. Keep titles concrete and short. Never reference a missing node key.'
    )
    text = generate_text(user, f'{prompt}\nTarget at most {int(max_nodes)} nodes.', system, provider_id=provider_id)
    return parse_json_output(text)
