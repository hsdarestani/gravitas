import hashlib
import json
import logging
import os
import re
import time
from functools import wraps
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Q
from django.http import FileResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from . import operating_api as base
from . import operating_api_v4 as v4
from .layer_access import record_activity
from .layer_models import ActivityEvent
from .task_consolidation import family_ids, canonical_id, source_rows
from .models import WorkspaceMembership
from .platform_models import WorkspaceProfile
from .platform_runtime_v3 import _canonical_workspace, core_access
from .task_notifications import enqueue_task_event, enqueue_task_mentions
from .workspace_api import _can_manage_workspace
from .operating_models import (
    Initiative,
    OperatingCycle,
    OperatingMeeting,
    OperatingMilestone,
    OperatingTask,
    OperatingTaskAttachment,
    OperatingTaskExternalLink,
    OperatingTaskChecklistItem,
    OperatingTaskComment,
    OperatingTaskConsolidation,
    OperatingWorkPackage,
    Priority,
    WorkStatus,
)


BOARD_STATUSES = (
    WorkStatus.DRAFT,
    WorkStatus.ACTIVE,
    WorkStatus.READY,
    WorkStatus.WAITING,
    WorkStatus.REVIEW,
    WorkStatus.RETEST,
    WorkStatus.BLOCKED,
    WorkStatus.DONE,
    WorkStatus.ARCHIVED,
)
SAFE_NAME = re.compile(r'[^A-Za-z0-9._ -]+')


def _safe_filename(value):
    name = Path(str(value or '')).name.strip() or 'file'
    return (SAFE_NAME.sub('_', name)[:255] or 'file')


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _readonly_task_workspace(request):
    """Mirror runtime Core workspace ACL without provisioning on GET.

    The runtime replaces base._workspace with an authenticated Core-only
    resolver. Preserve its canonical Core selection, module grant check and
    explicit workspace_id guard. Avoid ensure_platform_workspaces(), which
    provisions personal workspaces/plans and can contend with parallel readers.
    """
    core = _canonical_workspace(WorkspaceProfile.Purpose.CORE)
    if core is None or not core_access(request.user, core):
        return None
    raw_id = request.GET.get('workspace_id')
    if raw_id:
        try:
            if int(raw_id) != core.pk:
                return None
        except (TypeError, ValueError):
            return None
    return core

def _task_for(request, task_id, *, counts=True):
    workspace = _readonly_task_workspace(request) if request.method == 'GET' else base._workspace(request)
    if not workspace:
        return None, None
    task = (
        OperatingTask.objects
        .select_related(
            'workspace', 'owner', 'initiative__process', 'initiative__key_result__objective',
            'milestone', 'work_package', 'cycle', 'project', 'meeting', 'dependency',
        )
        .filter(pk=task_id, workspace=workspace)
        .first()
    )
    if task and counts:
        # Four reverse-relation JOINs previously multiplied comments, files
        # and checklist rows before DISTINCT aggregates. Indexed count queries
        # keep individual task reads and status PATCHes predictable.
        task.comment_count = task.board_comments.count()
        task.attachment_count = task.board_attachments.count()
        task.checklist_count = task.checklist_items.count()
        task.checklist_completed_count = task.checklist_items.filter(is_completed=True).count()
    return workspace, task

def _can_delete_task(request, workspace, task):
    """Only Core managers and the assigned task owner may delete this task.

    Task ownership is checked server-side against the authenticated actor;
    being able to edit other people's tasks never grants deletion rights.
    """
    if not request.user.is_authenticated:
        return False
    if getattr(request.user, 'is_superuser', False):
        return True
    if _can_manage_workspace(request.user, workspace):
        return True
    return task.owner_id == request.user.pk and base._editable(request, workspace)


def _person(user):
    return {
        'id': user.pk,
        'name': user.get_full_name() or user.email,
        'email': user.email,
    }


def _task_json(task):
    initiative = task.initiative if task.initiative_id else None
    kr = initiative.key_result if initiative else None
    objective = kr.objective if kr else None
    process = initiative.process if initiative else None
    trace = {
        'objective': {'id': objective.pk, 'title': objective.title} if objective else {'id': None, 'title': ''},
        'key_result': {'id': kr.pk, 'title': kr.title} if kr else {'id': None, 'title': ''},
        'initiative': {'id': initiative.pk, 'title': initiative.title} if initiative else {'id': None, 'title': ''},
        'process': {'id': process.pk, 'key': process.key, 'name': process.name} if process else {'id': None, 'key': '', 'name': ''},
    }
    return {
        'id': task.pk,
        'title': task.title,
        'description': task.description,
        'owner': _person(task.owner),
        'priority': task.priority,
        'status': task.status,
        'due_date': task.due_date.isoformat() if task.due_date else None,
        'definition_of_done': task.definition_of_done,
        'blocked_reason': task.blocked_reason,
        'board_order': task.board_order,
        'initiative_id': task.initiative_id,
        'initiative_title': task.initiative.title if task.initiative_id else '',
        'milestone_id': task.milestone_id,
        'milestone_title': task.milestone.title if task.milestone else '',
        'work_package_id': task.work_package_id,
        'work_package_title': task.work_package.title if task.work_package else '',
        'cycle_id': task.cycle_id,
        'cycle_title': task.cycle.name if task.cycle else '',
        'project_id': task.project_id,
        'project_title': task.project.title if task.project else '',
        'dependency_id': task.dependency_id,
        'parent_id': task.parent_id,
        'source_metadata': task.source_metadata,
        'dependency_title': task.dependency.title if task.dependency else '',
        'comment_count': getattr(task, 'comment_count', 0),
        'attachment_count': getattr(task, 'attachment_count', 0),
        'checklist_count': getattr(task, 'checklist_count', 0),
        'checklist_completed_count': getattr(task, 'checklist_completed_count', 0),
        'completed_at': task.completed_at.isoformat() if task.completed_at else None,
        'created_at': task.created_at.isoformat(),
        'updated_at': task.updated_at.isoformat(),
        'trace': trace,
    }


