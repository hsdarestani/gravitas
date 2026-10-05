import json

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .models import PulsarMemoryItem, PulsarThread
from .pulsar_runtime.errors import PulsarPermissionError
from .pulsar_runtime.memory import recent_turns, remember, resolve_thread


def _thread_json(thread, include_turns=False):
    data = {
        'id': str(thread.public_id),
        'title': thread.title,
        'status': thread.status,
        'primary_surface': thread.primary_surface,
        'resource_scope': thread.resource_scope,
        'created_at': thread.created_at.isoformat(),
        'last_active_at': thread.last_active_at.isoformat(),
    }
    if include_turns:
        data['turns'] = [{
            'role': row.role,
            'surface': row.surface,
            'skill': row.skill,
            'content': row.content,
            'run_id': row.run_id,
            'created_at': row.created_at.isoformat(),
        } for row in recent_turns(thread, limit=30)]
    return data


@require_http_methods(['GET', 'POST'])
def pulsar_threads(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    if request.method == 'POST':
        try:
            data = json.loads(request.body or '{}')
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = {}
        thread = resolve_thread(
            request.user,
            surface=str(data.get('surface') or 'core')[:32],
            resource_scope=data.get('resource_scope') if isinstance(data.get('resource_scope'), dict) else {},
            resume_recent=False,
        )
        return JsonResponse({'ok': True, 'thread': _thread_json(thread)}, status=201)

    rows = PulsarThread.objects.filter(
        user=request.user,
        status=PulsarThread.Status.ACTIVE,
    ).order_by('-last_active_at')[:30]
    return JsonResponse({'ok': True, 'threads': [_thread_json(row) for row in rows]})


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def pulsar_thread_detail(request, thread_id):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    thread = PulsarThread.objects.filter(user=request.user, public_id=thread_id).first()
    if not thread:
        return JsonResponse({'ok': False, 'error': 'pulsar_thread_not_found'}, status=404)

    if request.method == 'DELETE':
        thread.status = PulsarThread.Status.CLOSED
        thread.save(update_fields=['status', 'last_active_at'])
        return JsonResponse({'ok': True})

    if request.method == 'PATCH':
        try:
            data = json.loads(request.body or '{}')
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = {}
        if 'title' in data:
            thread.title = str(data.get('title') or '').strip()[:240]
            thread.save(update_fields=['title', 'last_active_at'])

    return JsonResponse({'ok': True, 'thread': _thread_json(thread, include_turns=True)})


@require_http_methods(['GET', 'POST', 'DELETE'])
def pulsar_memories(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    if request.method == 'POST':
        try:
            data = json.loads(request.body or '{}')
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = {}
        kind = str(data.get('kind') or PulsarMemoryItem.Kind.SEMANTIC)
        if kind not in PulsarMemoryItem.Kind.values:
            return JsonResponse({'ok': False, 'error': 'invalid_memory_kind'}, status=400)
        content = str(data.get('content') or '').strip()
        if not content:
            return JsonResponse({'ok': False, 'error': 'memory_content_required'}, status=400)
        thread = None
        if data.get('thread_id'):
            try:
                thread = resolve_thread(
                    request.user,
                    thread_id=data.get('thread_id'),
                    surface='core',
                    resume_recent=False,
                )
            except PulsarPermissionError as exc:
                return JsonResponse({'ok': False, 'error': str(exc)}, status=403)
        item = remember(
            request.user,
            kind=kind,
            content=content,
            thread=thread,
            scope_type=str(data.get('scope_type') or 'global'),
            scope_key=str(data.get('scope_key') or ''),
            memory_key=str(data.get('memory_key') or ''),
            source_type='user',
            source_id=str(request.user.pk),
            confidence=1.0,
            metadata={'explicit': True},
        )
        return JsonResponse({'ok': True, 'memory_id': item.pk}, status=201)

    if request.method == 'DELETE':
        ids = request.GET.getlist('id')
        PulsarMemoryItem.objects.filter(user=request.user, pk__in=ids).update(active=False)
        return JsonResponse({'ok': True})

    rows = PulsarMemoryItem.objects.filter(user=request.user, active=True).order_by('-updated_at')[:100]
    return JsonResponse({
        'ok': True,
        'memories': [{
            'id': row.pk,
            'kind': row.kind,
            'scope_type': row.scope_type,
            'scope_key': row.scope_key,
            'memory_key': row.memory_key,
            'content': row.content,
            'confidence': row.confidence,
            'source_type': row.source_type,
            'source_id': row.source_id,
            'last_verified_at': row.last_verified_at.isoformat() if row.last_verified_at else None,
            'stale_after': row.stale_after.isoformat() if row.stale_after else None,
            'updated_at': row.updated_at.isoformat(),
        } for row in rows],
    })
