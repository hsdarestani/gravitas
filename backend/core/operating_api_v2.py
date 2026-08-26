import json

from django.db.models import Count
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import operating_api as base
from .models import ResearchProject
from .operating_models import (
    Health,
    Initiative,
    OperatingRisk,
    OperatingTask,
    OperatingWorkPackage,
    Priority,
    WorkStatus,
)


HIGH_PRIORITIES = (Priority.P0, Priority.P1)
ACTIVE_STATES = (WorkStatus.ACTIVE, WorkStatus.BLOCKED)


def _initiative_json(obj):
    data = base._initiative_json(obj)
    data['stage'] = obj.stage
    return data


def _work_package_json(obj):
    return {
        'id': obj.pk,
        'title': obj.title,
        'description': obj.description,
        'workspace_id': obj.workspace_id,
        'milestone_id': obj.milestone_id,
        'milestone_title': obj.milestone.title,
        'initiative_id': obj.milestone.initiative_id,
        'initiative_title': obj.milestone.initiative.title,
        'project_id': obj.project_id,
        'owner': base._person(obj.owner),
        'due_date': obj.due_date.isoformat() if obj.due_date else None,
        'definition_of_done': obj.definition_of_done,
        'status': obj.status,
        'task_count': getattr(obj, 'task_count', obj.tasks.count()),
    }


def _risk_json(obj):
    return {
        'id': obj.pk,
        'title': obj.title,
        'description': obj.description,
        'owner': base._person(obj.owner),
        'initiative_id': obj.initiative_id,
        'initiative_title': obj.initiative.title if obj.initiative else None,
        'project_id': obj.project_id,
        'mitigation': obj.mitigation,
        'due_date': obj.due_date.isoformat() if obj.due_date else None,
        'health': obj.health,
        'status': obj.status,
    }


def _initiative_capacity(workspace, owner, exclude_id=None):
    qs = Initiative.objects.filter(
        workspace=workspace,
        owner=owner,
        status__in=ACTIVE_STATES,
        priority__in=HIGH_PRIORITIES,
    )
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    return qs.count()


def _valid_stage(process, stage):
    if not stage:
        return process.flow[0] if process.flow else ''
    return stage if stage in (process.flow or []) else None


@require_http_methods(['GET'])
def operating_dashboard(request):
    response = base.operating_dashboard(request)
    if response.status_code != 200:
        return response
    workspace = base._workspace(request)
    if not workspace:
        return response
    data = json.loads(response.content.decode('utf-8'))
    risks = OperatingRisk.objects.filter(workspace=workspace).exclude(status__in=[WorkStatus.DONE, WorkStatus.ARCHIVED])
    work_packages = OperatingWorkPackage.objects.filter(workspace=workspace).exclude(status__in=[WorkStatus.DONE, WorkStatus.ARCHIVED])
    data['counts']['risks'] = risks.count()
    data['counts']['work_packages'] = work_packages.count()
    data['counts']['projects'] = ResearchProject.objects.filter(workspace=workspace, archived=False).count()
    data['risks'] = [_risk_json(x) for x in risks.select_related('owner', 'initiative').order_by('health', 'due_date')[:8]]
    data['capacity_warnings'] = []
    owner_load = (
        Initiative.objects.filter(
            workspace=workspace,
            status__in=ACTIVE_STATES,
            priority__in=HIGH_PRIORITIES,
        )
        .values('owner_id', 'owner__first_name', 'owner__email')
        .annotate(count=Count('id'))
        .filter(count__gte=3)
    )
    for item in owner_load:
        data['capacity_warnings'].append({
            'owner_id': item['owner_id'],
            'owner': item['owner__first_name'] or item['owner__email'],
            'active_main_priorities': item['count'],
            'state': 'over_capacity' if item['count'] > 3 else 'at_capacity',
        })
    data['projects'] = [
        {'id': p.pk, 'title': p.title}
        for p in ResearchProject.objects.filter(workspace=workspace, archived=False).order_by('title')
    ]
    return JsonResponse(data)


