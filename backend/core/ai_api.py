import json

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .ai_providers import AIProviderError, builtins, generate_text, save_provider, serialize_provider
from .space_models import AIProviderAccount


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400):
    return JsonResponse({'ok': False, 'error': code}, status=status)


def _auth(request):
    return _error('authentication_required', 401) if not request.user.is_authenticated else None


@require_http_methods(['GET', 'POST'])
def ai_providers(request):
    if response := _auth(request):
        return response
    if request.method == 'GET':
        accounts = AIProviderAccount.objects.filter(user=request.user)
        return JsonResponse({
            'ok': True,
            'builtins': builtins(request.user),
            'accounts': [serialize_provider(item) for item in accounts],
        })
    data = _body(request)
    try:
        item = save_provider(request.user, data)
    except ValueError as exc:
        return _error(str(exc))
    return JsonResponse({'ok': True, 'item': serialize_provider(item)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def ai_provider_detail(request, provider_id):
    if response := _auth(request):
        return response
    item = AIProviderAccount.objects.filter(pk=provider_id, user=request.user).first()
    if not item:
        return _error('not_found', 404)
    if request.method == 'DELETE':
        item.delete()
        return JsonResponse({'ok': True})
    try:
        item = save_provider(request.user, _body(request), item=item)
    except ValueError as exc:
        return _error(str(exc))
    return JsonResponse({'ok': True, 'item': serialize_provider(item)})


@require_http_methods(['POST'])
def ai_provider_test(request):
    if response := _auth(request):
        return response
    data = _body(request)
    try:
        provider_id = int(data['provider_id']) if data.get('provider_id') else None
    except (TypeError, ValueError):
        return _error('invalid_provider')
    prompt = str(data.get('prompt') or 'Reply with exactly: Gravitas AI connection is working.').strip()[:1200]
    try:
        output = generate_text(request.user, prompt, 'This is a provider connection test. Be concise.', provider_id=provider_id)
    except AIProviderError as exc:
        return _error(str(exc), 502)
    return JsonResponse({'ok': True, 'output': str(output or '')[:4000]})
