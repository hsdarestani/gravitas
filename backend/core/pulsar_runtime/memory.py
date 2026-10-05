import re
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .errors import PulsarPermissionError


def _models():
    from core.models import PulsarMemoryItem, PulsarRun, PulsarThread, PulsarTurn
    return PulsarMemoryItem, PulsarRun, PulsarThread, PulsarTurn


def _resume_window():
    return timedelta(hours=max(0, int(getattr(settings, 'PULSAR_THREAD_RESUME_HOURS', 6) or 6)))


def resolve_thread(
    user,
    *,
    thread_id=None,
    surface='unknown',
    resource_scope=None,
    resume_recent=True,
):
    if not user or not getattr(user, 'is_authenticated', False):
        raise PulsarPermissionError('pulsar_authentication_required')
    _, _, Thread, _ = _models()
    thread = None
    if thread_id:
        thread = Thread.objects.filter(
            user=user,
            public_id=thread_id,
            status=Thread.Status.ACTIVE,
        ).first()
        if not thread:
            raise PulsarPermissionError('pulsar_thread_not_found')
    elif resume_recent and _resume_window().total_seconds() > 0:
        threshold = timezone.now() - _resume_window()
        thread = Thread.objects.filter(
            user=user,
            status=Thread.Status.ACTIVE,
            last_active_at__gte=threshold,
        ).order_by('-last_active_at').first()

    if thread is None:
        thread = Thread.objects.create(
            user=user,
            primary_surface=str(surface or 'unknown')[:32],
            resource_scope=dict(resource_scope or {}),
        )
    else:
        changed = []
        if resource_scope and not thread.resource_scope:
            thread.resource_scope = dict(resource_scope)
            changed.append('resource_scope')
        thread.last_active_at = timezone.now()
        changed.append('last_active_at')
        thread.save(update_fields=changed)
    return thread


def telegram_thread(user, session):
    if getattr(session, 'pulsar_thread_id', None):
        thread = session.pulsar_thread
        if thread and thread.user_id == user.pk and thread.status == thread.Status.ACTIVE:
            return thread
    thread = resolve_thread(user, surface='telegram', resume_recent=True)
    session.pulsar_thread = thread
    session.save(update_fields=['pulsar_thread', 'updated_at'])
    return thread


def add_turn(thread, *, role, surface, content, skill='', run_id='', metadata=None):
    _, _, Thread, Turn = _models()
    if thread.status != Thread.Status.ACTIVE:
        raise PulsarPermissionError('pulsar_thread_closed')
    content = str(content or '').strip()
    if not content:
        return None
    row = Turn.objects.create(
        thread=thread,
        role=role,
        surface=str(surface or 'unknown')[:32],
        skill=str(skill or '')[:48],
        run_id=str(run_id or '')[:64],
        content=content[:24000],
        metadata=dict(metadata or {}),
    )
    thread.last_active_at = timezone.now()
    if not thread.title and role == Turn.Role.USER:
        thread.title = re.sub(r'\s+', ' ', content)[:120]
        thread.save(update_fields=['title', 'last_active_at'])
    else:
        thread.save(update_fields=['last_active_at'])
    return row


def recent_turns(thread, *, limit=12):
    _, _, _, Turn = _models()
    rows = list(
        Turn.objects.filter(thread=thread)
        .order_by('-created_at', '-id')[:max(1, min(30, int(limit or 12)))]
    )
    rows.reverse()
    return rows


def _terms(text):
    return {
        token.lower()
        for token in re.findall(r"[\w'-]{3,}", str(text or ''), flags=re.UNICODE)
        if token.lower() not in {'about', 'from', 'have', 'that', 'this', 'what', 'when', 'where', 'which', 'with', 'your'}
    }


