import json

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .kms_models import KMSState


EMPTY_STATE = {
    'sources': [],
    'cards': [],
    'paths': [],
    'skills': [],
    'log': [],
}

# Bounds are deliberately well above normal personal use. They protect the
# JSON state row from accidental megabyte-scale payloads without imposing a
# product-visible limit on an ordinary learning workspace.
LIMITS = {
    'sources': 2000,
    'cards': 5000,
    'paths': 500,
    'skills': 500,
    'log': 2000,
}
MAX_STATE_BYTES = 2 * 1024 * 1024


def _error(code, status=400):
    return JsonResponse({'ok': False, 'error': code}, status=status)


def _clean_state(value):
    if not isinstance(value, dict):
        raise ValueError('invalid_state')
    cleaned = {}
    for key, limit in LIMITS.items():
        items = value.get(key, [])
        if not isinstance(items, list):
            raise ValueError(f'invalid_{key}')
        if len(items) > limit:
            raise ValueError(f'{key}_limit_exceeded')
        if any(not isinstance(item, dict) for item in items):
            raise ValueError(f'invalid_{key}')
        cleaned[key] = items
    encoded = json.dumps(cleaned, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    if len(encoded) > MAX_STATE_BYTES:
        raise ValueError('state_too_large')
    return cleaned


def _payload(row):
    data = dict(EMPTY_STATE)
    if row and isinstance(row.data, dict):
        for key in EMPTY_STATE:
            if isinstance(row.data.get(key), list):
                data[key] = row.data[key]
    return {
        'ok': True,
        'state': data,
        'schema_version': row.schema_version if row else 1,
        'updated_at': row.updated_at.isoformat() if row else None,
    }


@require_http_methods(['GET', 'PUT'])
def kms_state(request):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)

    if request.method == 'GET':
        row = KMSState.objects.filter(user=request.user).first()
        return JsonResponse(_payload(row))

    if len(request.body or b'') > MAX_STATE_BYTES:
        return _error('state_too_large', 413)
    try:
        incoming = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _error('invalid_json')
    try:
        cleaned = _clean_state(incoming.get('state', incoming))
    except ValueError as exc:
        return _error(str(exc))

    with transaction.atomic():
        row, _created = KMSState.objects.select_for_update().get_or_create(
            user=request.user,
            defaults={'data': cleaned, 'schema_version': 1},
        )
        row.data = cleaned
        row.schema_version = 1
        row.save(update_fields=['data', 'schema_version', 'updated_at'])
    return JsonResponse(_payload(row))
