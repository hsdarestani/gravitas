import json

from django.db import transaction
from django.http import JsonResponse
from django.utils.dateparse import parse_date
from django.views.decorators.http import require_http_methods

from . import operating_api as operating_base
from .models import ResearchProject
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
    if existing_task:
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
    if due_date is None:
        return _error('due_date_required')

    definition_of_done = str(payload.get('definition_of_done', '')).strip()
    if not definition_of_done:
        definition_of_done = f'“{title}” is complete and documented in GRV-{project.pk:06d}.'

    with transaction.atomic():
        core, initiative = _execution_initiative(project, request.user)
        task = OperatingTask.objects.create(
            workspace=core,
            initiative=initiative,
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
