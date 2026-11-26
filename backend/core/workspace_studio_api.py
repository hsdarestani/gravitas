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
from .models import KnowledgeResource, ResearchProject, Workspace, WorkspaceMembership, WorkspaceStudioCanvas, WorkspaceStudioNotebook, WorkspaceStudioPreferences, WorkspaceStudioIdea, WorkspaceStudioTemplate
from .operating_models import (
    OperatingMeeting, OperatingMilestone, OperatingProcess, OperatingTask, OperatingTaskPredecessor,
    StrategicObjective, WorkStatus,
)
from .platform_access import INHERIT_VISIBILITY, access_batch, can_comment, can_edit, can_manage, can_view, content_type_for, policy_for
from .platform_models import AccessGrant, ObjectPolicy, WorkspaceProfile
from .platform_runtime_v3 import _canonical_workspace, core_role
from .task_board_api import (
    _log, _readonly_task_workspace, _task_for, _validated_create_key, task_board, task_board_detail,
)
from .task_consolidation import canonical_id
from .task_dependencies import validate_dependency_graph
from .task_notifications import enqueue_studio_task_notice, task_in_app_notifications
from .studio_canvas import incomplete_project_handoff, validate_canvas, validate_links, visible_canvas


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
        elif request.method in ('GET','HEAD','OPTIONS'):
            response = view(request, workspace, *args, **kwargs)
        else:
            with transaction.atomic():
                response = view(request, workspace, *args, **kwargs)
                if response.status_code >= 400:
                    transaction.set_rollback(True)
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
    ).select_related('workspace', 'platform_profile', 'owner', 'studio_layout', 'studio_project')


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
    preferences = {row.user_id:row for row in WorkspaceStudioPreferences.objects.filter(user_id__in=members)}
    for identity, member in members.items():
        preference = preferences.get(identity)
        if preference:
            public_fields = {'name','color','photo','handle','roleTitle','pronouns'}
            if identity == user.pk:
                public_fields.add('gender')
            member.update({key:value for key,value in preference.profile.items() if key in public_fields})
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
    rows = list(OperatingTask.objects.filter(workspace=workspace, pk__in=task_ids).select_related('workspace', 'project__workspace').prefetch_related('studio_contributors'))
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
            task['contributor_ids'] = [person.pk for person in row.studio_contributors.all() if person.pk in members]
            task['meeting_id'] = row.meeting_id
            task['milestone_id'] = row.milestone_id
            task['duration_days'] = row.studio_duration_days
            task['can_edit'] = board['can_edit'] and can_edit(user, row)
            task['can_comment'] = can_comment(user, row)
            policy = policy_for(row)
            visibility = policy.visibility if policy else INHERIT_VISIBILITY
            task['private'] = visibility in (ObjectPolicy.Visibility.PRIVATE, ObjectPolicy.Visibility.SPECIFIC)
            task['can_edit_access'] = (not row.workflow_position and can_manage(user, row)
                                       and (visibility == INHERIT_VISIBILITY or 'studio_task_access' in row.source_metadata))
            task['allowed_members'] = row.source_metadata.get('studio_task_access', {}).get('members', []) if task['can_edit_access'] else []
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
    from .workspace_studio_projects import _project_json, _project_notes
    notes_by_project = _project_notes(user, project_ids)
    ideas = WorkspaceStudioIdea.objects.filter(workspace=workspace, project_id__in=project_ids).order_by('-pk')
    ideas_by_project = {idea.project_id:idea for idea in ideas}
    for project in projects:
        row = project_by_id[project['id']]
        project['notes'] = notes_by_project[project['id']]
        if idea := ideas_by_project.get(row.pk):
            project['idea_source' if idea.promoted_at else 'idea_id'] = idea.pk
        layout = getattr(row, 'studio_layout', None)
        project['canvas_revision'] = layout.revision if layout else 0
        allowed_projects = {str(pk) for pk in project_ids}
        project['canvas'] = visible_canvas(layout.canvas if layout else {}, ids_by_project[row.pk], allowed_projects)
        project['canvas_versions'] = [
            {**version, 'canvas':visible_canvas(version['canvas'], ids_by_project[row.pk], allowed_projects)}
            for version in (layout.versions if layout else [])
        ] if project['can_edit'] else []
        choices = by_project[project['id']]
        details = getattr(row, 'studio_project', None)
        if details:
            project.update(_project_json(row, details))
            project['completions'] = [{
                **entry, 'tasksAtClose': [task for task in entry.get('tasksAtClose', []) if task['id'] in ids_by_project[row.pk]],
            } for entry in project['completions']]
            if details.notebook:
                project['work_report'] = {
                    **details.notebook,
                    'blocks': [block for block in details.notebook.get('blocks', [])
                               if not block.get('task') or block['task'] in ids_by_project[row.pk]],
                }
        project['process_id'] = details.process_id if details and details.process_id else next(iter(choices)) if len(choices) == 1 else None

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
    from .workspace_studio_projects import meeting_records, project_template_catalog, studio_template_data
    from .workspace_studio_evidence import calendar_notes
    from .layer_models import ActivityEvent
    meetings, series = meeting_records(workspace, project_ids, visible_ids, {idea.pk for idea in ideas_by_project.values()})
    milestones = (OperatingMilestone.objects.filter(workspace=workspace, project_id__in=project_ids)
                  .exclude(status=WorkStatus.ARCHIVED).select_related('workspace', 'project').prefetch_related('studio_linked_tasks'))
    milestone_tasks = defaultdict(set)
    for task in tasks:
        milestone_tasks[(task['project_id'], task['milestone_id'])].add(task['id'])
    activity_tasks = {str(task['id']): task for task in tasks}
    activity = ActivityEvent.objects.filter(
        layer=ActivityEvent.Layer.CORE, object_type='operating_task', object_id__in=activity_tasks,
    ).order_by('-created_at', '-pk')[:600]
    notification_response = task_in_app_notifications(request)
    notifications = [
        item for item in json.loads(notification_response.content)['notifications']
        if item['task_id'] is None or item['task_id'] in visible_ids
    ]
    return JsonResponse({
        'ok': True,
        'workspace': {'id': workspace.pk, 'name': workspace.name},
        'actor': members[user.pk], 'members': list(members.values()), 'can_create_task': board['can_edit'],
        'projects': projects, 'tasks': tasks,
        'templates': [{'id':key,'name':entry['label'],'steps':entry['steps']}
                      for key, entry in TEMPLATES.items() if entry['steps']],
        'project_templates': [{**row, 'projectTemplate': True} for row in project_template_catalog().values()],
        'ideas': [{'id':idea.pk, 'title':idea.title, 'body':idea.body, 'author':idea.author_id, 'process_id':idea.process_id,
                   'project_id':idea.project_id, 'state':'brought' if idea.promoted_at else 'sent' if idea.referred_at else 'draft',
                   'notes':idea.notes} for idea in ideas_by_project.values()],
        'saved_templates': [studio_template_data(row)
                            for row in WorkspaceStudioTemplate.objects.filter(workspace=workspace,author=user).order_by('name')],
        'notebooks': [{'date': entry.date, 'blocks': entry.blocks, 'revision': entry.revision, 'updatedAt': entry.updated_at}
                      for entry in WorkspaceStudioNotebook.objects.filter(user=user).order_by('-date')[:730]],
        'showroom_colors': preferences[user.pk].showroom if user.pk in preferences else {},
        'showroom_view': preferences[user.pk].showroom_view if user.pk in preferences else {},
        'admin_review_days': workspace.platform_profile.studio_review_days,
        'daily_reports': [{'id':r.pk, 'date':r.report_date, 'text':r.original_text,
                           'at':r.confirmed_at or r.updated_at} for r in reports],
        'areas': list(OperatingProcess.objects.filter(workspace=workspace, active=True)
                      .values('id', 'key', 'name', 'owner_id', 'studio_task_presets')),
        'meetings': meetings, 'meeting_series': series,
        'calendar_notes': calendar_notes(workspace, user),
        'activity': [{'id': str(row.pk), 'actor': str(row.actor_id or ''), 'task': row.object_id,
                      'project': str(activity_tasks[row.object_id]['project_id'] or 'unassigned'),
                      'at': row.created_at, 'kind': 'activity',
                      'text': row.action.removeprefix('task.').replace('_', ' ').capitalize() + ' · ' + activity_tasks[row.object_id]['title']}
                     for row in activity],
        'milestones': [
            {'id': row.pk, 'project_id': row.project_id, 'title': row.title,
             'due_date': row.due_date, 'status': row.status, 'owner_id': row.owner_id, 'updated_at': row.updated_at.isoformat(),
             'task_ids': sorted(milestone_tasks[(row.project_id, row.pk)] | {
                 task.pk for task in row.studio_linked_tasks.all() if task.pk in visible_ids and task.project_id == row.project_id
             })}
            for row in milestones if can_view(user, row)
        ],
        'objectives': [
            {'id': obj.pk, 'title': obj.title, 'description': obj.description, 'owner_id': obj.owner_id,
             'results': [{'id': kr.pk, 'title': kr.title, 'unit': kr.unit, 'target': kr.target_value,
                          'current': kr.current_value, 'baseline': kr.baseline_value, 'owner_id': kr.owner_id,
                          'checkins': [{'value': entry.value, 'note': entry.note, 'actor': entry.actor_id, 'at': entry.created_at}
                                       for entry in sorted(kr.studio_checkins.all(), key=lambda entry: entry.pk)],
                          'links': [{'projectId': str(link.project_id), 'milestoneId': str(link.milestone_id or '')}
                                    for link in kr.studio_links.all() if link.project_id in project_ids]}
                         for kr in obj.key_results.all()]}
            for obj in StrategicObjective.objects.filter(workspace=workspace)
            .exclude(status=WorkStatus.ARCHIVED).prefetch_related('key_results__studio_checkins','key_results__studio_links').order_by('sort_order', 'id')
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


def _task_project_read(user, task):
    return not task.project_id or can_view(user, task.project)


def _save_studio_task_access(task, user, mode, members):
    metadata = task.source_metadata
    tracked = metadata.get('studio_task_access', {})
    grants = AccessGrant.objects.filter(content_type=content_type_for(task), object_id=task.pk)
    selected = set(members) | set(task.studio_contributors.values_list('pk', flat=True)) | {user.pk}
    selected.discard(task.owner_id)
    kept = []
    prior = grants.filter(pk__in=tracked.get('grants', [])).filter(role=AccessGrant.Role.VIEW, expires_at__isnull=True)
    if mode == 'private':
        prior.exclude(user_id__in=selected).delete()
        kept = list(prior.filter(user_id__in=selected).values_list('pk', flat=True))
        for member_id in selected:
            grant, created = grants.get_or_create(user_id=member_id, defaults={
                'content_type': content_type_for(task), 'object_id': task.pk, 'role': AccessGrant.Role.VIEW, 'granted_by': user,
            })
            if created:
                kept.append(grant.pk)
    else:
        prior.delete()
    visibility = ObjectPolicy.Visibility.PRIVATE if mode == 'private' else INHERIT_VISIBILITY
    policy = policy_for(task, create=True, created_by=user, default_visibility=visibility)
    if policy.visibility != visibility:
        policy.visibility = visibility
        policy.save(update_fields=['visibility', 'updated_at'])
    task.source_metadata = {**metadata, 'studio_task_access': {'grants': kept, 'members': members if mode == 'private' else []}}
    OperatingTask.objects.filter(pk=task.pk).update(source_metadata=task.source_metadata)


@require_http_methods(['POST', 'PATCH'])
@studio_access
@transaction.atomic
def studio_task(request, workspace, task_id=None):
    payload = _body(request)
    allowed = {'title', 'description', 'priority', 'status', 'definition_of_done', 'owner_id',
               'duration_days', 'checklist', 'contributor_ids', 'meeting_id', 'expected_updated_at', 'project_id', 'client_create_id',
               'blocked_reason', 'visibility', 'allowed_members'}
    if payload is None or set(payload) - allowed:
        return error('invalid_payload', 400)
    create = request.method == 'POST' and task_id is None
    if not create and (request.method != 'PATCH' or task_id is None):
        return error('method_not_allowed', 405)
    contributors = payload.pop('contributor_ids', None)
    visibility = payload.pop('visibility', None)
    allowed_members = payload.pop('allowed_members', [])
    if (visibility not in (None, 'private', 'workspace') or not isinstance(allowed_members, list)
            or len(allowed_members) > 100 or any(type(pk) is not int or pk < 1 for pk in allowed_members)
            or allowed_members and visibility != 'private'):
        return error('invalid_task_access', 400)
    if contributors is not None and (
        not isinstance(contributors, list) or len(contributors) > 100
        or any(type(pk) is not int or pk < 1 for pk in contributors)
        or WorkspaceMembership.objects.filter(workspace=workspace, user_id__in=contributors, user__is_active=True)
        .count() != len(set(contributors))
    ):
        return error('invalid_contributors', 400)
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
        create_fields = [payload, duration, titles, contributors]
        if visibility is not None:
            create_fields.extend([visibility, allowed_members])
        signature = hashlib.sha256(json.dumps(create_fields, sort_keys=True).encode()).hexdigest()
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
        if visibility is not None:
            policy = policy_for(task)
            if task.workflow_position or not can_manage(user, task) or (
                policy and policy.visibility != INHERIT_VISIBILITY and 'studio_task_access' not in task.source_metadata
            ):
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
            if task.project_id and incomplete_project_handoff(task):
                return error('project_handoff_incomplete', 409)
            if payload['status'] == WorkStatus.DONE:
                if task.checklist_items.filter(is_completed=False).exists():
                    return error('task_checklist_incomplete', 409)
                canvas = WorkspaceStudioCanvas.objects.filter(project_id=task.project_id).values_list('canvas', flat=True).first() or {}
                if any(loop['from']==str(task.pk) and not loop['optional'] and loop['count'] < loop['target']
                       for loop in canvas.get('loops', [])):
                    return error('review_pass_required', 409)
    if visibility == 'private':
        assigned = set(allowed_members) | set(contributors if contributors is not None else
                                              task.studio_contributors.values_list('pk', flat=True) if task else [])
        assigned_members = WorkspaceMembership.objects.filter(workspace=workspace, user_id__in=assigned,
                                                             user__is_active=True).select_related('user')
        task_project = task.project if task else project if project_id is not None else None
        eligible = {row.user_id for row in assigned_members if not task_project or can_view(row.user, task_project)}
        if eligible != assigned:
            return error('invalid_task_access', 400)
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
        if create:
            task.source_metadata = changes['source_metadata']
    added_contributors = set()
    if contributors is not None:
        selected_contributors = set(contributors) - {task.owner_id}
        added_contributors = selected_contributors - set(task.studio_contributors.values_list('pk', flat=True))
        task.studio_contributors.set(selected_contributors)
    if visibility is not None:
        _save_studio_task_access(task, user, visibility, allowed_members)
    if added_contributors:
        enqueue_studio_task_notice(
            task, user, 'task.contributor_assigned', task.updated_at.isoformat(),
            added_contributors, 'You were added as a contributor',
        )
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
    if not task or not _task_project_read(request.user, task):
        return error('task_not_found', 404)
    workflow = None
    if task.workflow_state:
        response = task_workflow(request, task_id, studio=True)
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
    scope = _task_project_read if request.method == 'GET' else _task_project_edit
    if not task or not scope(request.user, task):
        return error('task_not_found', 404)
    if kind == 'workflow' and item_id is None:
        return task_workflow(request, task_id, studio=True)
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

    Workspace.objects.select_for_update().get(pk=workspace.pk)
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
    layout = layout or WorkspaceStudioCanvas(project=project)
    old = layout.canvas
    rows = list(OperatingTask.objects.filter(workspace=workspace, project=project).select_related('workspace', 'project'))
    with access_batch(request.user, rows):
        visible = {str(task.pk) for task in rows if can_view(request.user, task)}
    candidates = list(_projects_for_workspace(workspace).exclude(pk=project.pk))
    with access_batch(request.user, candidates):
        allowed_projects = {str(target.pk) for target in candidates if can_view(request.user, target)}
    if payload.get('action') == 'version':
        from uuid import uuid4
        from django.utils import timezone

        name = payload.get('name')
        if not isinstance(name, str) or not name.strip() or len(name) > 100 or len(layout.versions) >= 300:
            return error('invalid_canvas_version', 400)
        version = {'id':str(uuid4()),'name':name.strip(),'actor':str(request.user.pk),
                   'at':timezone.now().isoformat(),'canvas':old}
        layout.versions.insert(0,version)
        layout.save()
        return JsonResponse({'ok':True,'id':version['id'],'revision':layout.revision})
    canvas = payload.get('canvas')
    backup = None
    if payload.get('action') == 'restore':
        from uuid import uuid4
        from django.utils import timezone

        entry = next((version for version in layout.versions if version['id']==payload.get('version_id')), None)
        if not entry or len(layout.versions) >= 300:
            return error('canvas_version_not_found', 404)
        canvas = visible_canvas(entry['canvas'], visible, allowed_projects)
        # Review history and project scheduling continue independently of geometry.
        canvas['loops'] = visible_canvas(old, visible, allowed_projects).get('loops', [])
        canvas['start_date'] = old.get('start_date', '')
        canvas['end_time'] = old.get('end_time', '23:59')
        backup = {'id':str(uuid4()),'name':('Before restoring '+entry['name'])[:100],'actor':str(request.user.pk),
                  'at':timezone.now().isoformat(),'canvas':old}
    try:
        validate_canvas(canvas, visible, allowed_projects)
    except ValidationError as exc:
        return error(exc.messages[0], 400)
    old_visible = visible_canvas(old, visible, allowed_projects)
    for key in ('groups', 'arrows', 'nodes', 'handoffs', 'loops'):
        hidden = [shape for shape in old.get(key, []) if shape not in old_visible.get(key, [])]
        if hidden and isinstance(hidden[0], dict):
            if {shape['id'] for shape in hidden} & {shape['id'] for shape in canvas.get(key, [])}:
                return error('canvas_shape_conflict', 409)
        if hidden:
            canvas.setdefault(key, []).extend(hidden)
    canvas['positions'].update({pk:point for pk, point in old.get('positions', {}).items() if pk not in visible})
    try:
        validate_links(project, workspace, canvas, rows, old)
    except ValidationError as exc:
        return error(exc.messages[0], 409)
    layout.canvas = canvas
    layout.revision += 1
    if backup:
        layout.versions.insert(0,backup)
    layout.save()
    revision = layout.revision
    record_activity(layer='core', action='studio.canvas_updated', actor=request.user,
                    object_type='project', object_id=project.pk, detail={'revision':revision})
    return JsonResponse({'ok':True, 'revision':revision})


@require_http_methods(['POST', 'PATCH'])
@studio_access
@transaction.atomic
def studio_meeting(request, workspace, meeting_id=None):
    from datetime import datetime, time
    from zoneinfo import ZoneInfo
    from django.utils.dateparse import parse_date
    from .models import WorkspaceStudioMeetingDetails, WorkspaceStudioMeetingSeries
    from .workspace_studio_projects import meeting_visible_reference, studio_meeting_record

    if not operating_api._editable(request, workspace):
        return error('permission_denied', 403)
    payload = _body(request)
    if not payload or set(payload) - {'status','title','notes','date','time','end','owner_id','agenda','refs','followups',
                                          'repeat','repeat_end','agenda_action','agenda_index','agenda_text','agenda_done','pinned'}:
        return error('invalid_meeting', 400)
    create = request.method == 'POST' and meeting_id is None
    meeting = None
    details = None
    if not create:
        if request.method != 'PATCH' or meeting_id is None:
            return error('method_not_allowed', 405)
        meeting = studio_meeting_record(workspace, meeting_id)
        if not meeting:
            return error('meeting_not_found', 404)
        details, _ = WorkspaceStudioMeetingDetails.objects.get_or_create(meeting=meeting)
        admin = core_role(request.user,workspace) in ('owner','admin')
        if payload.get('agenda_action') in ('add','check'):
            if meeting.status in (WorkStatus.ARCHIVED,WorkStatus.DONE):
                return error('meeting_closed',409)
            text = payload.get('agenda_text')
            if not isinstance(text,str) or not text.strip() or len(text)>160 or len(details.agenda)>=100 and payload['agenda_action']=='add':
                return error('invalid_meeting_agenda',400)
            if payload['agenda_action']=='add':
                if any(row['text'].casefold() == text.strip().casefold() for row in details.agenda):
                    return error('meeting_agenda_duplicate', 409)
                details.agenda.append({'text':text.strip(),'done':False})
            else:
                index = payload.get('agenda_index')
                if type(index) is not int or not 0<=index<len(details.agenda) or details.agenda[index]['text']!=text:
                    return error('meeting_agenda_changed',409)
                done = payload.get('agenda_done', not details.agenda[index]['done'])
                if type(done) is not bool:
                    return error('invalid_meeting_agenda', 400)
                details.agenda[index]['done'] = done
            details.save(update_fields=['agenda'])
            return JsonResponse({'ok':True})
        if 'pinned' in payload:
            if not admin or not meeting.notes or type(payload['pinned']) is not bool:
                return error('permission_denied',403)
            details.pinned=payload['pinned']
            details.save(update_fields=['pinned'])
            return JsonResponse({'ok':True})
        if meeting.owner_id != request.user.pk and not admin:
            transaction.set_rollback(True)
            return error('permission_denied', 403)
        if set(payload) == {'status'} and payload['status'] in (WorkStatus.ACTIVE, WorkStatus.DONE):
            request._body = json.dumps(payload).encode()
            return operating_api.meeting_detail(request, meeting.pk)
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
    agenda = payload.get('agenda', [])
    if not isinstance(agenda, list) or len(agenda)>100 or any(not isinstance(text,str) or len(text)>160 for text in agenda):
        return error('invalid_meeting_agenda',400)
    refs, followups = payload.get('refs',[]), payload.get('followups',[])
    visible = lambda ref: meeting_visible_reference(workspace, request.user, ref)
    for collection in (refs,followups):
        if not isinstance(collection,list) or len(collection)>120 or not all(map(visible,collection)):
            return error('invalid_meeting_reference',400)
    if any(not item.startswith('task:') for item in followups):
        return error('invalid_meeting_followup',400)
    repeats = payload.get('repeat') == 'weekly'
    try:
        until = parse_date(payload['repeat_end']) if payload.get('repeat_end') else None
        if until and until < date:
            raise ValueError
    except (ValueError,TypeError):
        return error('invalid_series_end',400)
    request._body = json.dumps(changes).encode()
    response = operating_api.meetings(request) if create else operating_api.meeting_detail(request, meeting.pk)
    if response.status_code >= 400:
        transaction.set_rollback(True)
        return response
    result = json.loads(response.content)
    if create:
        details = WorkspaceStudioMeetingDetails(meeting_id=result['meeting']['id'])
    checked = {entry['text'] for entry in details.agenda if entry['done']}
    details.agenda=[{'text':text,'done':text in checked} for text in dict.fromkeys(t.strip() for t in agenda if t.strip())]
    details.references=list(dict.fromkeys([*(ref for ref in details.references if not visible(ref)),*refs]))
    details.followups=list(dict.fromkeys([*(ref for ref in details.followups if not visible(ref)),*followups]))
    if repeats and create:
        details.series=WorkspaceStudioMeetingSeries.objects.create(
            first_id=details.meeting_id,start=date,end=until,
            defaults={'title':title.strip(),'time':start.strftime('%H:%M'),'end':stop.strftime('%H:%M') if stop else '',
                      'owner':str(owner_id),'duration':duration,'agenda':[entry['text'] for entry in details.agenda],
                      'refs':details.references},
        )
        details.slot=date
    details.save()
    if details.series_id and details.slot:
        result['studio_id']=f'weekly:{details.series_id}:{details.slot.isoformat()}'
    return JsonResponse(result,status=response.status_code)
