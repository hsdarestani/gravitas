import json

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import nextcloud_api


def _public_base():
    return str(getattr(settings, 'NEXTCLOUD_PUBLIC_URL', '') or '').rstrip('/')


def _rewrite(value):
    """Replace legacy public /nextcloud URLs while leaving internal DAV paths untouched."""
    if isinstance(value, dict):
        return {key: _rewrite(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_rewrite(item) for item in value]
    if isinstance(value, str):
        legacy = str(getattr(settings, 'PUBLIC_BASE_URL', '') or '').rstrip('/') + '/nextcloud'
        if legacy and value.startswith(legacy):
            return _public_base() + value[len(legacy):]
    return value


@require_http_methods(['GET'])
def nextcloud_status_canonical(request):
    response = nextcloud_api.nextcloud_status(request)
    if response.status_code != 200:
        return response
    try:
        payload = json.loads(response.content.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return response
    return JsonResponse(_rewrite(payload), status=response.status_code)


@require_http_methods(['POST'])
def nextcloud_client_credentials_canonical(request):
    response = nextcloud_api.nextcloud_client_credentials(request)
    if response.status_code != 200:
        return response
    try:
        payload = json.loads(response.content.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return response
    credentials = payload.get('credentials') or {}
    base = _public_base()
    if base:
        credentials['server'] = base
        credentials['web_url'] = base + '/'
    return JsonResponse(payload, status=response.status_code)