@require_http_methods(['GET', 'POST'])
def initiatives(request):
    if (auth := base._auth(request)):
        return auth
    payload = base._body(request) if request.method == 'POST' else {}
    workspace = base._workspace(request, payload)
    if not workspace:
        return base._error('workspace_not_found', 404)
    base._ensure_processes(workspace)
    if request.method == 'GET':
        qs = Initiative.objects.filter(workspace=workspace).select_related(
            'owner', 'process', 'key_result__objective'
        ).annotate(task_count=Count('tasks'))
        if request.GET.get('process_id'):
            qs = qs.filter(process_id=request.GET['process_id'])
        if request.GET.get('kr_id'):
            qs = qs.filter(key_result_id=request.GET['kr_id'])
        return JsonResponse({'ok': True, 'initiatives': [_initiative_json(x) for x in qs]})
    if not base._editable(request, workspace):
        return base._error('permission_denied', 403)
    kr = base.KeyResult.objects.filter(pk=payload.get('key_result_id'), objective__workspace=workspace).first()
    process = base.OperatingProcess.objects.filter(pk=payload.get('process_id'), workspace=workspace).first()
    owner = base._owner(request.user, workspace, payload.get('owner_id'))
    priority = payload.get('priority')
    if not kr or not process or not owner or not payload.get('title') or priority not in Priority.values:
        return base._error('kr_process_title_owner_and_priority_required')
    status = payload.get('status', WorkStatus.ACTIVE)
    if status in ACTIVE_STATES and priority in HIGH_PRIORITIES and _initiative_capacity(workspace, owner) >= 3:
        return base._error('capacity_limit_reached', 409, limit=3)
    stage = _valid_stage(process, payload.get('stage'))
    if stage is None:
        return base._error('invalid_process_stage')
    obj = Initiative.objects.create(
        workspace=workspace,
        key_result=kr,
        process=process,
        title=payload['title'].strip(),
        description=payload.get('description', ''),
        owner=owner,
        priority=priority,
        stage=stage,
        health=payload.get('health', Health.GREEN),
        status=status,
        start_date=base._date(payload.get('start_date')),
        due_date=base._date(payload.get('due_date')),
    )
    return JsonResponse({'ok': True, 'initiative': _initiative_json(obj)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def initiative_detail(request, initiative_id):
    if (auth := base._auth(request)):
        return auth
    obj = Initiative.objects.select_related(
        'workspace', 'owner', 'process', 'key_result__objective'
    ).filter(pk=initiative_id, workspace__in=base._accessible_workspaces(request.user)).first()
    if not obj:
        return base._error('initiative_not_found', 404)
    if not base._editable(request, obj.workspace):
        return base._error('permission_denied', 403)
    if request.method == 'DELETE':
        if obj.tasks.exists() or obj.milestones.exists():
            return base._error('initiative_not_empty', 409)
        obj.delete()
        return JsonResponse({'ok': True})
    payload = base._body(request)
    owner = obj.owner
    if 'owner_id' in payload:
        owner = base._owner(request.user, obj.workspace, payload['owner_id'])
        if not owner:
            return base._error('invalid_owner')
    priority = payload.get('priority', obj.priority)
    status = payload.get('status', obj.status)
    if status in ACTIVE_STATES and priority in HIGH_PRIORITIES and _initiative_capacity(obj.workspace, owner, obj.pk) >= 3:
        return base._error('capacity_limit_reached', 409, limit=3)
    stage = payload.get('stage', obj.stage)
    checked_stage = _valid_stage(obj.process, stage)
    if checked_stage is None:
        return base._error('invalid_process_stage')
    for field in ['title', 'description', 'health']:
        if field in payload:
            setattr(obj, field, payload[field])
    obj.owner = owner
    obj.priority = priority
    obj.status = status
    obj.stage = checked_stage
    for field in ['start_date', 'due_date']:
        if field in payload:
            setattr(obj, field, base._date(payload[field]))
    obj.save()
    return JsonResponse({'ok': True, 'initiative': _initiative_json(obj)})


@require_http_methods(['GET', 'POST'])
def work_packages(request):
    if (auth := base._auth(request)):
        return auth
    payload = base._body(request) if request.method == 'POST' else {}
    workspace = base._workspace(request, payload)
    if not workspace:
        return base._error('workspace_not_found', 404)
    if request.method == 'GET':
        qs = OperatingWorkPackage.objects.filter(workspace=workspace).select_related(
            'milestone__initiative', 'owner', 'project'
        ).annotate(task_count=Count('tasks'))
        if request.GET.get('milestone_id'):
            qs = qs.filter(milestone_id=request.GET['milestone_id'])
        return JsonResponse({'ok': True, 'work_packages': [_work_package_json(x) for x in qs]})
    if not base._editable(request, workspace):
        return base._error('permission_denied', 403)
    milestone = base.OperatingMilestone.objects.select_related('initiative').filter(
        pk=payload.get('milestone_id'), workspace=workspace
    ).first()
    owner = base._owner(request.user, workspace, payload.get('owner_id'))
    project = ResearchProject.objects.filter(pk=payload.get('project_id'), workspace=workspace).first() if payload.get('project_id') else None
    if not milestone or not owner or not payload.get('title'):
        return base._error('milestone_title_and_owner_required')
    obj = OperatingWorkPackage.objects.create(
        workspace=workspace,
        milestone=milestone,
        project=project,
        title=payload['title'].strip(),
        description=payload.get('description', ''),
        owner=owner,
        due_date=base._date(payload.get('due_date')),
        definition_of_done=payload.get('definition_of_done', ''),
        status=payload.get('status', WorkStatus.ACTIVE),
    )
    return JsonResponse({'ok': True, 'work_package': _work_package_json(obj)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def work_package_detail(request, work_package_id):
    if (auth := base._auth(request)):
        return auth
    obj = OperatingWorkPackage.objects.select_related(
        'workspace', 'milestone__initiative', 'owner', 'project'
    ).filter(pk=work_package_id, workspace__in=base._accessible_workspaces(request.user)).first()
    if not obj:
        return base._error('work_package_not_found', 404)
    if not base._editable(request, obj.workspace):
        return base._error('permission_denied', 403)
    if request.method == 'DELETE':
        if obj.tasks.exists():
            return base._error('work_package_not_empty', 409)
        obj.delete()
        return JsonResponse({'ok': True})
    payload = base._body(request)
    for field in ['title', 'description', 'definition_of_done', 'status']:
        if field in payload:
            setattr(obj, field, payload[field])
    if 'due_date' in payload:
        obj.due_date = base._date(payload['due_date'])
    if 'owner_id' in payload:
        owner = base._owner(request.user, obj.workspace, payload['owner_id'])
        if not owner:
            return base._error('invalid_owner')
        obj.owner = owner
    obj.save()
    return JsonResponse({'ok': True, 'work_package': _work_package_json(obj)})


@require_http_methods(['GET', 'POST'])
def risks(request):
    if (auth := base._auth(request)):
        return auth
    payload = base._body(request) if request.method == 'POST' else {}
    workspace = base._workspace(request, payload)
    if not workspace:
        return base._error('workspace_not_found', 404)
    if request.method == 'GET':
        qs = OperatingRisk.objects.filter(workspace=workspace).select_related('owner', 'initiative', 'project')
        return JsonResponse({'ok': True, 'risks': [_risk_json(x) for x in qs]})
    if not base._editable(request, workspace):
        return base._error('permission_denied', 403)
    owner = base._owner(request.user, workspace, payload.get('owner_id'))
    initiative = Initiative.objects.filter(pk=payload.get('initiative_id'), workspace=workspace).first() if payload.get('initiative_id') else None
    project = ResearchProject.objects.filter(pk=payload.get('project_id'), workspace=workspace).first() if payload.get('project_id') else None
    if not owner or not payload.get('title'):
        return base._error('risk_title_and_owner_required')
    obj = OperatingRisk.objects.create(
        workspace=workspace,
        initiative=initiative,
        project=project,
        title=payload['title'].strip(),
        description=payload.get('description', ''),
        owner=owner,
        mitigation=payload.get('mitigation', ''),
        due_date=base._date(payload.get('due_date')),
        health=payload.get('health', Health.YELLOW),
        status=payload.get('status', WorkStatus.ACTIVE),
    )
    return JsonResponse({'ok': True, 'risk': _risk_json(obj)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def risk_detail(request, risk_id):
    if (auth := base._auth(request)):
        return auth
    obj = OperatingRisk.objects.select_related('workspace', 'owner', 'initiative', 'project').filter(
        pk=risk_id, workspace__in=base._accessible_workspaces(request.user)
    ).first()
    if not obj:
        return base._error('risk_not_found', 404)
    if not base._editable(request, obj.workspace):
        return base._error('permission_denied', 403)
    if request.method == 'DELETE':
        obj.delete()
        return JsonResponse({'ok': True})
    payload = base._body(request)
    for field in ['title', 'description', 'mitigation', 'health', 'status']:
        if field in payload:
            setattr(obj, field, payload[field])
    if 'due_date' in payload:
        obj.due_date = base._date(payload['due_date'])
    if 'owner_id' in payload:
        owner = base._owner(request.user, obj.workspace, payload['owner_id'])
        if not owner:
            return base._error('invalid_owner')
        obj.owner = owner
    obj.save()
    return JsonResponse({'ok': True, 'risk': _risk_json(obj)})


@require_http_methods(['GET', 'POST'])
def tasks(request):
    if (auth := base._auth(request)):
        return auth
    payload = base._body(request) if request.method == 'POST' else {}
    workspace = base._workspace(request, payload)
    if not workspace:
        return base._error('workspace_not_found', 404)
    if request.method == 'GET':
        qs = OperatingTask.objects.filter(workspace=workspace).select_related(
            'owner', 'initiative__process', 'initiative__key_result__objective', 'work_package'
        )
        for key in ['status', 'priority', 'owner_id', 'initiative_id', 'cycle_id', 'work_package_id', 'meeting_id']:
            if request.GET.get(key):
                qs = qs.filter(**{key: request.GET[key]})
        data = []
        for obj in qs:
            item = base._task_json(obj)
            item['work_package_id'] = obj.work_package_id
            item['work_package_title'] = obj.work_package.title if obj.work_package else None
            data.append(item)
        return JsonResponse({'ok': True, 'tasks': data})
    if not base._editable(request, workspace):
        return base._error('permission_denied', 403)
    initiative = Initiative.objects.select_related('key_result__objective', 'process').filter(
        pk=payload.get('initiative_id'), workspace=workspace
    ).first()
    owner = base._owner(request.user, workspace, payload.get('owner_id'))
    priority = payload.get('priority')
    due_date = base._date(payload.get('due_date'))
    cycle = base.OperatingCycle.objects.filter(pk=payload.get('cycle_id'), workspace=workspace).first() if payload.get('cycle_id') else None
    meeting = base.OperatingMeeting.objects.filter(pk=payload.get('meeting_id'), workspace=workspace).first() if payload.get('meeting_id') else None
    if not initiative or not owner or not payload.get('title') or not payload.get('definition_of_done') or priority not in Priority.values:
        return base._error('task_requires_title_owner_initiative_priority_and_done_definition')
    if not cycle and not due_date:
        return base._error('task_requires_cycle_or_due_date')
    if meeting and not due_date:
        return base._error('meeting_action_requires_deadline')
    milestone = base.OperatingMilestone.objects.filter(
        pk=payload.get('milestone_id'), workspace=workspace, initiative=initiative
    ).first() if payload.get('milestone_id') else None
    work_package = OperatingWorkPackage.objects.select_related('milestone').filter(
        pk=payload.get('work_package_id'), workspace=workspace, milestone__initiative=initiative
    ).first() if payload.get('work_package_id') else None
    if work_package and milestone and work_package.milestone_id != milestone.pk:
        return base._error('work_package_milestone_mismatch')
    if work_package and not milestone:
        milestone = work_package.milestone
    project = ResearchProject.objects.filter(pk=payload.get('project_id'), workspace=workspace).first() if payload.get('project_id') else None
    dependency = OperatingTask.objects.filter(pk=payload.get('dependency_id'), workspace=workspace).first() if payload.get('dependency_id') else None
    obj = OperatingTask.objects.create(
        workspace=workspace,
        initiative=initiative,
        milestone=milestone,
        work_package=work_package,
        cycle=cycle,
        project=project,
        meeting=meeting,
        owner=owner,
        title=payload['title'].strip(),
        description=payload.get('description', ''),
        priority=priority,
        status=payload.get('status', WorkStatus.ACTIVE),
        due_date=due_date,
        definition_of_done=payload['definition_of_done'].strip(),
        dependency=dependency,
        blocked_reason=payload.get('blocked_reason', ''),
    )
    item = base._task_json(obj)
    item['work_package_id'] = obj.work_package_id
    item['work_package_title'] = obj.work_package.title if obj.work_package else None
    return JsonResponse({'ok': True, 'task': item}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def task_detail(request, task_id):
    if (auth := base._auth(request)):
        return auth
    obj = OperatingTask.objects.select_related(
        'workspace', 'owner', 'initiative__process', 'initiative__key_result__objective', 'work_package'
    ).filter(pk=task_id, workspace__in=base._accessible_workspaces(request.user)).first()
    if not obj:
        return base._error('task_not_found', 404)
    if not base._editable(request, obj.workspace):
        return base._error('permission_denied', 403)
    if request.method == 'DELETE':
        obj.delete()
        return JsonResponse({'ok': True})
    payload = base._body(request)
    owner = obj.owner
    if 'owner_id' in payload:
        owner = base._owner(request.user, obj.workspace, payload['owner_id'])
        if not owner:
            return base._error('invalid_owner')
    due_date = base._date(payload['due_date']) if 'due_date' in payload else obj.due_date
    cycle = obj.cycle
    if 'cycle_id' in payload:
        cycle = base.OperatingCycle.objects.filter(pk=payload.get('cycle_id'), workspace=obj.workspace).first() if payload.get('cycle_id') else None
    if not cycle and not due_date:
        return base._error('task_requires_cycle_or_due_date')
    meeting = obj.meeting
    if 'meeting_id' in payload:
        meeting = base.OperatingMeeting.objects.filter(pk=payload.get('meeting_id'), workspace=obj.workspace).first() if payload.get('meeting_id') else None
    if meeting and not due_date:
        return base._error('meeting_action_requires_deadline')
    for field in ['title', 'description', 'priority', 'status', 'definition_of_done', 'blocked_reason']:
        if field in payload:
            setattr(obj, field, payload[field])
    obj.owner = owner
    obj.due_date = due_date
    obj.cycle = cycle
    obj.meeting = meeting
    if payload.get('status') == WorkStatus.DONE and not obj.completed_at:
        obj.completed_at = base.timezone.now()
    if payload.get('status') and payload.get('status') != WorkStatus.DONE:
        obj.completed_at = None
    obj.save()
    item = base._task_json(obj)
    item['work_package_id'] = obj.work_package_id
    item['work_package_title'] = obj.work_package.title if obj.work_package else None
    return JsonResponse({'ok': True, 'task': item})
