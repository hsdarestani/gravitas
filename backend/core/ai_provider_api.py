import json

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .ai_providers import (
    DEFAULT_MODELS,
    credential_json,
    encrypt_api_key,
    provider_summary,
    validate_provider_config,
)
from .space_models import AIProviderCredential


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _auth(request):
    return _error('authentication_required', 401) if not request.user.is_authenticated else None


@require_http_methods(['GET', 'POST'])
def ai_providers(request):
    if response := _auth(request):
        return response
    if request.method == 'GET':
        return JsonResponse({'ok': True, **provider_summary(request.user)})

    data = _body(request)
    action = str(data.get('action') or 'save').strip().lower()
    if action == 'use_managed':
        AIProviderCredential.objects.filter(user=request.user, is_default=True).update(is_default=False)
        return JsonResponse({'ok': True, **provider_summary(request.user)})

    if action == 'select':
        item = AIProviderCredential.objects.filter(pk=data.get('id'), user=request.user).first()
        if not item:
            return _error('ai_provider_not_found', 404)
        with transaction.atomic():
            AIProviderCredential.objects.filter(user=request.user, is_default=True).exclude(pk=item.pk).update(is_default=False)
            if not item.is_default:
                item.is_default = True
                item.save(update_fields=['is_default', 'updated_at'])
        return JsonResponse({'ok': True, **provider_summary(request.user)})

    if action != 'save':
        return _error('invalid_action')

    item = None
    if data.get('id'):
        item = AIProviderCredential.objects.filter(pk=data['id'], user=request.user).first()
        if not item:
            return _error('ai_provider_not_found', 404)

    provider = str(data.get('provider') or (item.provider if item else '')).strip().lower()
    label = str(data.get('label') or (item.label if item else '')).strip()[:120]
    if not label:
        return _error('label_required')
    model = str(data.get('model') or (item.model if item else DEFAULT_MODELS.get(provider, ''))).strip()
    base_url = str(data.get('base_url') or (item.base_url if item else '')).strip()
    try:
        model, base_url = validate_provider_config(provider, model, base_url)
    except ValueError as exc:
        return _error(str(exc))

    api_key = str(data.get('api_key') or '').strip()
    if item is None and not api_key:
        return _error('api_key_required')

    make_default = data.get('is_default') is not False
    with transaction.atomic():
        if make_default:
            AIProviderCredential.objects.filter(user=request.user, is_default=True).update(is_default=False)
        if item is None:
            item = AIProviderCredential.objects.create(
                user=request.user,
                provider=provider,
                label=label,
                model=model,
                base_url=base_url,
                encrypted_api_key=encrypt_api_key(api_key),
                is_default=make_default,
            )
        else:
            item.provider = provider
            item.label = label
            item.model = model
            item.base_url = base_url
            item.is_default = make_default
            if api_key:
                item.encrypted_api_key = encrypt_api_key(api_key)
            item.save()
    return JsonResponse({'ok': True, 'credential': credential_json(item), **provider_summary(request.user)}, status=201 if not data.get('id') else 200)


@require_http_methods(['DELETE'])
def ai_provider_detail(request, provider_id):
    if response := _auth(request):
        return response
    item = AIProviderCredential.objects.filter(pk=provider_id, user=request.user).first()
    if not item:
        return _error('ai_provider_not_found', 404)
    item.delete()
    return JsonResponse({'ok': True, **provider_summary(request.user)})
