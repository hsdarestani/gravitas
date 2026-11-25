"""Workspace Studio's authenticated adapter over the canonical Core records."""

import hashlib
import json
from collections import defaultdict
from functools import wraps

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods
from django.utils.text import slugify

from . import operating_api
from .models import KnowledgeResource, ResearchProject, Workspace, WorkspaceMembership, WorkspaceStudioCanvas
from .operating_models import (
    OperatingMeeting, OperatingMilestone, OperatingProcess, OperatingTask, OperatingTaskPredecessor,
    StrategicObjective, WorkStatus,
)
from .platform_access import access_batch, can_comment, can_edit, can_view
from .platform_models import WorkspaceProfile
from .platform_runtime_v3 import _canonical_workspace, core_role
from .task_board_api import (
    _log, _readonly_task_workspace, _task_for, _validated_create_key, task_board, task_board_detail,
)
from .task_consolidation import canonical_id
from .task_dependencies import validate_dependency_graph
from .task_notifications import task_in_app_notifications
from .studio_canvas import validate_canvas, visible_canvas


def error(code, status):
    return JsonResponse({'ok': False, 'error': code}, status=status)


def studio_access(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not settings.WORKSPACE_STUDIO_ENABLED:
            response = error('studio_preview_unavailable', 404)
        elif not request.user.is_authenticated:
            response = error('authentication_required', 401)
        elif (workspace := _readonly_task_workspace(request)) is None:
            response = error('core_workspace_required', 403)
        else:
            response = view(request, workspace, *args, **kwargs)
        response['Cache-Control'] = 'private, no-store'
        response['X-Robots-Tag'] = 'noindex, nofollow'
        return response
    return wrapped


@require_GET
@ensure_csrf_cookie
def studio_shell(request):
    if not settings.WORKSPACE_STUDIO_ENABLED:
        return error('studio_preview_unavailable', 404)
    response = render(request, 'core/workspace_v2.html')
    response['Cache-Control'] = 'private, no-store'
    response['X-Robots-Tag'] = 'noindex, nofollow'
    return response


def _person(user, role='member'):
    return {
        'id': user.pk, 'name': user.get_full_name() or user.get_username(),
        'handle': f"{slugify(user.get_username().split('@')[0]) or 'member'}-{user.pk}", 'role': role,
    }


def _projects_for_workspace(workspace):
    research = _canonical_workspace(WorkspaceProfile.Purpose.RESEARCH, workspace.organization)
    return ResearchProject.objects.filter(
        workspace_id__in=[workspace.pk, research.pk] if research else [workspace.pk],
    ).select_related('workspace', 'platform_profile', 'owner', 'studio_layout')


@require_GET
@studio_access
def studio_state(request, workspace):
    user = request.user
    # V1's board query supplies its canonical consolidation and task ACL results.
    board_response = task_board(request)
    if board_response.status_code != 200:
        return board_response
    board = json.loads(board_response.content)
    role = core_role(user, workspace)
    members = {
        row.user_id: _person(row.user, row.role)
        for row in WorkspaceMembership.objects.filter(workspace=workspace, user__is_active=True)
        .select_related('user').order_by('user__first_name', 'user_id')
    }
    members[user.pk] = _person(user, role)
    project_rows = list(_projects_for_workspace(workspace).order_by('title', 'pk'))
    with access_batch(user, project_rows):
        projects = [
            {'id': project.pk, 'title': project.title, 'description': project.description,
             'owner_id': project.owner_id, 'archived': project.archived,
             'can_edit': board['can_edit'] and can_edit(user, project)}
            for project in project_rows if can_view(user, project)
        ]
    project_ids = {project['id'] for project in projects}
    task_ids = [task['id'] for task in board['tasks']]
    rows = list(OperatingTask.objects.filter(workspace=workspace, pk__in=task_ids).select_related('workspace', 'project__workspace'))
    visible_ids = {row.pk for row in rows if row.project_id is None or row.project_id in project_ids}
    tasks = []
    by_id = {task['id']: task for task in board['tasks']}
    by_project = defaultdict(set)
    with access_batch(user, rows):
        for row in rows:
            if row.pk not in visible_ids or not can_view(user, row):
                continue
            task = by_id[row.pk]
            task = {key: task[key] for key in (
                'id', 'title', 'description', 'priority', 'status', 'due_date',
                'definition_of_done', 'blocked_reason', 'project_id', 'checklist_count',
                'created_at', 'updated_at', 'started_at', 'completed_at',
                'workflow_state', 'workflow_position', 'board_order', 'milestone_id',
            )}
            task['owner_id'] = row.owner_id
            task['meeting_id'] = row.meeting_id
            task['duration_days'] = row.studio_duration_days
            task['can_edit'] = board['can_edit'] and can_edit(user, row)
            task['can_comment'] = can_comment(user, row)
            task['predecessor_ids'] = []
            task['blocked_by_dependency'] = False
            if row.parent_id in visible_ids:
                task['parent_id'] = row.parent_id
            if process_id := by_id[row.pk]['trace']['process']['id']:
                by_project[row.project_id].add(process_id)
            tasks.append(task)
    tasks.sort(key=lambda task: (task['board_order'], task['id']))
    predecessors = _predecessors(workspace, rows)
    for task in tasks:
        dependencies = predecessors.get(task['id'], {})
        task['predecessor_ids'] = [pk for pk in dependencies if pk in visible_ids]
        task['blocked_by_dependency'] = any(status != WorkStatus.DONE for status in dependencies.values())
    project_by_id = {project.pk: project for project in project_rows}
    ids_by_project = defaultdict(set)
    for task in tasks:
        ids_by_project[task['project_id']].add(str(task['id']))
    for project in projects:
        row = project_by_id[project['id']]
        layout = getattr(row, 'studio_layout', None)
        project['canvas_revision'] = layout.revision if layout else 0
        project['canvas'] = visible_canvas(layout.canvas if layout else {}, ids_by_project[row.pk])
        choices = by_project[project['id']]
        project['process_id'] = next(iter(choices)) if len(choices) == 1 else None

    from .project_schedule_api import _parse as parse_schedule
    schedule_notes = list(KnowledgeResource.objects.filter(project_id__in=project_ids,
        kind=KnowledgeResource.Kind.NOTE, metadata__pm_type='task_schedule_v1').select_related('workspace', 'project'))
    by_visible_id = {task['id']: task for task in tasks}
    with access_batch(user, schedule_notes):
        for note in schedule_notes:
            task = by_visible_id.get(note.metadata.get('task_id'))
            if task and task['project_id'] == note.project_id and can_view(user, note):
                try:
                    task['planned_schedule'] = parse_schedule(note)
                except ValueError:
                    continue

    from .task_workflows import TEMPLATES
    from .work_report_models import DailyWorkReport
    reports = DailyWorkReport.objects.filter(user=user, status='confirmed').order_by('-report_date', 'created_at')[:100]
    meetings = OperatingMeeting.objects.filter(workspace=workspace).select_related('owner', 'process').order_by('scheduled_for', 'pk')
    milestones = OperatingMilestone.objects.filter(workspace=workspace, project_id__in=project_ids)
    notification_response = task_in_app_notifications(request)
    notifications = json.loads(notification_response.content)['notifications']
    return JsonResponse({
        'ok': True,
        'workspace': {'id': workspace.pk, 'name': workspace.name},
        'actor': members[user.pk], 'members': list(members.values()), 'can_create_task': board['can_edit'],
        'projects': projects, 'tasks': tasks,
        'templates': [{'id':key,'name':entry['label'],'steps':entry['steps']}
                      for key, entry in TEMPLATES.items() if entry['steps']],
        'daily_reports': [{'id':r.pk, 'date':r.report_date, 'text':r.original_text,
                           'at':r.confirmed_at or r.updated_at} for r in reports],
        'areas': list(OperatingProcess.objects.filter(workspace=workspace, active=True).values('id', 'key', 'name', 'owner_id')),
        'meetings': [{
            'id':meeting.pk, 'title':meeting.title, 'scheduled_for':meeting.scheduled_for,
            'duration_minutes':meeting.duration_minutes, 'owner':{'id':meeting.owner_id},
            'notes':meeting.notes, 'status':meeting.status,
        } for meeting in meetings],
        'milestones': [
            {'id': row.pk, 'project_id': row.project_id, 'title': row.title,
             'due_date': row.due_date, 'status': row.status, 'owner_id': row.owner_id}
            for row in milestones
        ],
        'objectives': [
            {'id': obj.pk, 'title': obj.title, 'description': obj.description,
             'results': [{'id': kr.pk, 'title': kr.title, 'unit': kr.unit, 'target': kr.target_value,
                          'current': kr.current_value, 'baseline': kr.baseline_value, 'owner_id': kr.owner_id}
                         for kr in obj.key_results.all()]}
            for obj in StrategicObjective.objects.filter(workspace=workspace)
            .exclude(status=WorkStatus.ARCHIVED).prefetch_related('key_results').order_by('sort_order', 'id')
        ],
        'notifications': [
            {key: row[key] for key in (
                'id', 'title', 'event_type', 'actor', 'task_id', 'read', 'created_at',
            )}
            for row in notifications if row['task_id'] in visible_ids
        ],
    })


def _predecessors(workspace, rows):
    tasks = {row.pk: row for row in rows}
    primary = {task.dependency_id for task in rows if task.dependency_id}
    primary_states = dict(OperatingTask.objects.filter(workspace=workspace, pk__in=primary).values_list('pk', 'status'))
    result = defaultdict(dict)
    for row in rows:
        if row.dependency_id:
            result[row.pk][row.dependency_id] = primary_states.get(row.dependency_id)
    for target, previous, status in OperatingTaskPredecessor.objects.filter(
        task_id__in=tasks, predecessor__workspace=workspace,
    ).order_by('pk').values_list('task_id', 'predecessor_id', 'predecessor__status'):
        result[target][previous] = status
    return result


def _body(request):
    try:
        payload = json.loads(request.body)
    except (ValueError, UnicodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _duration(value):
    return value is None or type(value) is int and 1 <= value <= 3650


def _sync_checklist(request, task, titles):
    existing = list(task.checklist_items.all())
    # Never re-create or delete historical completion records. The existing
    # checklist item endpoint handles individual changes and their audit events.
    for position, title in enumerate(titles, start=len(existing) + 1):
        if title not in {item.title for item in existing}:
            row = task.checklist_items.create(title=title, position=position * 100, created_by=request.user)
            _log(request, task, 'task.checklist_item_added', {'checklist_item_id': row.pk, 'checklist_item_title': title})


def _task_project_edit(user, task):
    return not task.project_id or (not task.project.archived and can_view(user, task.project))


@require_http_methods(['POST', 'PATCH'])
@studio_access
@transaction.atomic
def studio_task(request, workspace, task_id=None):
    payload = _body(request)
    allowed = {'title', 'description', 'priority', 'status', 'definition_of_done', 'owner_id',
               'duration_days', 'checklist', 'meeting_id', 'expected_updated_at', 'project_id', 'client_create_id', 'blocked_reason'}
    if payload is None or set(payload) - allowed:
        return error('invalid_payload', 400)
    create = request.method == 'POST' and task_id is None
    if not create and (request.method != 'PATCH' or task_id is None):
        return error('method_not_allowed', 405)
    duration = payload.pop('duration_days', None)
    if not _duration(duration):
        return error('invalid_duration', 400)
    titles = payload.pop('checklist', [])
    if not isinstance(titles, list) or len(titles) > 100 or any(
        not isinstance(title, str) or not title.strip() or len(title) > 500 for title in titles
    ):
        return error('invalid_checklist', 400)
    titles = list(dict.fromkeys(title.strip() for title in titles))
    user = request.user
    if not operating_api._editable(request, workspace):
        return error('permission_denied', 403)
    task = None
    if create:
        if payload.get('status') not in (WorkStatus.DRAFT, WorkStatus.READY) or 'meeting_id' in payload:
            return error('invalid_task_create_status', 400)
        project_id = payload.get('project_id')
        if project_id is not None:
            if type(project_id) is not int or project_id < 1:
                return error('invalid_project', 400)
            project = _projects_for_workspace(workspace).filter(pk=project_id, archived=False).first()
            if not project or not can_edit(user, project):
                return error('project_edit_required', 403)
        payload.setdefault('priority', 'p2')
        payload.setdefault('owner_id', user.pk)
        key = _validated_create_key(payload.pop('client_create_id', None))
        if not key:
            return error('invalid_creation_request_id', 400)
        workspace = Workspace.objects.select_for_update().get(pk=workspace.pk)
        signature = hashlib.sha256(json.dumps([payload, duration, titles], sort_keys=True).encode()).hexdigest()
        prior = OperatingTask.objects.filter(
            workspace=workspace, source_metadata__studio_create_key=key,
            source_metadata__studio_create_actor=user.pk,
        ).first()
        if prior:
            if not can_view(user, prior) or not _task_project_edit(user, prior):
                return error('task_not_found', 404)
            if prior.source_metadata.get('studio_create_signature') != signature:
                return error('creation_request_payload_mismatch', 409)
            return JsonResponse({'ok': True, 'id': prior.pk, 'replayed': True})
    else:
        if 'project_id' in payload or 'client_create_id' in payload:
            return error('invalid_payload', 400)
        _, task = _task_for(request, task_id, counts=False, lock=True)
        if not task or not _task_project_edit(user, task):
            return error('task_not_found', 404)
        if not can_edit(user, task):
            return error('permission_denied', 403)
        if payload.get('expected_updated_at') != task.updated_at.isoformat():
            return error('task_changed_elsewhere', 409)
        if 'meeting_id' in payload:
            meeting_id = payload['meeting_id']
            meeting = (OperatingMeeting.objects.filter(workspace=workspace, pk=meeting_id)
                       .exclude(status__in=(WorkStatus.ARCHIVED, WorkStatus.DONE)).first()
                       if type(meeting_id) is int else None)
            if meeting is None:
                return error('meeting_not_found', 404)
            if meeting.owner_id != user.pk and core_role(user, workspace) not in ('owner', 'admin'):
                return error('permission_denied', 403)
        if payload.get('status') == WorkStatus.BLOCKED and not str(payload.get('blocked_reason', '')).strip():
            return error('blocked_reason_required', 400)
        if payload.get('status') in (WorkStatus.ACTIVE, WorkStatus.DONE) and payload['status'] != task.status:
            Workspace.objects.select_for_update().get(pk=workspace.pk)
            if any(status != WorkStatus.DONE for status in _predecessors(workspace, [task])[task.pk].values()):
                return error('task_prerequisites_incomplete', 409)
            if payload['status'] == WorkStatus.DONE and task.checklist_items.filter(is_completed=False).exists():
                return error('task_checklist_incomplete', 409)
    # Delegate the authoritative task write, including its V1 validation,
    # audit history, date tracking and canonical synchronization hooks.
    request._body = json.dumps(payload).encode()
    response = task_board(request) if create else task_board_detail(request, task_id)
    if response.status_code >= 400:
        transaction.set_rollback(True)
        return response
    task_id = json.loads(response.content)['task']['id']
    task = OperatingTask.objects.get(workspace=workspace, pk=task_id)
    changes = {}
    if duration is not None:
        changes['studio_duration_days'] = duration
    if create:
        changes['source_metadata'] = {
            **task.source_metadata, 'studio_create_key': key, 'studio_create_actor': user.pk,
            'studio_create_signature': signature,
        }
    if changes:
        OperatingTask.objects.filter(pk=task_id).update(**changes)
    _sync_checklist(request, task, titles)
    return JsonResponse({'ok': True, 'id': task_id}, status=201 if create else 200)


@require_http_methods(['POST'])
@studio_access
@transaction.atomic
def studio_dependency(request, workspace):
    payload = _body(request) or {}
    changes = payload.get('changes', [payload])
    if not isinstance(changes, list) or not 1 <= len(changes) <= 100:
        return error('invalid_dependency', 400)
    for change in changes:
        if not isinstance(change, dict) or change.get('action') not in ('add', 'remove') or any(
            type(change.get(field)) is not int or change[field] < 1 for field in ('predecessor_id', 'task_id')
        ):
            return error('invalid_dependency', 400)
    target_ids = {change['task_id'] for change in changes}
    list(OperatingTask.objects.select_for_update().filter(workspace=workspace, pk__in=target_ids)
         .order_by('pk').values_list('pk', flat=True))
    Workspace.objects.select_for_update().get(pk=workspace.pk)
    for change in changes:
        failure = _change_dependency(request, workspace, change)
        if failure:
            transaction.set_rollback(True)
            return failure
    return JsonResponse({'ok': True})


def _change_dependency(request, workspace, payload):
    previous_id, target_id = payload['predecessor_id'], payload['task_id']
    action = payload['action']
    _, target = _task_for(request, target_id, counts=False, lock=True)
    if not target or not _task_project_edit(request.user, target):
        return error('task_not_found', 404)
    previous = OperatingTask.objects.filter(workspace=workspace, pk=previous_id).select_related('project').first()
    if not previous or not can_view(request.user, previous) or not _task_project_edit(request.user, previous):
        return error('task_not_found', 404)
    if not operating_api._editable(request, workspace) or not can_edit(request.user, target):
        return error('permission_denied', 403)
    if canonical_id(target.pk) != target.pk or canonical_id(previous.pk) != previous.pk:
        return error('task_consolidated_read_only', 409)
    if action == 'add' and (target.pk == previous.pk or target.project_id != previous.project_id):
        return error('invalid_dependency', 400)
    dependencies = _predecessors(workspace, [target])[target.pk]
    if action == 'add' and previous_id not in dependencies:
        if target.status in (WorkStatus.ACTIVE, WorkStatus.DONE) and previous.status != WorkStatus.DONE:
            return error('task_already_started', 409)
        try:
            validate_dependency_graph(workspace.pk, {target.pk: {*dependencies, previous_id}})
        except ValidationError:
            return error('dependency_cycle', 409)
        OperatingTaskPredecessor.objects.create(task=target, predecessor=previous)
    elif action == 'remove' and previous_id in dependencies:
        if target.dependency_id == previous_id:
            from .canonical_task_outbox import queue_task_sync
            from .canonical_projects import suppress
            target.dependency_id = None
            with suppress():
                target.save(update_fields=['dependency', 'updated_at'])
            from .canonical_models import CanonicalProject
            if CanonicalProject.objects.filter(project_id=target.project_id, enabled=True).exists():
                queue_task_sync(target)
        OperatingTaskPredecessor.objects.filter(task=target, predecessor=previous).delete()
    else:
        return None
    _log(request, target, 'task.dependencies_changed', {'action': action, 'predecessor_id': previous_id})
    return None


@require_GET
@studio_access
def studio_task_details(request, workspace, task_id):
    from .task_board_api import _attachment_json, _checklist_item_json, _comment_json, _task_activity_events
    from .task_workflow_api import task_workflow

    _, task = _task_for(request, task_id, counts=False)
    if not task or not _task_project_edit(request.user, task):
        return error('task_not_found', 404)
    workflow = None
    if task.workflow_state:
        response = task_workflow(request, task_id)
        if response.status_code == 200:
            workflow = json.loads(response.content)['workflow']
    return JsonResponse({
        'ok': True,
        'comments': [_comment_json(row) for row in task.board_comments.select_related('author').prefetch_related('mentions')[:500]],
        'checklist': [_checklist_item_json(row) for row in task.checklist_items.select_related('created_by')[:500]],
        'attachments': [{**_attachment_json(row),
                         'download_url': f'/api/workspace-v2/tasks/{task.pk}/attachments/{row.pk}/'}
                        for row in task.board_attachments.select_related('uploader')[:300]],
        'events': [item for item in _task_activity_events(request, workspace, task) if item['origin_task_id'] == task.pk],
        'workflow': workflow,
    })


@studio_access
def studio_task_content(request, workspace, task_id, kind, item_id=None):
    from .platform_access import downloads_allowed
    from .task_board_api import task_attachment_download, task_attachments, task_checklist, task_checklist_item, task_comments
    from .task_workflow_api import task_workflow

    _, task = _task_for(request, task_id, counts=False)
    if not task or not _task_project_edit(request.user, task):
        return error('task_not_found', 404)
    if kind == 'workflow' and item_id is None:
        return task_workflow(request, task_id)
    if kind == 'comments' and request.method == 'POST' and item_id is None:
        if not can_comment(request.user, task):
            return error('permission_denied', 403)
        payload = _body(request)
        if not payload:
            return error('invalid_payload', 400)
        mentions = payload.get('mention_user_ids', [])
        if not isinstance(mentions, list) or any(type(pk) is not int for pk in mentions) or len(mentions) > 100:
            return error('invalid_mentions', 400)
        mentioned = WorkspaceMembership.objects.filter(workspace=workspace, user_id__in=mentions).select_related('user')
        payload['mention_user_ids'] = [row.user_id for row in mentioned if can_view(row.user, task)]
        request._body = json.dumps(payload).encode()
        return task_comments(request, task_id)
    if kind == 'attachments' and request.method == 'GET' and item_id is not None:
        if not downloads_allowed(task):
            return error('permission_denied', 403)
        return task_attachment_download(request, task_id, item_id)
    if not can_edit(request.user, task) or not operating_api._editable(request, workspace):
        return error('permission_denied', 403)
    if kind == 'attachments' and request.method == 'POST' and item_id is None:
        return task_attachments(request, task_id)
    if kind == 'checklist' and request.method == 'POST' and item_id is None:
        return task_checklist(request, task_id)
    if kind == 'checklist' and request.method in ('PATCH', 'DELETE') and item_id is not None:
        if not task.checklist_items.filter(pk=item_id).exists():
            return error('checklist_item_not_found', 404)
        return task_checklist_item(request, task_id, item_id)
    return error('method_not_allowed', 405)


@require_GET
@studio_access
def studio_csrf(request, workspace):
    from django.middleware.csrf import get_token

    return JsonResponse({'ok': True, 'csrf_token': get_token(request)})


@require_http_methods(['PATCH'])
@studio_access
@transaction.atomic
def studio_project_canvas(request, workspace, project_id):
    from .layer_access import record_activity

    project = _projects_for_workspace(workspace).select_for_update(of=('self',)).filter(pk=project_id, archived=False).first()
    if not project or not can_view(request.user, project):
        return error('project_not_found', 404)
    if not can_edit(request.user, project) or not operating_api._editable(request, workspace):
        return error('permission_denied', 403)
    layout = WorkspaceStudioCanvas.objects.filter(project=project).first()
    expected_revision = layout.revision if layout else 0
    payload = _body(request) or {}
    if type(payload.get('revision')) is not int or payload['revision'] != expected_revision:
        return error('canvas_changed_elsewhere', 409)
    canvas = payload.get('canvas')
    rows = list(OperatingTask.objects.filter(workspace=workspace, project=project).select_related('workspace', 'project'))
    with access_batch(request.user, rows):
        visible = {str(task.pk) for task in rows if can_view(request.user, task)}
    try:
        validate_canvas(canvas, visible)
    except ValidationError as exc:
        return error(exc.messages[0], 400)
    old = layout.canvas if layout else {}
    old_visible = visible_canvas(old, visible)
    # Carry forward shapes and placements linked to restricted records.
    for key in ('groups', 'arrows'):
        hidden = [shape for shape in old.get(key, []) if shape not in old_visible[key]]
        if {shape['id'] for shape in hidden} & {shape['id'] for shape in canvas[key]}:
            return error('canvas_shape_conflict', 409)
        canvas[key].extend(hidden)
    canvas['positions'].update({pk:point for pk, point in old.get('positions', {}).items() if pk not in visible})
    revision = expected_revision + 1
    WorkspaceStudioCanvas.objects.update_or_create(project=project, defaults={'canvas':canvas, 'revision':revision})
    record_activity(layer='core', action='studio.canvas_updated', actor=request.user,
                    object_type='project', object_id=project.pk, detail={'revision':revision})
    return JsonResponse({'ok':True, 'revision':revision})


@require_http_methods(['POST', 'PATCH'])
@studio_access
def studio_meeting(request, workspace, meeting_id=None):
    from datetime import datetime, time
    from zoneinfo import ZoneInfo
    from django.utils.dateparse import parse_date

    if not operating_api._editable(request, workspace):
        return error('permission_denied', 403)
    payload = _body(request)
    if not payload or set(payload) - {'status', 'title', 'notes', 'date', 'time', 'end', 'owner_id'}:
        return error('invalid_meeting', 400)
    create = request.method == 'POST' and meeting_id is None
    meeting = None
    if not create:
        if request.method != 'PATCH' or meeting_id is None:
            return error('method_not_allowed', 405)
        meeting = OperatingMeeting.objects.filter(workspace=workspace, pk=meeting_id).first()
        if not meeting:
            return error('meeting_not_found', 404)
        if meeting.owner_id != request.user.pk and core_role(request.user, workspace) not in ('owner', 'admin'):
            return error('permission_denied', 403)
    if set(payload) == {'status'} and meeting and payload['status'] in (WorkStatus.ACTIVE, WorkStatus.DONE):
        request._body = json.dumps(payload).encode()
        return operating_api.meeting_detail(request, meeting_id)
    title, notes = payload.get('title'), payload.get('notes', '')
    if not isinstance(title, str) or not title.strip() or len(title) > 220 or not isinstance(notes, str) or len(notes) > 10000:
        return error('invalid_meeting', 400)
    try:
        date = parse_date(payload.get('date', ''))
        start = time.fromisoformat(payload.get('time', ''))
        stop = time.fromisoformat(payload['end']) if payload.get('end') else None
        if not date or start.tzinfo or stop is not None and (stop <= start or stop.tzinfo):
            raise ValueError
    except (TypeError, ValueError):
        return error('invalid_meeting_time', 400)
    owner_id = payload.get('owner_id')
    if type(owner_id) is not int or not WorkspaceMembership.objects.filter(
        workspace=workspace, user_id=owner_id, user__is_active=True,
    ).exists():
        return error('invalid_meeting_owner', 400)
    if meeting and owner_id != meeting.owner_id:
        return error('meeting_owner_change_unavailable', 400)
    scheduled = datetime.combine(date, start, ZoneInfo('Asia/Tehran'))
    duration = int((datetime.combine(date, stop) - scheduled.replace(tzinfo=None)).total_seconds() / 60) if stop else 60
    changes = {'title': title.strip(), 'notes': notes.strip(), 'scheduled_for': scheduled.isoformat(), 'duration_minutes': duration}
    if create:
        changes.update({'owner_id':owner_id, 'kind':OperatingMeeting.Kind.WEEKLY})
    request._body = json.dumps(changes).encode()
    return operating_api.meetings(request) if create else operating_api.meeting_detail(request, meeting_id)
