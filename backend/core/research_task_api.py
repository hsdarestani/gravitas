import json

from django.db import transaction
from django.utils import timezone
from django.http import JsonResponse
from django.utils.dateparse import parse_date
from django.views.decorators.http import require_http_methods

from . import operating_api as operating_base
from .canonical_projects import active as canonical_active
from .models import ProjectMembership, ResearchProject
from .operating_models import (
    Initiative,
    KeyResult,
    OperatingMilestone,
    OperatingProcess,
    OperatingTask,
    Priority,
    StrategicObjective,
    WorkStatus,
)
from .platform_access import INHERIT_VISIBILITY, can_edit, can_view, policy_for
from .platform_models import ProjectAuditEvent
from .platform_runtime_v3 import ensure_platform_workspaces
from .project_cockpit import _task_json


OBJECTIVE_TITLE = 'Research project execution'
KEY_RESULT_TITLE = 'Deliver active research projects'


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _project(request, project_id, minimum='view'):
    project = ResearchProject.objects.select_related('owner', 'workspace').filter(
        pk=project_id,
        archived=False,
    ).first()
    checker = can_edit if minimum == 'edit' else can_view
    return project if project and checker(request.user, project) else None


def _execution_initiative(project, actor):
    """Return the canonical Core execution initiative for a Research project.

    Research and Core deliberately share one task object. A task or milestone
    created from Research therefore still belongs to the Core operating model
    while inheriting its project ACL from the Research project.
    """
    spaces = ensure_platform_workspaces(actor)
    core = spaces['core']
    operating_base._ensure_processes(core)
    process = OperatingProcess.objects.get(workspace=core, key=OperatingProcess.Key.RESEARCH)

    existing_task = (
        OperatingTask.objects.filter(project=project, workspace=core)
        .select_related('initiative')
        .order_by('id')
        .first()
    )
    if existing_task and existing_task.initiative_id:
        return core, existing_task.initiative

    # A milestone may be the first execution object created for a project. Reuse
    # its initiative so a later task does not fork the Core execution hierarchy
    # if the Research project title has changed meanwhile.
    existing_milestone = (
        OperatingMilestone.objects.filter(project=project, workspace=core)
        .select_related('initiative')
        .order_by('id')
        .first()
    )
    if existing_milestone:
        return core, existing_milestone.initiative

    objective = StrategicObjective.objects.filter(
        workspace=core,
        title=OBJECTIVE_TITLE,
    ).order_by('id').first()
    if not objective:
        objective = StrategicObjective.objects.create(
            workspace=core,
            title=OBJECTIVE_TITLE,
            description='Shared operating objective for task execution originating in Research projects.',
            owner=actor,
            status=WorkStatus.ACTIVE,
        )

    key_result = KeyResult.objects.filter(
        objective=objective,
        title=KEY_RESULT_TITLE,
    ).order_by('id').first()
    if not key_result:
        key_result = KeyResult.objects.create(
            objective=objective,
            title=KEY_RESULT_TITLE,
            owner=actor,
            metric_name='Project execution',
            unit='tasks',
            status=WorkStatus.ACTIVE,
        )

    title = f'GRV-{project.pk:06d} · {project.title}'[:240]
    initiative = Initiative.objects.filter(workspace=core, title=title).order_by('id').first()
    if not initiative:
        profile = getattr(project, 'platform_profile', None)
        initiative = Initiative.objects.create(
            workspace=core,
            key_result=key_result,
            process=process,
            title=title,
            description=f'Core execution container for Research project GRV-{project.pk:06d}.',
            owner=actor,
            priority=Priority.P2,
            stage=(process.flow or ['Question'])[0],
            status=WorkStatus.ACTIVE,
            due_date=getattr(profile, 'deadline', None),
        )
    return core, initiative


@require_http_methods(['GET', 'POST'])
def project_tasks(request, project_id):
    """List or create the one canonical task type from the Research surface."""
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)

    project = _project(request, project_id, 'edit' if request.method == 'POST' else 'view')
    if not project:
        return _error('permission_denied' if request.method == 'POST' else 'not_found', 403 if request.method == 'POST' else 404)

    if request.method == 'GET':
        tasks = OperatingTask.objects.filter(project=project).select_related(
            'owner',
            'initiative__process',
            'initiative__key_result__objective',
        )
        visible = [item for item in tasks if can_view(request.user, item)]
        return JsonResponse({'ok': True, 'tasks': [_task_json(item, request.user) for item in visible]})

    payload = _body(request)
    title = str(payload.get('title', '')).strip()[:240]
    if not title:
        return _error('title_required')

    priority = str(payload.get('priority', Priority.P2)).strip().lower()
    if priority not in Priority.values:
        return _error('invalid_priority')

    status = str(payload.get('status', WorkStatus.ACTIVE)).strip().lower()
    if status not in {WorkStatus.DRAFT, WorkStatus.ACTIVE, WorkStatus.BLOCKED}:
        return _error('invalid_status')

    due_date = parse_date(str(payload.get('due_date', '')).strip()) if payload.get('due_date') else None
    if payload.get('due_date') and due_date is None:
        return _error('invalid_due_date')
    if due_date is None:
        due_date = getattr(getattr(project, 'platform_profile', None), 'deadline', None)

    definition_of_done = str(payload.get('definition_of_done', '')).strip()
    if not definition_of_done:
        definition_of_done = f'“{title}” is complete and documented in GRV-{project.pk:06d}.'

    with transaction.atomic():
        # Research tasks are the SAME OperatingTask, but do not imply any KR.
        # Milestones still use the legacy execution initiative helper until
        # their own schema is made optional.
        core = ensure_platform_workspaces(request.user)['core']
        task = OperatingTask.objects.create(
            workspace=core,
            initiative=None,
            project=project,
            owner=request.user,
            title=title,
            description=str(payload.get('description', '')).strip(),
            priority=priority,
            status=status,
            due_date=due_date,
            definition_of_done=definition_of_done,
        )
        policy_for(
            task,
            create=True,
            created_by=request.user,
            default_visibility=INHERIT_VISIBILITY,
        )
        ProjectAuditEvent.objects.create(
            project=project,
            actor=request.user,
            action='task_created',
            object_type='OperatingTask',
            object_id=str(task.pk),
            detail={'title': task.title, 'status': task.status},
        )

    return JsonResponse({'ok': True, 'task': _task_json(task, request.user)}, status=201)