def _log(request, task, action, detail=None):
    event_detail = {'title': task.title, **(detail or {})}
    record_activity(
        layer=ActivityEvent.Layer.CORE,
        action=action,
        actor=request.user,
        subject_user=request.user,
        object_type='operating_task',
        object_id=task.pk,
        detail=event_detail,
    )
    try:
        enqueue_task_event(task, action, actor=request.user, detail=event_detail)
    except Exception:
        import logging
        logging.getLogger(__name__).exception(
            'Could not enqueue task notification task_id=%s action=%s',
            task.pk,
            action,
        )


def _members(workspace):
    rows = (
        WorkspaceMembership.objects.filter(workspace=workspace)
        .select_related('user')
        .order_by('user__first_name', 'user__email')
    )
    return [
        {**_person(row.user), 'role': row.role}
        for row in rows
    ]


def _choices(request, workspace, *, include_legacy=True):
    key_results = (
        base.KeyResult.objects.filter(objective__workspace=workspace)
        .exclude(status=WorkStatus.ARCHIVED)
        .select_related('objective', 'owner')
        .order_by('objective__due_date', 'objective__title', 'due_date', 'title')
    )
    initiatives = (
        Initiative.objects.filter(workspace=workspace)
        .exclude(status=WorkStatus.ARCHIVED)
        .select_related('key_result__objective', 'process')
        .order_by('priority', 'due_date', 'title')
    ) if include_legacy else []
    milestones = (
        OperatingMilestone.objects.filter(workspace=workspace)
        .exclude(status=WorkStatus.ARCHIVED)
        .select_related('initiative__key_result__objective')
        .order_by('due_date', 'title')
    )
    packages = (
        OperatingWorkPackage.objects.filter(workspace=workspace)
        .exclude(status=WorkStatus.ARCHIVED)
        .order_by('due_date', 'title')
    )
    cycles = (
        OperatingCycle.objects.filter(workspace=workspace)
        .exclude(status=WorkStatus.ARCHIVED)
        .order_by('end_date', 'name')
    ) if include_legacy else []
    projects = v4._research_projects_for_core(request, workspace).order_by('title', 'id')
    return {
        'members': _members(workspace),
        'key_results': [{
            'id': row.pk,
            'title': row.title,
            'objective_id': row.objective_id,
            'objective_title': row.objective.title,
            'owner': _person(row.owner),
            'progress': base._kr_progress(row),
            'health': row.health,
            'status': row.status,
            'due_date': row.due_date.isoformat() if row.due_date else None,
        } for row in key_results],
        # Kept for older clients only; the current product UI no longer exposes
        # initiatives or cycles.
        'initiatives': [{
            'id': row.pk,
            'title': row.title,
            'objective': row.key_result.objective.title,
            'key_result': row.key_result.title,
            'process': row.process.name,
        } for row in initiatives],
        'milestones': [{
            'id': row.pk,
            'title': row.title,
            'key_result_id': row.initiative.key_result_id,
            'key_result_title': row.initiative.key_result.title,
            'objective_id': row.initiative.key_result.objective_id,
            'objective_title': row.initiative.key_result.objective.title,
        } for row in milestones],
        'work_packages': [{
            'id': row.pk,
            'title': row.title,
            'key_result_id': row.milestone.initiative.key_result_id,
            'milestone_id': row.milestone_id,
        } for row in packages.select_related('milestone__initiative__key_result')],
        'cycles': [{'id': row.pk, 'title': row.name} for row in cycles],
        'projects': [{'id': row.pk, 'title': row.title} for row in projects],
    }



