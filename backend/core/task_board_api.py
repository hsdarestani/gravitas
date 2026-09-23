import json
import os
import re
import uuid
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Q
from django.http import FileResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from . import operating_api as base
from . import operating_api_v4 as v4
from .layer_access import record_activity
from .layer_models import ActivityEvent
from .models import WorkspaceMembership
from .operating_models import (
    Initiative,
    OperatingCycle,
    OperatingMeeting,
    OperatingMilestone,
    OperatingTask,
    OperatingTaskAttachment,
    OperatingTaskChecklistItem,
    OperatingTaskComment,
    OperatingWorkPackage,
    Priority,
    WorkStatus,
)


BOARD_STATUSES = (
    WorkStatus.DRAFT,
    WorkStatus.ACTIVE,
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


def _task_for(request, task_id):
    workspace = base._workspace(request)
    if not workspace:
        return None, None
    task = (
        OperatingTask.objects
        .select_related(
            'workspace', 'owner', 'initiative__process', 'initiative__key_result__objective',
            'milestone', 'work_package', 'cycle', 'project', 'meeting', 'dependency',
        )
        .annotate(
            comment_count=Count('board_comments', distinct=True),
            attachment_count=Count('board_attachments', distinct=True),
            checklist_count=Count('checklist_items', distinct=True),
            checklist_completed_count=Count(
                'checklist_items',
                filter=Q(checklist_items__is_completed=True),
                distinct=True,
            ),
        )
        .filter(pk=task_id, workspace=workspace)
        .first()
    )
    return workspace, task


def _person(user):
    return {
        'id': user.pk,
        'name': user.get_full_name() or user.email,
        'email': user.email,
    }


def _task_json(task):
    trace = {
        'objective': {
            'id': task.initiative.key_result.objective_id,
            'title': task.initiative.key_result.objective.title,
        },
        'key_result': {
            'id': task.initiative.key_result_id,
            'title': task.initiative.key_result.title,
        },
        'initiative': {'id': task.initiative_id, 'title': task.initiative.title},
        'process': {
            'id': task.initiative.process_id,
            'key': task.initiative.process.key,
            'name': task.initiative.process.name,
        },
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
        'initiative_title': task.initiative.title,
        'milestone_id': task.milestone_id,
        'milestone_title': task.milestone.title if task.milestone else '',
        'work_package_id': task.work_package_id,
        'work_package_title': task.work_package.title if task.work_package else '',
        'cycle_id': task.cycle_id,
        'cycle_title': task.cycle.name if task.cycle else '',
        'project_id': task.project_id,
        'project_title': task.project.title if task.project else '',
        'meeting_id': task.meeting_id,
        'meeting_title': task.meeting.title if task.meeting else '',
        'dependency_id': task.dependency_id,
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
    record_activity(
        layer=ActivityEvent.Layer.CORE,
        action=action,
        actor=request.user,
        subject_user=request.user,
        object_type='operating_task',
        object_id=task.pk,
        detail={'title': task.title, **(detail or {})},
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


def _choices(request, workspace):
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
    )
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
    )
    meetings = (
        OperatingMeeting.objects.filter(workspace=workspace)
        .exclude(status=WorkStatus.ARCHIVED)
        .order_by('-scheduled_for', 'title')[:100]
    )
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
        'meetings': [{'id': row.pk, 'title': row.title} for row in meetings],
    }


