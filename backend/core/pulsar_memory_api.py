import json

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .pulsar_runtime.continuity import get_thread, normalize_thread_key
from .pulsar_runtime.memory import remember


def _memory_payload(row):
    return {
        'id': row.pk,
        'kind': row.kind,
        'content': row.content,
        'scope': row.scope,
        'source_kind': row.source_kind,
        'source_ref': row.source_ref,
        'source_url': row.source_url,
        'confidence': row.confidence,
        'active': row.is_active,
        'last_verified_at': row.last_verified_at.isoformat() if row.last_verified_at else None,
        'created_at': row.created_at.isoformat(),
        'updated_at': row.updated_at.isoformat(),
    }


@require_http_methods(['GET', 'POST'])
def pulsar_memories(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    from .models import PulsarMemoryEntry

    if request.method == 'POST':
        try:
            data = json.loads(request.body or '{}')
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = {}
        try:
            row, created = remember(
                request.user,
                kind=data.get('kind'),
                content=data.get('content'),
                scope=data.get('scope'),
                source_kind=data.get('source_kind') or 'user',
                source_ref=data.get('source_ref') or '',
                source_url=data.get('source_url') or '',
                confidence=data.get('confidence', 1),
            )
        except (ValueError, TypeError) as exc:
            return JsonResponse({'ok': False, 'error': str(exc)}, status=400)
        return JsonResponse({'ok': True, 'created': created, 'memory': _memory_payload(row)})

    rows = PulsarMemoryEntry.objects.filter(
        user=request.user,
        is_active=True,
    ).order_by('-updated_at')[:100]
    return JsonResponse({'ok': True, 'memories': [_memory_payload(row) for row in rows]})


@require_http_methods(['POST'])
def pulsar_memory_disable(request, memory_id):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    from .models import PulsarMemoryEntry

    row = PulsarMemoryEntry.objects.filter(pk=memory_id, user=request.user).first()
    if not row:
        return JsonResponse({'ok': False, 'error': 'memory_not_found'}, status=404)
    row.is_active = False
    row.save(update_fields=['is_active', 'updated_at'])
    return JsonResponse({'ok': True})


@require_http_methods(['GET'])
def pulsar_thread_state(request, thread_key):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    from .models import PulsarRun

    thread = get_thread(request.user, normalize_thread_key(thread_key))
    runs = PulsarRun.objects.filter(thread=thread).order_by('-created_at')[:20]
    return JsonResponse({
        'ok': True,
        'thread': {
            'key': thread.thread_key,
            'surface': thread.current_surface,
            'skill': thread.current_skill,
            'status': thread.status,
            'state': thread.state,
            'last_run_at': thread.last_run_at.isoformat() if thread.last_run_at else None,
        },
        'runs': [{
            'run_id': row.run_id,
            'surface': row.surface,
            'skill': row.skill,
            'status': row.status,
            'wait_until': row.wait_until.isoformat() if row.wait_until else None,
            'created_at': row.created_at.isoformat(),
        } for row in runs],
    })