def _validated_create_key(value):
    """Canonical UUID; malformed tokens cannot be used to locate old tasks."""
    try:
        return str(uuid.UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        return None


def _create_board_task(request, workspace):
    """Serialize duplicate subtask submissions on the parent DB row.

    A browser may time out while the server finishes the POST. Retry the same
    client_create_id safely: under the parent row lock the first creator wins,
    subsequent requests return its saved task and never trigger notifications
    or a second child. No source_key (import provenance) is repurposed.
    """
    try:
        body = json.loads(request.body.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return _error('invalid_json')
    if not isinstance(body, dict):
        return _error('invalid_json')

    raw_key = body.get('client_create_id')
    request_id = _validated_create_key(raw_key) if raw_key else None
    if raw_key and not request_id:
        return _error('invalid_creation_request_id')
    parent_id = body.get('parent_id')
    idempotent = bool(request_id and str(parent_id or '').isdecimal())
    content = {key: value for key, value in body.items() if key != 'client_create_id'}
    fingerprint = hashlib.sha256(
        json.dumps(content, sort_keys=True, default=str).encode('utf-8')
    ).hexdigest()

    def do_create():
        from .canonical_models import CanonicalProject, CanonicalTaskSyncOutbox
        from .canonical_projects import suppress as suppress_canonical_signals

        # A linked subtask inherits its parent's project. Canonical projects
        # reject ordinary OperatingTask.save() in pre_save (no write journal).
        # Accept the DB projection under signal suppression, then persist an
        # outbox job in this SAME transaction. Native DAV/ACL traffic belongs
        # exclusively to the existing background canonical task sync worker.
        parent_project_id = (
            OperatingTask.objects.filter(pk=parent_id, workspace=workspace)
            .values_list('project_id', flat=True).first()
            if str(parent_id or '').isdecimal() else None
        )
        canonical_parent = bool(
            parent_project_id and CanonicalProject.objects.filter(
                project_id=parent_project_id, enabled=True).exists()
        )
        if canonical_parent:
            with suppress_canonical_signals():
                response = v4.tasks(request)
        else:
            response = v4.tasks(request)
        if response.status_code != 201:
            return response
        data = json.loads(response.content.decode('utf-8'))
        task_id = (data.get('task') or {}).get('id')
        task = OperatingTask.objects.filter(pk=task_id, workspace=workspace).first()
        if task:
            if task.project_id and (
                canonical_parent or CanonicalProject.objects.filter(
                    project_id=task.project_id, enabled=True).exists()
            ):
                # A native failure must not hold the POST open or invalidate
                # a successful local commit. The durable job is generation 1.
                CanonicalTaskSyncOutbox.objects.update_or_create(
                    project_id=task.project_id, task_id=task.pk,
                    defaults={
                        'generation': 1, 'attempts': 0,
                        'next_attempt_at': timezone.now(),
                        'state': 'pending', 'last_error': '',
                    },
                )
            if idempotent:
                metadata = dict(task.source_metadata or {})
                metadata.update({
                    'client_create_id': request_id,
                    'client_create_actor': request.user.pk,
                    'client_create_fingerprint': fingerprint,
                })
                OperatingTask.objects.filter(pk=task.pk).update(source_metadata=metadata)
            lane_max = (
                OperatingTask.objects.filter(workspace=workspace, status=task.status)
                .exclude(pk=task.pk)
                .order_by('-board_order')
                .values_list('board_order', flat=True)
                .first()
            ) or 0
            # The task was already validated on INSERT. Updating board_order
            # through save() needlessly walks its whole parent hierarchy again.
            OperatingTask.objects.filter(pk=task.pk).update(
                board_order=lane_max + 100, updated_at=timezone.now())
            _log(request, task, 'task.created', {'status': task.status})
        return response

    if not idempotent:
        # The child and its native-sync outbox entry must commit together,
        # including for older clients without an idempotency UUID.
        with transaction.atomic():
            return do_create()

    # The lock is transaction-scoped. Concurrent retries cannot both create
    # children and it works across gunicorn workers / container restarts.
    with transaction.atomic():
        parent = (OperatingTask.objects.select_for_update()
                  .filter(pk=int(parent_id), workspace=workspace).first())
        if parent is None:
            return _error('parent_not_found', 404)
        prior = (
            OperatingTask.objects.filter(
                workspace=workspace, parent_id=parent.pk,
                source_metadata__client_create_id=request_id,
                source_metadata__client_create_actor=request.user.pk,
            ).select_related(
                'owner', 'initiative__process', 'initiative__key_result__objective',
                'milestone', 'work_package', 'cycle', 'project', 'meeting', 'dependency',
            ).first()
        )
        if prior:
            if (prior.source_metadata or {}).get('client_create_fingerprint') != fingerprint:
                return _error('creation_request_payload_mismatch', 409)
            return JsonResponse({'ok': True, 'task': _task_json(prior),
                                 'replayed': True}, status=200)
        return do_create()


@require_http_methods(['GET', 'POST'])
def task_board(request):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    workspace = _readonly_task_workspace(request) if request.method == 'GET' else base._workspace(request)
    if not workspace:
        return _error('core_workspace_required', 403)

    if request.method == 'POST':
        if not base._editable(request, workspace):
            return _error('permission_denied', 403)
        started = time.perf_counter()
        response = _create_board_task(request, workspace)
        elapsed = round((time.perf_counter() - started) * 1000)
        response['Server-Timing'] = f'task_create;dur={elapsed}'
        if elapsed >= 750:
            logging.getLogger(__name__).warning(
                'Slow task create duration_ms=%s', elapsed,
            )
        return response

    # Resolve uncertain POST confirmations without loading the entire board.
    # Only the original authenticated creator can look up their request key.
    if request.GET.get('mode') == 'create-status':
        request_id = _validated_create_key(request.GET.get('client_request_id'))
        parent_id = request.GET.get('parent_id')
        if not request_id or not str(parent_id or '').isdecimal():
            return _error('invalid_creation_lookup')
        task = (
            OperatingTask.objects.filter(
                workspace=workspace, parent_id=parent_id,
                source_metadata__client_create_id=request_id,
                source_metadata__client_create_actor=request.user.pk,
            ).select_related(
                'owner', 'initiative__process', 'initiative__key_result__objective',
                'milestone', 'work_package', 'cycle', 'project', 'meeting', 'dependency',
            ).first()
        )
        return JsonResponse({'ok': True, 'created': bool(task),
                             'task': _task_json(task) if task else None})

    # A task opened from Projects, a notification, or the dock only needs
    # dependency names; loading the entire rich board delayed every popup.
    if request.GET.get('mode') == 'dependencies':
        return JsonResponse({
            'ok': True,
            'tasks': list(OperatingTask.objects.filter(workspace=workspace).exclude(pk__in=OperatingTaskConsolidation.objects.values('source_id'))
                          .order_by('title', 'pk').values('id', 'title')),
        })

    tasks = list(
        OperatingTask.objects.filter(workspace=workspace).exclude(pk__in=OperatingTaskConsolidation.objects.values('source_id'))
        .select_related(
            'owner', 'initiative__process', 'initiative__key_result__objective',
            'milestone', 'work_package', 'cycle', 'project', 'meeting', 'dependency',
        )
        .order_by('status', 'board_order', 'priority', 'due_date', 'id')
    )
    # Four DISTINCT counts across three joined collections multiply each
    # task's rows (comments × attachments × checklist items). Aggregate each
    # collection independently, then attach counts to the already loaded tasks.
    # This is constant-query work even as projects and task sources grow.
    if tasks:
        ids = [task.pk for task in tasks]
        comments = dict(
            OperatingTaskComment.objects.filter(task_id__in=ids).values('task_id')
            .annotate(total=Count('pk')).values_list('task_id', 'total')
        )
        attachments = dict(
            OperatingTaskAttachment.objects.filter(task_id__in=ids).values('task_id')
            .annotate(total=Count('pk')).values_list('task_id', 'total')
        )
        checklists = {
            row['task_id']: row
            for row in OperatingTaskChecklistItem.objects.filter(task_id__in=ids)
            .values('task_id')
            .annotate(
                total=Count('pk'),
                completed=Count('pk', filter=Q(is_completed=True)),
            )
        }
        for task in tasks:
            task.comment_count = comments.get(task.pk, 0)
            task.attachment_count = attachments.get(task.pk, 0)
            checklist = checklists.get(task.pk, {})
            task.checklist_count = checklist.get('total', 0)
            task.checklist_completed_count = checklist.get('completed', 0)

    return JsonResponse({
        'ok': True,
        'can_edit': base._editable(request, workspace),
        'can_delete': _can_manage_workspace(request.user, workspace),
        'statuses': [{'value': value, 'label': label} for value, label in WorkStatus.choices],
        'priorities': [{'value': value, 'label': label} for value, label in Priority.choices],
        'tasks': [_task_json(task) for task in tasks],
        **_choices(request, workspace),
    })


def _task_hierarchy(request, workspace, task, *, include_candidates=True):
    """Bounded, same-project task lineage and children. No full-board load."""
    from .platform_access import can_view
    ancestors = []
    seen = {task.pk}
    cursor_id = task.parent_id
    for _ in range(16):
        if not cursor_id or cursor_id in seen:
            break
        seen.add(cursor_id)
        parent = (OperatingTask.objects.filter(pk=cursor_id, workspace=workspace,
                                               project_id=task.project_id)
                  .only('id', 'title', 'parent_id', 'status').first())
        if not parent or not can_view(request.user, parent):
            break
        ancestors.append({'id': parent.pk, 'title': parent.title, 'status': parent.status})
        cursor_id = parent.parent_id
    ancestors.reverse()

    children = (OperatingTask.objects.filter(parent_id=task.pk, workspace=workspace)
                .exclude(pk__in=OperatingTaskConsolidation.objects.values('source_id'))
                .order_by('board_order', 'id')
                .only('id', 'title', 'status', 'definition_of_done', 'due_date')[:101])
    visible_children = [child for child in children if can_view(request.user, child)][:100]
    if not include_candidates:
        return {
            'ancestors': ancestors,
            'children': [
                {'id': row.pk, 'title': row.title, 'status': row.status,
                 'due_date': row.due_date.isoformat() if row.due_date else None,
                 'definition_of_done': row.definition_of_done}
                for row in visible_children
            ],
            'children_truncated': len(visible_children) >= 100,
            'parent_candidates': [],
        }

    # Parent options are bounded to the task's own project; other projects
    # must never appear as selectable parents.
    current_kr = task.initiative.key_result_id if task.initiative_id else None
    candidates = list(
        OperatingTask.objects.filter(
            workspace=workspace, project_id=task.project_id,
            initiative__key_result_id=current_kr,
        )
        .exclude(pk=task.pk)
        .exclude(pk__in=OperatingTaskConsolidation.objects.values('source_id'))
        .select_related('workspace', 'project', 'owner')
        .order_by('title', 'id')[:80]
    )
    if task.parent_id and all(row.pk != task.parent_id for row in candidates):
        original = OperatingTask.objects.filter(
            pk=task.parent_id, workspace=workspace).select_related(
                'workspace', 'project', 'owner').first()
        if original:
            candidates.append(original)
    return {
        'ancestors': ancestors,
        'children': [
            {'id': row.pk, 'title': row.title, 'status': row.status,
             'due_date': row.due_date.isoformat() if row.due_date else None,
             'definition_of_done': row.definition_of_done}
            for row in visible_children
        ],
        'children_truncated': len(visible_children) >= 100,
        'parent_candidates': [
            {'id': row.pk, 'title': row.title} for row in candidates
            if can_view(request.user, row)
        ],
    }


def _measure_task_write(view):
    """Expose actual server write latency independent of optimistic UI paint."""
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if request.method not in ('PATCH', 'DELETE'):
            return view(request, *args, **kwargs)
        start = time.perf_counter()
        try:
            response = view(request, *args, **kwargs)
        finally:
            elapsed = round((time.perf_counter() - start) * 1000)
            if elapsed >= 750:
                logging.getLogger(__name__).warning(
                    'Slow task write method=%s duration_ms=%s', request.method, elapsed,
                )
        response['Server-Timing'] = f'task_write;dur={elapsed}'
        return response
    return wrapped


@_measure_task_write
@require_http_methods(['GET', 'PATCH', 'DELETE'])
def task_board_detail(request, task_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    quick_preview = request.method == 'GET' and request.GET.get('mode') == 'preview'
    # Only GET needs expensive reverse relation counts. Writes operate on
    # the single task row and must never fetch all checklist/file counts.
    workspace, task = _task_for(request, task_id, counts=request.method == 'GET' and not quick_preview)
    if not workspace:
        return _error('core_workspace_required', 403)
    if not task:
        return _error('task_not_found', 404)

    if request.method in ('PATCH', 'DELETE') and canonical_id(task.pk) != task.pk:
        return _error('task_consolidated_read_only', 409, canonical_task_id=canonical_id(task.pk))

    if quick_preview:
        # A single round trip gives the mobile reader the status AND Pulsar
        # evidence, without forcing a second slow request for /history/.
        # Both use the same task ACL and the existing owner/admin evidence rule.
        return JsonResponse({
            'ok': True,
            'task': {
                'id': task.pk,
                'title': task.title,
                'description': task.description,
                'status': task.status,
                'owner': _person(task.owner),
                'definition_of_done': task.definition_of_done,
                'parent_id': task.parent_id,
                'key_result': {
                    'id': task.initiative.key_result_id,
                    'title': task.initiative.key_result.title,
                } if task.initiative_id else None,
                'objective': {
                    'id': task.initiative.key_result.objective_id,
                    'title': task.initiative.key_result.objective.title,
                } if task.initiative_id else None,
            },
            'hierarchy': _task_hierarchy(request, workspace, task, include_candidates=False),
            'events': _task_activity_events(request, workspace, task, limit=30),
        })

    if request.method == 'GET':
        task_data = _task_json(task)
        # Status of the last local commit, not a claim that native sync finished.
        from .canonical_models import CanonicalTaskSyncOutbox
        task_data['canonical_sync'] = (
            CanonicalTaskSyncOutbox.objects.filter(
                project_id=task.project_id, task_id=task.pk,
            ).values_list('state', flat=True).first() if task.project_id else None
        )
        task_data['consolidated_into_id'] = (
            canonical_id(task.pk) if canonical_id(task.pk) != task.pk else None)
        task_data['consolidated_sources'] = [
            {'id': row.source_id, 'title': row.source.title, 'reason': row.reason}
            for row in source_rows(task.pk)
        ]
        return JsonResponse({
            'ok': True,
            'task': task_data,
            'hierarchy': _task_hierarchy(request, workspace, task),
            'can_delete': _can_delete_task(request, workspace, task),
            'can_edit': base._editable(request, workspace),
            # The task detail dialog also opens directly from Research, where no
            # full Core board was loaded to provide these select options.
            'statuses': [{'value': value, 'label': label} for value, label in WorkStatus.choices],
            'priorities': [{'value': value, 'label': label} for value, label in Priority.choices],
            **_choices(request, workspace, include_legacy=False),
        })

    if request.method == 'DELETE':
        if not _can_delete_task(request, workspace, task):
            return _error('permission_denied', 403)
        title = task.title
        from .operating_models import GoogleTaskDeleteOutbox
        # Never make Google OAuth/HTTP calls during the user's DELETE. Those
        # previously consumed 20+ seconds per external link on a slow API.
        # Persist unlink jobs in the same transaction as the local deletion:
        # a failed DB delete rolls back both and the task remains intact.
        with transaction.atomic():
            google_links = list(task.google_task_links.values(
                'user_id', 'tasklist_id', 'google_task_id'))
            for link in google_links:
                GoogleTaskDeleteOutbox.objects.get_or_create(
                    user_id=link['user_id'],
                    tasklist_id=link['tasklist_id'],
                    google_task_id=link['google_task_id'],
                    defaults={'task_id_at_deletion': task.pk},
                )
            _log(request, task, 'task.deleted', {'title': title})
            task.delete()
        return JsonResponse({'ok': True, 'google_cleanup_queued': bool(google_links)})

    if not base._editable(request, workspace):
        return _error('permission_denied', 403)

    payload = base._body(request)
    before = _task_json(task)

    if 'parent_id' in payload:
        from .platform_access import can_view
        if payload['parent_id'] and not str(payload['parent_id']).isdecimal():
            return _error('invalid_parent')
        parent = OperatingTask.objects.filter(pk=payload['parent_id'], workspace=workspace).first() if payload['parent_id'] else None
        if payload['parent_id'] and (parent is None or not can_view(request.user, parent)):
            return _error('invalid_parent')
        if parent and parent.pk == task.pk:
            return _error('invalid_parent_self', 409)
        if parent and canonical_id(parent.pk) != parent.pk:
            return _error('parent_is_consolidated_alias', 409, canonical_task_id=canonical_id(parent.pk))
        task.parent = parent

    for field in ['title', 'description', 'priority', 'status', 'definition_of_done', 'blocked_reason']:
        if field in payload:
            setattr(task, field, payload[field])

    if task.priority not in Priority.values:
        return _error('invalid_priority')
    if task.status not in WorkStatus.values:
        return _error('invalid_status')

    if 'owner_id' in payload:
        owner = base._owner(request.user, workspace, payload.get('owner_id'))
        if not owner:
            return _error('invalid_owner')
        task.owner = owner

    if 'due_date' in payload:
        task.due_date = base._date(payload.get('due_date'))

    # New product contract: tasks are planned against a KR, not an Initiative
    # or Cycle. Legacy relation IDs are still accepted to avoid breaking older
    # API clients and historical records.
    if 'key_result_id' in payload:
        if payload.get('key_result_id') in (None, '', 0, '0'):
            # An explicit unlink leaves the task itself untouched, removing
            # only incompatible hierarchy links. Never create a fake KR.
            task.initiative = None
            task.milestone = None
            task.work_package = None
        else:
            key_result = base.KeyResult.objects.select_related('objective', 'owner').filter(
                pk=payload.get('key_result_id'), objective__workspace=workspace
            ).first()
            if not key_result:
                return _error('key_result_not_found')
            task.initiative = base._execution_initiative_for_kr(workspace, key_result, task.owner)
            task.cycle = None

    if 'initiative_id' in payload:
        initiative = Initiative.objects.filter(pk=payload.get('initiative_id'), workspace=workspace).first()
        if not initiative:
            return _error('initiative_not_found')
        task.initiative = initiative

    if 'milestone_id' in payload:
        milestone = (
            OperatingMilestone.objects.select_related('initiative__key_result').filter(
                pk=payload.get('milestone_id'), workspace=workspace,
            ).first() if payload.get('milestone_id') else None
        )
        if payload.get('milestone_id') and not milestone:
            return _error('invalid_milestone')
        if milestone and task.initiative_id and milestone.initiative.key_result_id != task.initiative.key_result_id:
            return _error('milestone_key_result_mismatch')
        task.milestone = milestone
        if milestone:
            task.initiative = milestone.initiative

    if 'work_package_id' in payload:
        task.work_package = (
            OperatingWorkPackage.objects.select_related('milestone__initiative__key_result').filter(
                pk=payload.get('work_package_id'), workspace=workspace,
            ).first() if payload.get('work_package_id') else None
        )
        if payload.get('work_package_id') and not task.work_package:
            return _error('invalid_work_package')
        if task.work_package and task.initiative_id and task.work_package.milestone.initiative.key_result_id != task.initiative.key_result_id:
            return _error('work_package_key_result_mismatch')
        if task.work_package and not task.milestone:
            task.milestone = task.work_package.milestone
            task.initiative = task.milestone.initiative

    if 'cycle_id' in payload:
        task.cycle = (
            OperatingCycle.objects.filter(pk=payload.get('cycle_id'), workspace=workspace).first()
            if payload.get('cycle_id') else None
        )
        if payload.get('cycle_id') and not task.cycle:
            return _error('invalid_cycle')

    if 'project_id' in payload:
        task.project = v4._research_project_for_core(request, workspace, payload.get('project_id'))
        if payload.get('project_id') and not task.project:
            return _error('project_not_found', 404)

    if 'meeting_id' in payload:
        task.meeting = (
            OperatingMeeting.objects.filter(pk=payload.get('meeting_id'), workspace=workspace).first()
            if payload.get('meeting_id') else None
        )
        if payload.get('meeting_id') and not task.meeting:
            return _error('invalid_meeting')

    if 'dependency_id' in payload:
        task.dependency = (
            OperatingTask.objects.filter(pk=payload.get('dependency_id'), workspace=workspace)
            .exclude(pk=task.pk)
            .first() if payload.get('dependency_id') else None
        )
        if payload.get('dependency_id') and not task.dependency:
            return _error('invalid_dependency')

    # A subtask belongs to its parent's project and planning KR. Reject
    # mismatches as user-facing 409s, not uncaught model ValidationError/500.
    if task.parent_id:
        parent = OperatingTask.objects.select_related('initiative__key_result').filter(
            pk=task.parent_id, workspace=workspace).first()
        if not parent:
            return _error('parent_not_found', 404)
        own_kr = task.initiative.key_result_id if task.initiative_id else None
        parent_kr = parent.initiative.key_result_id if parent.initiative_id else None
        if task.project_id != parent.project_id:
            return _error('parent_context_mismatch', 409)
        # Historical imported subtasks may already reference a different KR
        # from their parent. An unrelated edit (status, owner, title, etc.)
        # must not be rejected because of that *pre-existing* discrepancy.
        # Still reject any mutation that changes the task's structural
        # context while leaving a parent/KR mismatch in place.
        hierarchy_changed = any((
            task.parent_id != before['parent_id'],
            task.project_id != before['project_id'],
            task.initiative_id != before['initiative_id'],
            task.milestone_id != before['milestone_id'],
            task.work_package_id != before['work_package_id'],
        ))
        if own_kr != parent_kr and hierarchy_changed:
            return _error('parent_context_mismatch', 409)

    if task.initiative_id and not task.cycle and not task.due_date and not task.source_key:
        return _error('task_requires_due_date')
    if task.meeting and not task.due_date:
        return _error('meeting_action_requires_deadline')
    if not str(task.title or '').strip() or not str(task.definition_of_done or '').strip():
        return _error('title_and_done_definition_required')

    if task.status == WorkStatus.DONE and not task.completed_at and (
        not task.source_key or (payload.get('status') == WorkStatus.DONE and before['status'] != WorkStatus.DONE)
    ):
        task.completed_at = timezone.now()
    elif task.status != WorkStatus.DONE:
        task.completed_at = None

    try:
        task.clean()
    except ValidationError:
        return _error('invalid_task_hierarchy', 409)
    try:
        task.save()
    except ValidationError:
        return _error('invalid_task_hierarchy', 409)
    # The just-saved model contains the authoritative fields. Requerying the
    # entire task and four reverse counts adds SQL with no correctness benefit.
    # Select relations already loaded remain valid for serialized changes.
    after = _task_json(task)
    changed = {
        key: {'from': before.get(key), 'to': after.get(key)}
        for key in [
            'title', 'description', 'owner', 'priority', 'status', 'due_date',
            'definition_of_done', 'blocked_reason',
            'milestone_id', 'work_package_id', 'project_id',
            'dependency_id', 'parent_id',
        ]
        if before.get(key) != after.get(key)
    }
    _log(request, task, 'task.updated', {'changes': changed})
    return JsonResponse({'ok': True, 'task': after})


@require_http_methods(['POST'])
def task_board_move(request):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    payload = base._body(request)
    workspace = base._workspace(request, payload)
    if not workspace:
        return _error('core_workspace_required', 403)
    if not base._editable(request, workspace):
        return _error('permission_denied', 403)

    try:
        task_id = int(payload.get('task_id'))
    except (TypeError, ValueError):
        return _error('task_id_required')
    status = str(payload.get('status') or '')
    if status not in BOARD_STATUSES:
        return _error('invalid_status')

    task = OperatingTask.objects.filter(pk=task_id, workspace=workspace).first()
    if not task:
        return _error('task_not_found', 404)

    raw_order = payload.get('ordered_ids') or []
    try:
        ordered_ids = [int(value) for value in raw_order]
    except (TypeError, ValueError):
        return _error('invalid_task_order')
    if task_id not in ordered_ids:
        ordered_ids.append(task_id)

    lane_ids = set(
        OperatingTask.objects.filter(workspace=workspace, status=status)
        .exclude(pk=task.pk)
        .values_list('pk', flat=True)
    )
    lane_ids.add(task.pk)
    if not set(ordered_ids).issubset(lane_ids):
        return _error('invalid_lane_order', 409)

    previous_status = task.status
    with transaction.atomic():
        task.status = status
        if status == WorkStatus.DONE and not task.completed_at:
            task.completed_at = timezone.now()
        elif status != WorkStatus.DONE:
            task.completed_at = None
        task.save(update_fields=['status', 'completed_at', 'updated_at'])
        for index, row_id in enumerate(ordered_ids, start=1):
            OperatingTask.objects.filter(pk=row_id, workspace=workspace, status=status).update(board_order=index * 100)

    _log(request, task, 'task.moved', {'from_status': previous_status, 'to_status': status})
    return JsonResponse({'ok': True, 'task_id': task.pk, 'status': status, 'ordered_ids': ordered_ids})


def _checklist_item_json(row):
    return {
        'id': row.pk,
        'origin_task_id': row.task_id,
        'title': row.title,
        'is_completed': row.is_completed,
        'position': row.position,
        'created_by': _person(row.created_by),
        'completed_at': row.completed_at.isoformat() if row.completed_at else None,
        'created_at': row.created_at.isoformat(),
        'updated_at': row.updated_at.isoformat(),
    }


@require_http_methods(['GET', 'POST'])
def task_checklist(request, task_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    workspace, task = _task_for(request, task_id)
    if not workspace:
        return _error('core_workspace_required', 403)
    if not task:
        return _error('task_not_found', 404)

    if request.method == 'GET':
        rows = OperatingTaskChecklistItem.objects.filter(task_id__in=family_ids(task.pk)).select_related('created_by').order_by('position','id')[:500]
        return JsonResponse({
            'ok': True,
            'items': [_checklist_item_json(row) for row in rows],
        })

    if not base._editable(request, workspace):
        return _error('permission_denied', 403)
    payload = base._body(request)
    title = str(payload.get('title') or '').strip()
    if not title or len(title) > 500:
        return _error('invalid_checklist_title')

    last_position = (
        task.checklist_items.order_by('-position', '-id')
        .values_list('position', flat=True)
        .first()
    ) or 0
    row = OperatingTaskChecklistItem.objects.create(
        task=task,
        title=title,
        position=last_position + 100,
        created_by=request.user,
    )
    _log(request, task, 'task.checklist_item_added', {
        'checklist_item_id': row.pk,
        'checklist_item_title': row.title,
    })
    return JsonResponse({'ok': True, 'item': _checklist_item_json(row)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def task_checklist_item(request, task_id, item_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    workspace, task = _task_for(request, task_id)
    if not workspace:
        return _error('core_workspace_required', 403)
    if not task:
        return _error('task_not_found', 404)
    if not base._editable(request, workspace):
        return _error('permission_denied', 403)

    row = (
        OperatingTaskChecklistItem.objects
        .select_related('created_by')
        .filter(pk=item_id, task=task)
        .first()
    )
    if not row:
        return _error('checklist_item_not_found', 404)

    if request.method == 'DELETE':
        item_title = row.title
        item_id_value = row.pk
        row.delete()
        _log(request, task, 'task.checklist_item_deleted', {
            'checklist_item_id': item_id_value,
            'checklist_item_title': item_title,
        })
        return JsonResponse({'ok': True})

    payload = base._body(request)
    update_fields = ['updated_at']
    changed = {}

    if 'title' in payload:
        title = str(payload.get('title') or '').strip()
        if not title or len(title) > 500:
            return _error('invalid_checklist_title')
        if title != row.title:
            changed['title'] = {'from': row.title, 'to': title}
            row.title = title
            update_fields.append('title')

    if 'is_completed' in payload:
        is_completed = payload.get('is_completed')
        if not isinstance(is_completed, bool):
            return _error('invalid_checklist_state')
        if is_completed != row.is_completed:
            changed['is_completed'] = {'from': row.is_completed, 'to': is_completed}
            row.is_completed = is_completed
            row.completed_at = timezone.now() if is_completed else None
            update_fields.extend(['is_completed', 'completed_at'])

    if len(update_fields) > 1:
        row.save(update_fields=list(dict.fromkeys(update_fields)))
        action = (
            'task.checklist_item_completed'
            if changed.get('is_completed', {}).get('to') is True
            else 'task.checklist_item_reopened'
            if changed.get('is_completed', {}).get('to') is False
            else 'task.checklist_item_updated'
        )
        _log(request, task, action, {
            'checklist_item_id': row.pk,
            'changes': changed,
        })

    return JsonResponse({'ok': True, 'item': _checklist_item_json(row)})


def _comment_json(row):
    mentions = list(row.mentions.all()) if hasattr(row, 'mentions') else []
    return {
        'id': row.pk,
        'origin_task_id': row.task_id,
        'author': _person(row.author),
        'body': row.body,
        'mentions': [_person(user) for user in mentions],
        'created_at': row.created_at.isoformat(),
        'updated_at': row.updated_at.isoformat(),
    }


@require_http_methods(['GET', 'POST'])
def task_comments(request, task_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    workspace, task = _task_for(request, task_id, counts=False)
    if not workspace:
        return _error('core_workspace_required', 403)
    if not task:
        return _error('task_not_found', 404)

    if request.method == 'GET':
        rows = OperatingTaskComment.objects.filter(task_id__in=family_ids(task.pk)).select_related('author').prefetch_related('mentions').order_by('created_at', 'id')[:500]
        return JsonResponse({'ok': True, 'comments': [_comment_json(row) for row in rows]})

    if not base._editable(request, workspace):
        return _error('permission_denied', 403)
    payload = base._body(request)
    body = str(payload.get('body') or '').strip()
    if not body or len(body) > 10000:
        return _error('invalid_comment')
    mention_ids = []
    for value in payload.get('mention_user_ids') or []:
        try:
            mention_ids.append(int(value))
        except (TypeError, ValueError):
            continue
    mentioned_users = [
        membership.user
        for membership in WorkspaceMembership.objects.filter(
            workspace=workspace,
            user_id__in=set(mention_ids),
            user__is_active=True,
        ).select_related('user')
    ]
    row = OperatingTaskComment.objects.create(task=task, author=request.user, body=body)
    if mentioned_users:
        row.mentions.set(mentioned_users)
    mentioned_ids = [user.pk for user in mentioned_users if user.pk != request.user.pk]
    _log(request, task, 'task.comment_added', {
        'comment_id': row.pk,
        'comment_preview': body[:240],
        'exclude_user_ids': mentioned_ids,
    })
    if mentioned_ids:
        enqueue_task_mentions(
            task,
            request.user,
            mentioned_users,
            comment_id=row.pk,
            comment_preview=body[:240],
        )
    row = OperatingTaskComment.objects.select_related('author').prefetch_related('mentions').get(pk=row.pk)
    return JsonResponse({'ok': True, 'comment': _comment_json(row)}, status=201)



def _external_link_json(row):
    return {
        'id': row.pk,
        'origin_task_id': row.task_id,
        'title': row.title,
        'url': row.url,
        'created_at': row.created_at.isoformat(),
    }


@require_http_methods(['GET', 'POST', 'DELETE'])
def task_external_links(request, task_id):
    """Attach HTTP(S) bookmarks to an authorized Core task.

    A bookmark is never fetched by this server. Access to an external document
    remains controlled by the destination (e.g. Google Docs sharing).
    """
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    workspace, task = _task_for(request, task_id, counts=False)
    if not workspace:
        return _error('core_workspace_required', 403)
    if not task:
        return _error('task_not_found', 404)

    if request.method == 'GET':
        rows = (OperatingTaskExternalLink.objects
                .filter(task_id__in=family_ids(task.pk))
                .order_by('created_at', 'id')[:100])
        return JsonResponse({'ok': True, 'links': [_external_link_json(row) for row in rows]})

    if not base._editable(request, workspace):
        return _error('permission_denied', 403)
    if canonical_id(task.pk) != task.pk:
        return _error('task_consolidated_read_only', 409, canonical_task_id=canonical_id(task.pk))

    payload = base._body(request)
    if not isinstance(payload, dict):
        return _error('invalid_payload')
    if request.method == 'DELETE':
        try:
            link_id = int(payload.get('link_id'))
        except (TypeError, ValueError):
            return _error('link_id_required')
        # Historical consolidated sources may be listed but cannot be changed
        # from the canonical task; this preserves import provenance.
        row = OperatingTaskExternalLink.objects.filter(pk=link_id, task=task).first()
        if row is None:
            return _error('link_not_found', 404)
        old = _external_link_json(row)
        row.delete()
        _log(request, task, 'task.external_link_removed', {'link_id': old['id'], 'url': old['url']})
        return JsonResponse({'ok': True, 'removed': old})

    url = str(payload.get('url') or '').strip()
    title = str(payload.get('title') or '').strip()
    if len(url) > 2000 or any(ord(ch) < 32 for ch in url):
        return _error('invalid_link_url')
    try:
        parsed = urlsplit(url)
        if parsed.scheme.lower() not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password:
            return _error('invalid_link_url')
        # Trigger URL parser validation on a malformed port as well.
        _ = parsed.port
    except ValueError:
        return _error('invalid_link_url')
    if len(title) > 200:
        return _error('invalid_link_title')
    title = title or parsed.hostname
    if OperatingTaskExternalLink.objects.filter(task=task).count() >= 100:
        return _error('link_limit_reached', 409)
    row, created = OperatingTaskExternalLink.objects.get_or_create(
        task=task, url=url, defaults={'title': title, 'added_by': request.user})
    if not created and row.title != title:
        row.title = title
        row.save(update_fields=['title'])
    if created:
        _log(request, task, 'task.external_link_added', {'link_id': row.pk, 'url': url, 'title': title})
    return JsonResponse({'ok': True, 'link': _external_link_json(row)}, status=201 if created else 200)

def _attachment_json(row):
    return {
        'id': row.pk,
        'origin_task_id': row.task_id,
        'name': row.name,
        'mime_type': row.mime_type,
        'size': row.size,
        'uploader': _person(row.uploader),
        'created_at': row.created_at.isoformat(),
        'download_url': f'/api/operating/tasks/{row.task_id}/attachments/{row.pk}/download/',
    }


@require_http_methods(['GET', 'POST'])
def task_attachments(request, task_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    workspace, task = _task_for(request, task_id, counts=False)
    if not workspace:
        return _error('core_workspace_required', 403)
    if not task:
        return _error('task_not_found', 404)

    if request.method == 'GET':
        rows = OperatingTaskAttachment.objects.filter(task_id__in=family_ids(task.pk)).select_related('uploader').order_by('created_at', 'id')[:300]
        return JsonResponse({'ok': True, 'attachments': [_attachment_json(row) for row in rows]})

    if not base._editable(request, workspace):
        return _error('permission_denied', 403)
    uploaded = request.FILES.get('file')
    if not uploaded:
        return _error('file_required')
    if uploaded.size <= 0 or uploaded.size > settings.CONTENT_ATTACHMENT_MAX_BYTES:
        return _error(
            'file_size_invalid', 413,
            max_bytes=settings.CONTENT_ATTACHMENT_MAX_BYTES,
        )

    name = _safe_filename(uploaded.name)
    root = Path(settings.CORE_UPLOAD_ROOT) / 'tasks' / str(task.pk)
    root.mkdir(parents=True, exist_ok=True)
    path = root / f'{uuid.uuid4().hex}-{name}'
    with path.open('wb') as handle:
        for chunk in uploaded.chunks():
            handle.write(chunk)

    row = OperatingTaskAttachment.objects.create(
        task=task,
        uploader=request.user,
        name=name,
        storage_path=str(path),
        mime_type=(uploaded.content_type or '')[:160],
        size=uploaded.size,
    )
    _log(request, task, 'task.attachment_added', {'attachment_id': row.pk, 'name': name, 'size': uploaded.size})
    return JsonResponse({'ok': True, 'attachment': _attachment_json(row)}, status=201)


@require_http_methods(['GET'])
def task_attachment_download(request, task_id, attachment_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    workspace, task = _task_for(request, task_id, counts=False)
    if not workspace:
        return _error('core_workspace_required', 403)
    if not task:
        return _error('task_not_found', 404)
    row = OperatingTaskAttachment.objects.filter(pk=attachment_id, task=task).first()
    if not row or not os.path.isfile(row.storage_path):
        return _error('not_found', 404)
    return FileResponse(open(row.storage_path, 'rb'), as_attachment=True, filename=row.name)


@require_http_methods(['DELETE'])
def task_attachment_delete(request, task_id, attachment_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    workspace, task = _task_for(request, task_id, counts=False)
    if not workspace:
        return _error('core_workspace_required', 403)
    if not task:
        return _error('task_not_found', 404)
    if not base._editable(request, workspace):
        return _error('permission_denied', 403)
    row = OperatingTaskAttachment.objects.filter(pk=attachment_id, task=task).first()
    if not row:
        return _error('not_found', 404)
    path = row.storage_path
    name = row.name
    row.delete()
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    _log(request, task, 'task.attachment_deleted', {'name': name})
    return JsonResponse({'ok': True})


def _task_activity_events(request, workspace, task, *, limit=200):
    """One authorized activity reader for full history and lean task preview."""
    rows = list(
        ActivityEvent.objects.filter(
            layer=ActivityEvent.Layer.CORE,
            object_type='operating_task',
            object_id__in=[str(i) for i in family_ids(task.pk)],
        )
        .select_related('actor')
        .order_by('-created_at')[:limit]
    )
    # A confirmed Telegram report is stored as DailyWorkReport, not a task
    # comment or an uploaded attachment. Show its original evidence alongside
    # the task event to the report author or authorized Core manager only.
    reports = {}
    if task.owner_id == request.user.pk or _can_manage_workspace(request.user, workspace):
        from .work_report_models import DailyWorkReport
        report_ids = set()
        for event in rows:
            if event.action != 'task.daily_report' or not isinstance(event.detail, dict):
                continue
            try:
                report_ids.add(uuid.UUID(str(event.detail.get('report_id'))))
            except (TypeError, ValueError, AttributeError):
                continue
        if report_ids:
            for report in DailyWorkReport.objects.filter(
                pk__in=report_ids, tasks__id__in=family_ids(task.pk), status='confirmed',
            ):
                reports[str(report.pk)] = {
                    'original_text': report.original_text,
                    'summary': (report.interpretation or {}).get('summary', ''),
                    'unmatched_work': (report.interpretation or {}).get('unmatched_work', ''),
                    'source': report.source,
                    'work_date': report.report_date.isoformat(),
                }
    return [{
            'id': row.pk,
            'origin_task_id': int(row.object_id),
            'action': row.action,
            'actor': _person(row.actor) if row.actor else None,
            'detail': row.detail,
            'report': reports.get(str((row.detail or {}).get('report_id'))),
            'created_at': row.created_at.isoformat(),
        } for row in rows]


@require_http_methods(['GET'])
def task_history(request, task_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    workspace, task = _task_for(request, task_id, counts=False)
    if not workspace:
        return _error('core_workspace_required', 403)
    if not task:
        return _error('task_not_found', 404)
    return JsonResponse({'ok': True, 'events': _task_activity_events(request, workspace, task)})
