"""Execution observations in the existing audit stream, never a second task store.

Model saves record persisted field changes in the task transaction. Request
context identifies human edits; reconciliation explicitly marks its source so
background ingestion cannot reset the inactivity clock. An observation made
today is never backdated to an imported task's historical creation date.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date, datetime

from django.utils import timezone

_context = ContextVar('execution_actor', default=(None, 'system'))
TRACKED = ('title', 'description', 'status', 'owner_id', 'priority', 'due_date',
           'parent_id', 'dependency_id', 'milestone_id', 'blocked_reason',
           'created_at', 'started_at', 'completed_at', 'execution_weight')


@contextmanager
def execution_source(source, actor=None):
    token = _context.set((actor, source))
    try:
        yield
    finally:
        _context.reset(token)


class ExecutionActorMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = request.user
        actor = user.pk if user.is_authenticated else None
        # Sync has an authenticated initiator, but the field observations are
        # external facts rather than evidence that this initiator worked.
        source = 'nextcloud' if any(x in request.path for x in ('/deck/', '/sync/')) else 'human' if actor else 'system'
        with execution_source(source, actor):
            return self.get_response(request)


def scalar(value):
    return value.isoformat() if isinstance(value, (date, datetime)) else value


def record_task_save(task, previous, update_fields=None, using='default'):
    from .layer_models import ActivityEvent
    actor, source = _context.get()
    from .canonical_projects import _suppressed
    if _suppressed.get():
        actor, source = None, 'canonical_sync'
    changed = {key: {'from': scalar(previous[key]) if previous else None,
                     'to': scalar(getattr(task, key))}
               for key in TRACKED
               if previous is not None or getattr(task, key) is not None
               if (update_fields is None or key in update_fields or key.removesuffix('_id') in update_fields)
               and (previous is None or previous[key] != getattr(task, key))}
    if not changed:
        return
    ActivityEvent.objects.using(using).create(
        layer='core', action='task.lifecycle', actor_id=actor,
        subject_user_id=actor, object_type='operating_task', object_id=str(task.pk),
        detail={'workspace_id': task.workspace_id, 'source': source,
                'meaningful_human': source == 'human' and actor is not None,
                'initial_observation': previous is None, 'changes': changed,
                'observed_at': timezone.now().isoformat()},
    )