@require_http_methods(['GET', 'POST'])
def task_board(request):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    workspace = base._workspace(request)
    if not workspace:
        return _error('core_workspace_required', 403)

    if request.method == 'POST':
        if not base._editable(request, workspace):
            return _error('permission_denied', 403)
        response = v4.tasks(request)
        if response.status_code == 201:
            payload = json.loads(response.content.decode('utf-8'))
            task_id = (payload.get('task') or {}).get('id')
            task = OperatingTask.objects.filter(pk=task_id, workspace=workspace).first()
            if task:
                lane_max = (
                    OperatingTask.objects.filter(workspace=workspace, status=task.status)
                    .exclude(pk=task.pk)
                    .order_by('-board_order')
                    .values_list('board_order', flat=True)
                    .first()
                ) or 0
                task.board_order = lane_max + 100
                task.save(update_fields=['board_order', 'updated_at'])
                _log(request, task, 'task.created', {'status': task.status})
        return response

    tasks = (
        OperatingTask.objects.filter(workspace=workspace)
        .select_related(
            'owner', 'initiative__process', 'initiative__key_result__objective',
            'milestone', 'work_package', 'cycle', 'project', 'meeting', 'dependency',
        )
        .annotate(
            comment_count=Count('board_comments', distinct=True),
            attachment_count=Count('board_attachments', distinct=True),
            checklist_count=Count('checklist_items', distinct=True),
            checklist_completed_count=Count(
                'checklist_items',
                filter=Q(checklist_items__is_completed=True),
                distinct=True,
            ),
        )
        .order_by('status', 'board_order', 'priority', 'due_date', 'id')
    )
    return JsonResponse({
        'ok': True,
        'can_edit': base._editable(request, workspace),
        'statuses': [{'value': value, 'label': label} for value, label in WorkStatus.choices],
        'priorities': [{'value': value, 'label': label} for value, label in Priority.choices],
        'tasks': [_task_json(task) for task in tasks],
        **_choices(request, workspace),
    })


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def task_board_detail(request, task_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    workspace, task = _task_for(request, task_id)
    if not workspace:
        return _error('core_workspace_required', 403)
    if not task:
        return _error('task_not_found', 404)

    if request.method == 'GET':
        return JsonResponse({'ok': True, 'task': _task_json(task), **_choices(request, workspace)})

    if not base._editable(request, workspace):
        return _error('permission_denied', 403)

    if request.method == 'DELETE':
        title = task.title
        _log(request, task, 'task.deleted', {'title': title})
        task.delete()
        return JsonResponse({'ok': True})

    payload = base._body(request)
    before = _task_json(task)

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
        if milestone and milestone.initiative.key_result_id != task.initiative.key_result_id:
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
        if task.work_package and task.work_package.milestone.initiative.key_result_id != task.initiative.key_result_id:
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

    if not task.cycle and not task.due_date:
        return _error('task_requires_due_date')
    if task.meeting and not task.due_date:
        return _error('meeting_action_requires_deadline')
    if not str(task.title or '').strip() or not str(task.definition_of_done or '').strip():
        return _error('title_and_done_definition_required')

    if task.status == WorkStatus.DONE and not task.completed_at:
        task.completed_at = timezone.now()
    elif task.status != WorkStatus.DONE:
        task.completed_at = None

    task.save()
    task = _task_for(request, task.pk)[1]
    after = _task_json(task)
    changed = {
        key: {'from': before.get(key), 'to': after.get(key)}
        for key in [
            'title', 'owner', 'priority', 'status', 'due_date',
            'milestone_id', 'work_package_id', 'project_id',
            'meeting_id', 'dependency_id',
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
        rows = task.checklist_items.select_related('created_by').all()[:500]
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
    return {
        'id': row.pk,
        'author': _person(row.author),
        'body': row.body,
        'created_at': row.created_at.isoformat(),
        'updated_at': row.updated_at.isoformat(),
    }


@require_http_methods(['GET', 'POST'])
def task_comments(request, task_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    workspace, task = _task_for(request, task_id)
    if not workspace:
        return _error('core_workspace_required', 403)
    if not task:
        return _error('task_not_found', 404)

    if request.method == 'GET':
        rows = task.board_comments.select_related('author').all()[:500]
        return JsonResponse({'ok': True, 'comments': [_comment_json(row) for row in rows]})

    if not base._editable(request, workspace):
        return _error('permission_denied', 403)
    payload = base._body(request)
    body = str(payload.get('body') or '').strip()
    if not body or len(body) > 10000:
        return _error('invalid_comment')
    row = OperatingTaskComment.objects.create(task=task, author=request.user, body=body)
    _log(request, task, 'task.comment_added', {'comment_id': row.pk})
    return JsonResponse({'ok': True, 'comment': _comment_json(row)}, status=201)


def _attachment_json(row):
    return {
        'id': row.pk,
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
    workspace, task = _task_for(request, task_id)
    if not workspace:
        return _error('core_workspace_required', 403)
    if not task:
        return _error('task_not_found', 404)

    if request.method == 'GET':
        rows = task.board_attachments.select_related('uploader').all()[:300]
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
    workspace, task = _task_for(request, task_id)
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
    workspace, task = _task_for(request, task_id)
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


@require_http_methods(['GET'])
def task_history(request, task_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    workspace, task = _task_for(request, task_id)
    if not workspace:
        return _error('core_workspace_required', 403)
    if not task:
        return _error('task_not_found', 404)
    rows = (
        ActivityEvent.objects.filter(
            layer=ActivityEvent.Layer.CORE,
            object_type='operating_task',
            object_id=str(task.pk),
        )
        .select_related('actor')
        .order_by('-created_at')[:200]
    )
    return JsonResponse({
        'ok': True,
        'events': [{
            'id': row.pk,
            'action': row.action,
            'actor': _person(row.actor) if row.actor else None,
            'detail': row.detail,
            'created_at': row.created_at.isoformat(),
        } for row in rows],
    })