@require_http_methods(['PATCH'])
def project_task_detail(request, project_id, task_id):
    """Edit the existing Core/Research task, not a second project-specific copy.

    Changes pass through the canonical middleware and the existing model
    signals, so an adopted project's Nextcloud file remains authoritative.
    """
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project = _project(request, project_id, 'edit')
    if project is None:
        return _error('project_edit_required', 403)
    task = (OperatingTask.objects.select_related('owner', 'initiative', 'dependency')
            .filter(pk=task_id, project=project).first())
    if task is None or not can_edit(request.user, task):
        return _error('task_edit_required', 403)
    payload = _body(request)
    if not isinstance(payload, dict):
        return _error('invalid_payload')
    allowed = {'title', 'description', 'definition_of_done', 'status', 'priority',
               'blocked_reason', 'due_date', 'owner_id', 'dependency_id', 'parent_id'}
    if not payload or set(payload) - allowed:
        return _error('invalid_task_fields')
    # Task canonical schema v2 now serializes owner, dependency and hierarchy.
    updates = {}
    for field in ('title', 'description', 'definition_of_done', 'blocked_reason'):
        if field in payload:
            value = str(payload[field] or '').strip()
            if field in {'title', 'definition_of_done'} and not value:
                return _error('required_task_field')
            if field == 'title' and len(value) > 240:
                return _error('title_too_long')
            updates[field] = value
    if 'status' in payload:
        value = str(payload['status']).lower()
        if value not in WorkStatus.values:
            return _error('invalid_status')
        updates['status'] = value
    if 'priority' in payload:
        value = str(payload['priority']).lower()
        if value not in Priority.values:
            return _error('invalid_priority')
        updates['priority'] = value
    if 'due_date' in payload:
        value = parse_date(str(payload['due_date'] or '')) if payload['due_date'] else None
        if payload['due_date'] and value is None:
            return _error('invalid_due_date')
        if value is None and task.cycle_id is None:
            return _error('due_date_required_without_cycle')
        updates['due_date'] = value
    if 'owner_id' in payload:
        owner_id = str(payload['owner_id'] or '')
        membership = (ProjectMembership.objects
                      .filter(project=project, user_id=owner_id, user__is_active=True)
                      .select_related('user').first()) if owner_id.isdecimal() else None
        if membership is None:
            return _error('owner_must_be_project_member')
        updates['owner'] = membership.user
    if 'dependency_id' in payload:
        raw = payload['dependency_id']
        dependency = None
        if raw not in (None, ''):
            if not str(raw).isdecimal():
                return _error('invalid_dependency')
            dependency = OperatingTask.objects.filter(pk=int(raw), project=project).first()
            if dependency is None or not can_view(request.user, dependency):
                return _error('invalid_dependency')
            seen = {task.pk}
            cursor = dependency
            while cursor is not None:
                if cursor.pk in seen:
                    return _error('dependency_cycle')
                seen.add(cursor.pk)
                cursor = cursor.dependency
        updates['dependency'] = dependency
    if 'parent_id' in payload:
        if payload['parent_id'] and not str(payload['parent_id']).isdecimal():
            return _error('invalid_parent')
        parent = OperatingTask.objects.filter(pk=payload['parent_id'], project=project, workspace=task.workspace).first() if payload['parent_id'] else None
        if payload['parent_id'] and (parent is None or not can_view(request.user, parent)):
            return _error('invalid_parent')
        updates['parent'] = parent
    previous = {field: (getattr(task, field + '_id') if field in {'owner', 'dependency', 'parent'}
                         else str(getattr(task, field) or '')) for field in updates}
    with transaction.atomic():
        for field, value in updates.items():
            setattr(task, field, value)
        from django.core.exceptions import ValidationError
        try:
            task.clean()
        except ValidationError:
            return _error('invalid_task_hierarchy')
        if task.status == WorkStatus.DONE:
            task.completed_at = task.completed_at or timezone.now()
        elif 'status' in updates:
            task.completed_at = None
        task.save()
        ProjectAuditEvent.objects.create(
            project=project, actor=request.user, action='task_updated',
            object_type='OperatingTask', object_id=str(task.pk),
            detail={'fields': list(updates), 'previous': previous},
        )
    return JsonResponse({'ok': True, 'task': _task_json(task, request.user)})
