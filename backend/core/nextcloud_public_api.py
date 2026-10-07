import json

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import nextcloud_api
from .layer_access import module_access
from .layer_models import ModuleGrant


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
    payload = _rewrite(payload)

    # Object ACLs and the product-layer entitlement are separate contracts.
    # A lingering ProjectMembership/direct grant must not advertise native Team
    # Folder URLs to an account whose Research layer was explicitly suspended.
    # Core members retain the control-plane view of projects they can otherwise
    # see, even when their own Research layer is intentionally disabled.
    if not (
        module_access(request.user, ModuleGrant.Module.RESEARCH)
        or module_access(request.user, ModuleGrant.Module.CORE)
    ):
        payload['projects'] = []

    nextcloud = payload.get('nextcloud') or {}
    nextcloud['sso_url'] = '/api/platform/nextcloud/sso/'
    nextcloud['sso_ready'] = str(getattr(settings, 'NEXTCLOUD_OIDC_PROVIDER_ID', '') or '').isdigit()
    payload['nextcloud'] = nextcloud
    return JsonResponse(payload, status=response.status_code)


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