def relevant_memories(user, query, *, scope_type=None, scope_key=None, limit=6):
    Memory, _, _, _ = _models()
    now = timezone.now()
    qs = Memory.objects.filter(user=user, active=True).exclude(
        stale_after__isnull=False,
        stale_after__lt=now,
    )
    if scope_type:
        qs = qs.filter(scope_type__in=['global', str(scope_type)])
    if scope_key:
        qs = qs.filter(scope_key__in=['', str(scope_key)])

    terms = _terms(query)
    ranked = []
    for memory in qs.order_by('-updated_at')[:200]:
        haystack = f'{memory.memory_key} {memory.content}'.lower()
        score = sum(2 if term in str(memory.memory_key).lower() else 1 for term in terms if term in haystack)
        if not terms:
            score = 1
        if score:
            recency = memory.updated_at.timestamp()
            ranked.append((score * max(0.05, float(memory.confidence or 0)), recency, memory))
    ranked.sort(key=lambda row: (-row[0], -row[1]))
    return [row[2] for row in ranked[:max(1, min(20, int(limit or 6)))]]


def continuity_context(thread, user, query='', *, scope_type=None, scope_key=None):
    turns = recent_turns(thread, limit=10)
    memories = relevant_memories(
        user,
        query,
        scope_type=scope_type,
        scope_key=scope_key,
        limit=6,
    )
    sections = []
    if turns:
        sections.append(
            'Recent Pulsar thread:\n' + '\n'.join(
                f'{turn.surface}/{turn.role}: {turn.content[:1800]}'
                for turn in turns
            )
        )
    if memories:
        sections.append(
            'Relevant long-term memory (not source of truth):\n' + '\n'.join(
                f'- [{memory.kind}] {memory.content[:1400]}'
                for memory in memories
            )
        )
    return '\n\n'.join(sections)


def remember(
    user,
    *,
    kind,
    content,
    thread=None,
    scope_type='global',
    scope_key='',
    memory_key='',
    source_type='',
    source_id='',
    confidence=1.0,
    metadata=None,
    stale_after=None,
):
    Memory, _, _, _ = _models()
    content = str(content or '').strip()
    if not content:
        return None
    confidence = max(0.0, min(1.0, float(confidence or 0)))
    defaults = {
        'thread': thread,
        'kind': kind,
        'scope_type': str(scope_type or 'global')[:32],
        'scope_key': str(scope_key or '')[:160],
        'content': content[:12000],
        'source_type': str(source_type or '')[:48],
        'source_id': str(source_id or '')[:160],
        'confidence': confidence,
        'metadata': dict(metadata or {}),
        'active': True,
        'last_verified_at': timezone.now(),
        'stale_after': stale_after,
    }
    key = str(memory_key or '')[:200]
    if key:
        row, _ = Memory.objects.update_or_create(
            user=user,
            memory_key=key,
            defaults=defaults,
        )
        return row
    return Memory.objects.create(user=user, memory_key='', **defaults)


def remember_exchange(user, thread, *, question, answer, surface, skill, run_id=''):
    summary = (
        f'On {surface}, the user asked: {str(question or "").strip()[:1200]} '
        f'Pulsar answered: {str(answer or "").strip()[:1800]}'
    )
    return remember(
        user,
        kind='episodic',
        content=summary,
        thread=thread,
        scope_type='thread',
        scope_key=str(thread.public_id),
        memory_key=f'exchange:{run_id}' if run_id else '',
        source_type='pulsar_run',
        source_id=run_id,
        confidence=0.8,
        metadata={'surface': surface, 'skill': skill},
        stale_after=timezone.now() + timedelta(days=90),
    )


def start_run(user, thread, *, run_id, surface, skill, state=None):
    _, Run, _, _ = _models()
    return Run.objects.update_or_create(
        run_id=str(run_id),
        defaults={
            'user': user,
            'thread': thread,
            'surface': str(surface or '')[:32],
            'skill': str(skill or '')[:48],
            'status': Run.Status.RUNNING,
            'state': dict(state or {}),
            'error_code': '',
        },
    )[0]


def finish_run(run_id, *, status='completed', result_summary='', state=None, error_code='', wake_at=None):
    _, Run, _, _ = _models()
    row = Run.objects.filter(run_id=str(run_id)).first()
    if not row:
        return None
    row.status = status
    row.result_summary = str(result_summary or '')[:12000]
    if state is not None:
        row.state = dict(state or {})
    row.error_code = str(error_code or '')[:120]
    row.wake_at = wake_at
    row.save(update_fields=['status', 'result_summary', 'state', 'error_code', 'wake_at', 'updated_at'])
    return row
