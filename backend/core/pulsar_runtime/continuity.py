from django.utils import timezone

from .memory import format_memory, recall


MAX_TURNS = 10
MAX_TURN_CHARS = 1800


def normalize_thread_key(value):
    key = str(value or 'primary').strip()
    return (key or 'primary')[:160]


def get_thread(user, thread_key='primary', *, surface='unknown', skill='general'):
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    from core.models import PulsarThread

    key = normalize_thread_key(thread_key)
    thread, _ = PulsarThread.objects.get_or_create(
        user=user,
        thread_key=key,
        defaults={
            'current_surface': str(surface or 'unknown')[:32],
            'current_skill': str(skill or 'general')[:40],
            'state': {'turns': []},
        },
    )
    changed = []
    if surface and thread.current_surface != str(surface)[:32]:
        thread.current_surface = str(surface)[:32]
        changed.append('current_surface')
    if skill and thread.current_skill != str(skill)[:40]:
        thread.current_skill = str(skill)[:40]
        changed.append('current_skill')
    if thread.status != PulsarThread.Status.ACTIVE:
        thread.status = PulsarThread.Status.ACTIVE
        changed.append('status')
    if changed:
        thread.save(update_fields=changed + ['updated_at'])
    return thread


def history_text(thread, *, max_turns=6):
    if thread is None:
        return ''
    state = thread.state if isinstance(thread.state, dict) else {}
    turns = state.get('turns') if isinstance(state.get('turns'), list) else []
    rows = []
    for turn in turns[-max_turns:]:
        if not isinstance(turn, dict):
            continue
        user_text = str(turn.get('user') or '').strip()
        assistant_text = str(turn.get('assistant') or '').strip()
        if user_text:
            rows.append('User: ' + user_text[:900])
        if assistant_text:
            rows.append('Pulsar: ' + assistant_text[:900])
    return '\n'.join(rows)


def begin_run(
    user,
    *,
    run_id,
    thread_key,
    surface,
    skill,
    input_text,
    metadata=None,
):
    if not user or not getattr(user, 'is_authenticated', False):
        return None, None, '', []
    from core.models import PulsarRun

    thread = get_thread(user, thread_key, surface=surface, skill=skill)
    run, _ = PulsarRun.objects.update_or_create(
        run_id=run_id,
        defaults={
            'thread': thread,
            'user': user,
            'surface': str(surface or 'unknown')[:32],
            'skill': str(skill or 'general')[:40],
            'status': PulsarRun.Status.RUNNING,
            'input_text': str(input_text or '')[:16000],
            'state': dict(metadata or {}),
            'error_code': '',
        },
    )
    metadata = dict(metadata or {})
    scope = {
        'skill': skill,
        'workspace_id': metadata.get('workspace_id') or '__none__',
        'project_id': metadata.get('project_id') or '__none__',
        'course_id': metadata.get('course_id') or '__none__',
        'lesson_id': metadata.get('lesson_id') or '__none__',
    }
    memories = recall(user, input_text, scope=scope, limit=6)
    return thread, run, history_text(thread), memories


def build_continuity_prefix(history, memories):
    blocks = []
    if history:
        blocks.append(
            'Conversation continuity from the same Pulsar thread. '
            'Use it only for continuity; it is not an authoritative source of truth:\n'
            + history
        )
    memory_text = format_memory(memories)
    if memory_text:
        blocks.append(
            'Relevant user memory. It may be stale and must never override live Gravitas data or ACLs:\n'
            + memory_text
        )
    return '\n\n'.join(blocks)


def complete_run(run, *, output_text, provider='', model='', metadata=None):
    if run is None:
        return
    run.output_text = str(output_text or '')[:20000]
    run.provider = str(provider or '')[:120]
    run.model_name = str(model or '')[:240]
    run.status = run.Status.COMPLETED
    state = dict(run.state or {})
    state.update(dict(metadata or {}))
    run.state = state
    run.save(update_fields=[
        'output_text', 'provider', 'model_name', 'status', 'state', 'updated_at',
    ])

    thread = run.thread
    thread_state = dict(thread.state or {})
    turns = thread_state.get('turns')
    turns = list(turns) if isinstance(turns, list) else []
    turns.append({
        'run_id': run.run_id,
        'surface': run.surface,
        'skill': run.skill,
        'user': run.input_text[:MAX_TURN_CHARS],
        'assistant': run.output_text[:MAX_TURN_CHARS],
        'at': timezone.now().isoformat(),
    })
    thread_state['turns'] = turns[-MAX_TURNS:]
    thread.state = thread_state
    thread.last_run_at = timezone.now()
    thread.status = thread.Status.ACTIVE
    thread.save(update_fields=['state', 'last_run_at', 'status', 'updated_at'])


def fail_run(run, exc):
    if run is None:
        return
    run.status = run.Status.FAILED
    run.error_code = str(getattr(exc, 'args', [''])[0] or exc.__class__.__name__)[:240]
    run.save(update_fields=['status', 'error_code', 'updated_at'])


def wait_run(run, *, wait_until=None, reason='user'):
    if run is None:
        return
    run.status = run.Status.WAITING_TIME if wait_until is not None else run.Status.WAITING_USER
    run.wait_until = wait_until
    state = dict(run.state or {})
    state['wait_reason'] = str(reason or '')[:160]
    run.state = state
    run.save(update_fields=['status', 'wait_until', 'state', 'updated_at'])
    thread = run.thread
    thread.status = thread.Status.WAITING
    thread.save(update_fields=['status', 'updated_at'])
