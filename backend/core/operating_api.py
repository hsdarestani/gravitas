import json
from datetime import date
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Count, Q
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.views.decorators.http import require_http_methods

from .models import ResearchProject, WorkspaceMembership
from .operating_models import (
    Health,
    Initiative,
    KeyResult,
    OperatingCycle,
    OperatingMeeting,
    OperatingMilestone,
    OperatingProcess,
    OperatingTask,
    Priority,
    StrategicObjective,
    WorkStatus,
)
from .workspace_api import _accessible_workspaces, _can_edit_workspace, _workspace_for


PROCESS_DEFAULTS = {
    'content': {
        'name': 'Media & Content',
        'flow': ['Idea Selection', 'Research', 'Brief', 'Script', 'Scientific Review', 'Production', 'QA', 'Publish', 'Analytics'],
        'cadence': ['Saturday · Editorial Content & priorities', 'During week · Parallel pipeline', 'Thursday · Final Review when output is ready'],
        'kpis': ['Monthly output', 'Cycle Time', 'On-time Publish', 'Retention / Engagement'],
    },
    'research': {
        'name': 'Scientific Research',
        'flow': ['Question', 'Scope', 'Sources / Data', 'Analysis', 'Synthesis', 'Review', 'Research Output', 'Knowledge Base'],
        'cadence': ['Saturday · Research portfolio prioritization', 'Wednesday · Scientific Review', 'Month end · Continue / Stop / Publish / Reuse'],
        'kpis': ['Research Cycle Time', 'Review Quality', 'Reuse Rate', 'Research converted to Content / Project / Product'],
    },
    'commercial': {
        'name': 'Commercial Scientific Projects',
        'flow': ['Lead', 'Qualification', 'Scope', 'Proposal', 'Approval', 'Kickoff', 'Milestones', 'Execution', 'QA', 'Delivery', 'Invoice', 'Retrospective'],
        'cadence': ['Saturday · Active Project Review', 'Every milestone · Stakeholder / Client Review', 'Project end · Delivery + Invoice + Retrospective'],
        'kpis': ['Revenue', 'Margin', 'On-time Milestones', 'Scope Creep', 'Client Satisfaction'],
    },
    'technology': {
        'name': 'Technology & Infrastructure',
        'flow': ['Backlog', 'Prioritize', 'Spec', 'Build', 'Review', 'Test', 'Release', 'Monitor'],
        'cadence': ['Biweekly sprint', 'Sprint start · Planning', 'Mid sprint · Check', 'Sprint end · QA / Release / Review', 'Critical incidents · Immediate'],
        'kpis': ['Lead Time', 'Sprint Predictability', 'Deployment Success', 'Uptime', 'Recovery Time'],
    },
    'operations': {
        'name': 'Operations / Management',
        'flow': ['OKR Alignment', 'Portfolio', 'Capacity / WIP', 'Milestones', 'Risks', 'Dependencies', 'Meetings', 'Follow-up'],
        'cadence': ['Weekly · Portfolio & Priority Review', 'Monthly · Operating Review', 'Quarterly · Strategy & OKR Review'],
        'kpis': ['KR On Track %', 'Initiative On Track %', 'Open Blockers', 'WIP', 'On-time Milestones'],
    },
}

MEETING_CALENDAR = [
    {'kind': 'weekly_gravitas', 'name': 'Gravitas Weekly', 'cadence': 'Every Saturday', 'purpose': 'Portfolio health, previous commitments, blockers, decisions, weekly priorities and OKR progress'},
    {'kind': 'content_editorial', 'name': 'Content Editorial', 'cadence': 'Every Saturday', 'purpose': 'Topics, pipeline, owners and weekly outputs'},
    {'kind': 'active_project_review', 'name': 'Active Project Review', 'cadence': 'Saturday when needed', 'purpose': 'Only active scientific / commercial projects'},
    {'kind': 'scientific_review', 'name': 'Scientific Review', 'cadence': 'Every Wednesday', 'purpose': 'Research and scientific outputs ready for decision'},
    {'kind': 'tech_sprint', 'name': 'Tech Sprint Planning / Review', 'cadence': 'Every two weeks', 'purpose': 'Sprint plan, QA, delivery and release'},
    {'kind': 'monthly_operating_review', 'name': 'Monthly Operating Review', 'cadence': 'Last Saturday of month', 'purpose': 'Revenue, portfolio, content, research, tech, capacity, risks, OKR and process improvements'},
    {'kind': 'okr_planning', 'name': 'Strategy & OKR Planning', 'cadence': 'Quarter start', 'purpose': 'Objectives, KRs, initiatives, owners and quarterly capacity'},
    {'kind': 'okr_review', 'name': 'OKR Review & Retrospective', 'cadence': 'Quarter end', 'purpose': 'KR scoring, Stop / Continue / Change, lessons learned and next quarter'},
]


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _auth(request):
    return _error('authentication_required', 401) if not request.user.is_authenticated else None


def _workspace(request, payload=None):
    raw = (payload or {}).get('workspace_id') or request.GET.get('workspace_id')
    try:
        workspace_id = int(raw) if raw else None
    except (TypeError, ValueError):
        return None
    return _workspace_for(request.user, workspace_id)


def _date(value):
    return parse_date(value) if value else None


def _datetime(value):
    return parse_datetime(value) if value else None


def _decimal(value):
    if value in ('', None):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _owner(user, workspace, owner_id=None):
    if not owner_id or int(owner_id) == user.pk:
        return user
    member = WorkspaceMembership.objects.filter(workspace=workspace, user_id=owner_id).select_related('user').first()
    return member.user if member else None


def _ensure_processes(workspace):
    for key, spec in PROCESS_DEFAULTS.items():
        OperatingProcess.objects.get_or_create(
            workspace=workspace,
            key=key,
            defaults={'name': spec['name'], 'flow': spec['flow'], 'cadence': spec['cadence'], 'kpis': spec['kpis']},
        )


def _person(user):
    return {'id': user.pk, 'name': user.get_full_name() or user.email, 'email': user.email}


def _process_json(obj):
    return {'id': obj.pk, 'key': obj.key, 'name': obj.name, 'owner': _person(obj.owner) if obj.owner else None, 'flow': obj.flow, 'cadence': obj.cadence, 'kpis': obj.kpis, 'active': obj.active}


def _objective_json(obj):
    return {
        'id': obj.pk, 'title': obj.title, 'description': obj.description, 'owner': _person(obj.owner),
        'quarter': obj.quarter, 'start_date': obj.start_date.isoformat() if obj.start_date else None,
        'due_date': obj.due_date.isoformat() if obj.due_date else None, 'health': obj.health, 'status': obj.status,
        'key_result_count': getattr(obj, 'key_result_count', obj.key_results.count()),
    }


def _kr_progress(obj):
    if obj.target_value is None or obj.current_value is None:
        return None
    baseline = obj.baseline_value or Decimal('0')
    span = obj.target_value - baseline
    if span == 0:
        return 100 if obj.current_value >= obj.target_value else 0
    return max(0, min(100, round(float((obj.current_value - baseline) / span * 100), 1)))


def _kr_json(obj):
    return {
        'id': obj.pk, 'objective_id': obj.objective_id, 'objective_title': obj.objective.title,
        'title': obj.title, 'owner': _person(obj.owner), 'metric_name': obj.metric_name, 'unit': obj.unit,
        'baseline_value': str(obj.baseline_value) if obj.baseline_value is not None else None,
        'target_value': str(obj.target_value) if obj.target_value is not None else None,
        'current_value': str(obj.current_value) if obj.current_value is not None else None,
        'progress': _kr_progress(obj), 'confidence': obj.confidence,
        'due_date': obj.due_date.isoformat() if obj.due_date else None, 'health': obj.health, 'status': obj.status,
    }


def _initiative_json(obj):
    return {
        'id': obj.pk, 'title': obj.title, 'description': obj.description, 'owner': _person(obj.owner),
        'priority': obj.priority, 'health': obj.health, 'status': obj.status,
        'start_date': obj.start_date.isoformat() if obj.start_date else None, 'due_date': obj.due_date.isoformat() if obj.due_date else None,
        'process': {'id': obj.process_id, 'key': obj.process.key, 'name': obj.process.name},
        'key_result': {'id': obj.key_result_id, 'title': obj.key_result.title},
        'objective': {'id': obj.key_result.objective_id, 'title': obj.key_result.objective.title},
        'task_count': getattr(obj, 'task_count', obj.tasks.count()),
    }


def _cycle_json(obj):
    return {'id': obj.pk, 'name': obj.name, 'cadence': obj.cadence, 'owner': _person(obj.owner), 'process': {'id': obj.process_id, 'name': obj.process.name, 'key': obj.process.key}, 'start_date': obj.start_date.isoformat(), 'end_date': obj.end_date.isoformat(), 'status': obj.status}


def _milestone_json(obj):
    return {'id': obj.pk, 'title': obj.title, 'initiative_id': obj.initiative_id, 'initiative_title': obj.initiative.title, 'owner': _person(obj.owner), 'cycle_id': obj.cycle_id, 'project_id': obj.project_id, 'due_date': obj.due_date.isoformat() if obj.due_date else None, 'definition_of_done': obj.definition_of_done, 'health': obj.health, 'status': obj.status}


def _meeting_json(obj):
    return {'id': obj.pk, 'kind': obj.kind, 'title': obj.title, 'scheduled_for': obj.scheduled_for.isoformat(), 'duration_minutes': obj.duration_minutes, 'owner': _person(obj.owner), 'process_id': obj.process_id, 'decisions': obj.decisions, 'notes': obj.notes, 'status': obj.status, 'action_item_count': getattr(obj, 'action_item_count', obj.action_items.count())}


def _task_json(obj):
    trace = {
        'objective': {'id': obj.initiative.key_result.objective_id, 'title': obj.initiative.key_result.objective.title},
        'key_result': {'id': obj.initiative.key_result_id, 'title': obj.initiative.key_result.title},
        'initiative': {'id': obj.initiative_id, 'title': obj.initiative.title},
        'process': {'id': obj.initiative.process_id, 'key': obj.initiative.process.key, 'name': obj.initiative.process.name},
    }
    return {
        'id': obj.pk, 'title': obj.title, 'description': obj.description, 'owner': _person(obj.owner),
        'priority': obj.priority, 'status': obj.status, 'due_date': obj.due_date.isoformat() if obj.due_date else None,
        'definition_of_done': obj.definition_of_done, 'blocked_reason': obj.blocked_reason,
        'dependency_id': obj.dependency_id, 'milestone_id': obj.milestone_id, 'cycle_id': obj.cycle_id,
        'project_id': obj.project_id, 'meeting_id': obj.meeting_id, 'trace': trace,
    }


def _editable(request, workspace):
    return workspace and _can_edit_workspace(request.user, workspace)


@require_http_methods(['GET'])
def operating_dashboard(request):
    if (auth := _auth(request)): return auth
    workspace = _workspace(request)
    if not workspace: return _error('workspace_not_found', 404)
    _ensure_processes(workspace)
    objectives = StrategicObjective.objects.filter(workspace=workspace, status=WorkStatus.ACTIVE)
    krs = KeyResult.objects.filter(objective__workspace=workspace, status=WorkStatus.ACTIVE)
    initiatives = Initiative.objects.filter(workspace=workspace, status=WorkStatus.ACTIVE)
    tasks = OperatingTask.objects.filter(workspace=workspace).exclude(status__in=[WorkStatus.DONE, WorkStatus.ARCHIVED])
    milestones = OperatingMilestone.objects.filter(workspace=workspace).exclude(status__in=[WorkStatus.DONE, WorkStatus.ARCHIVED])
    owner_load = list(tasks.filter(priority__in=[Priority.P0, Priority.P1]).values('owner_id', 'owner__first_name', 'owner__email').annotate(count=Count('id')).filter(count__gt=3))
    members = [_person(m.user) | {'role': m.role} for m in workspace.memberships.select_related('user').all()]
    return JsonResponse({
        'ok': True, 'workspace': {'id': workspace.pk, 'name': workspace.name}, 'members': members,
        'counts': {
            'objectives': objectives.count(), 'key_results': krs.count(), 'initiatives': initiatives.count(),
            'blockers': tasks.filter(Q(status=WorkStatus.BLOCKED) | ~Q(blocked_reason='')).count(),
            'tasks': tasks.count(), 'milestones': milestones.count(),
        },
        'health': {
            'key_results': {h: krs.filter(health=h).count() for h in [Health.GREEN, Health.YELLOW, Health.RED]},
            'initiatives': {h: initiatives.filter(health=h).count() for h in [Health.GREEN, Health.YELLOW, Health.RED]},
        },
        'processes': [_process_json(x) for x in OperatingProcess.objects.filter(workspace=workspace)],
        'recent_initiatives': [_initiative_json(x) for x in initiatives.select_related('process', 'key_result__objective', 'owner').annotate(task_count=Count('tasks'))[:8]],
        'priority_tasks': [_task_json(x) for x in tasks.select_related('owner', 'initiative__process', 'initiative__key_result__objective').order_by('priority', 'due_date')[:10]],
        'upcoming_milestones': [_milestone_json(x) for x in milestones.select_related('initiative', 'owner').order_by('due_date')[:8]],
        'capacity_warnings': [{'owner_id': x['owner_id'], 'owner': x['owner__first_name'] or x['owner__email'], 'high_priority_active': x['count']} for x in owner_load],
        'meeting_calendar': MEETING_CALENDAR,
    })


@require_http_methods(['GET', 'POST'])
def processes(request):
    if (auth := _auth(request)): return auth
    payload = _body(request) if request.method == 'POST' else None
    workspace = _workspace(request, payload)
    if not workspace: return _error('workspace_not_found', 404)
    _ensure_processes(workspace)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'processes': [_process_json(x) for x in OperatingProcess.objects.filter(workspace=workspace).select_related('owner')]})
    return _error('fixed_process_architecture', 405)


@require_http_methods(['PATCH'])
def process_detail(request, process_id):
    if (auth := _auth(request)): return auth
    obj = OperatingProcess.objects.select_related('workspace').filter(pk=process_id, workspace__in=_accessible_workspaces(request.user)).first()
    if not obj: return _error('process_not_found', 404)
    if not _editable(request, obj.workspace): return _error('permission_denied', 403)
    p = _body(request)
    if 'owner_id' in p:
        owner = _owner(request.user, obj.workspace, p.get('owner_id'))
        if p.get('owner_id') and not owner: return _error('invalid_owner')
        obj.owner = owner
    for field in ['name', 'flow', 'cadence', 'kpis', 'active']:
        if field in p: setattr(obj, field, p[field])
    obj.save()
    return JsonResponse({'ok': True, 'process': _process_json(obj)})


@require_http_methods(['GET', 'POST'])
def objectives(request):
    if (auth := _auth(request)): return auth
    p = _body(request) if request.method == 'POST' else {}
    workspace = _workspace(request, p)
    if not workspace: return _error('workspace_not_found', 404)
    if request.method == 'GET':
        qs = StrategicObjective.objects.filter(workspace=workspace).select_related('owner').annotate(key_result_count=Count('key_results'))
        return JsonResponse({'ok': True, 'objectives': [_objective_json(x) for x in qs]})
    if not _editable(request, workspace): return _error('permission_denied', 403)
    owner = _owner(request.user, workspace, p.get('owner_id'))
    if not p.get('title') or not owner: return _error('title_and_owner_required')
    obj = StrategicObjective.objects.create(workspace=workspace, title=p['title'].strip(), description=p.get('description', ''), owner=owner, quarter=p.get('quarter', ''), start_date=_date(p.get('start_date')), due_date=_date(p.get('due_date')), health=p.get('health', Health.GREEN), status=p.get('status', WorkStatus.ACTIVE))
    return JsonResponse({'ok': True, 'objective': _objective_json(obj)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def objective_detail(request, objective_id):
    if (auth := _auth(request)): return auth
    obj = StrategicObjective.objects.select_related('workspace', 'owner').filter(pk=objective_id, workspace__in=_accessible_workspaces(request.user)).first()
    if not obj: return _error('objective_not_found', 404)
    if not _editable(request, obj.workspace): return _error('permission_denied', 403)
    if request.method == 'DELETE':
        if obj.key_results.exists(): return _error('objective_not_empty', 409)
        obj.delete(); return JsonResponse({'ok': True})
    p = _body(request)
    for field in ['title', 'description', 'quarter', 'health', 'status']:
        if field in p: setattr(obj, field, p[field])
    for field in ['start_date', 'due_date']:
        if field in p: setattr(obj, field, _date(p[field]))
    if 'owner_id' in p:
        owner = _owner(request.user, obj.workspace, p['owner_id'])
        if not owner: return _error('invalid_owner')
        obj.owner = owner
    obj.save(); return JsonResponse({'ok': True, 'objective': _objective_json(obj)})


@require_http_methods(['GET', 'POST'])
def key_results(request):
    if (auth := _auth(request)): return auth
    p = _body(request) if request.method == 'POST' else {}
    workspace = _workspace(request, p)
    if not workspace: return _error('workspace_not_found', 404)
    if request.method == 'GET':
        qs = KeyResult.objects.filter(objective__workspace=workspace).select_related('objective', 'owner')
        if request.GET.get('objective_id'): qs = qs.filter(objective_id=request.GET['objective_id'])
        return JsonResponse({'ok': True, 'key_results': [_kr_json(x) for x in qs]})
    if not _editable(request, workspace): return _error('permission_denied', 403)
    objective = StrategicObjective.objects.filter(pk=p.get('objective_id'), workspace=workspace).first()
    owner = _owner(request.user, workspace, p.get('owner_id'))
    if not objective or not owner or not p.get('title'): return _error('objective_title_and_owner_required')
    obj = KeyResult.objects.create(objective=objective, title=p['title'].strip(), owner=owner, metric_name=p.get('metric_name', ''), unit=p.get('unit', ''), baseline_value=_decimal(p.get('baseline_value')), target_value=_decimal(p.get('target_value')), current_value=_decimal(p.get('current_value')), confidence=max(0, min(100, int(p.get('confidence', 100)))), due_date=_date(p.get('due_date')), health=p.get('health', Health.GREEN), status=p.get('status', WorkStatus.ACTIVE))
    return JsonResponse({'ok': True, 'key_result': _kr_json(obj)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def key_result_detail(request, kr_id):
    if (auth := _auth(request)): return auth
    obj = KeyResult.objects.select_related('objective__workspace', 'objective', 'owner').filter(pk=kr_id, objective__workspace__in=_accessible_workspaces(request.user)).first()
    if not obj: return _error('key_result_not_found', 404)
    workspace = obj.objective.workspace
    if not _editable(request, workspace): return _error('permission_denied', 403)
    if request.method == 'DELETE':
        if obj.initiatives.exists(): return _error('key_result_not_empty', 409)
        obj.delete(); return JsonResponse({'ok': True})
    p = _body(request)
    for field in ['title', 'metric_name', 'unit', 'health', 'status']:
        if field in p: setattr(obj, field, p[field])
    for field in ['baseline_value', 'target_value', 'current_value']:
        if field in p: setattr(obj, field, _decimal(p[field]))
    if 'confidence' in p: obj.confidence = max(0, min(100, int(p['confidence'])))
    if 'due_date' in p: obj.due_date = _date(p['due_date'])
    if 'owner_id' in p:
        owner = _owner(request.user, workspace, p['owner_id'])
        if not owner: return _error('invalid_owner')
        obj.owner = owner
    obj.save(); return JsonResponse({'ok': True, 'key_result': _kr_json(obj)})


@require_http_methods(['GET', 'POST'])
def initiatives(request):
    if (auth := _auth(request)): return auth
    p = _body(request) if request.method == 'POST' else {}
    workspace = _workspace(request, p)
    if not workspace: return _error('workspace_not_found', 404)
    _ensure_processes(workspace)
    if request.method == 'GET':
        qs = Initiative.objects.filter(workspace=workspace).select_related('owner', 'process', 'key_result__objective').annotate(task_count=Count('tasks'))
        if request.GET.get('process_id'): qs = qs.filter(process_id=request.GET['process_id'])
        if request.GET.get('kr_id'): qs = qs.filter(key_result_id=request.GET['kr_id'])
        return JsonResponse({'ok': True, 'initiatives': [_initiative_json(x) for x in qs]})
    if not _editable(request, workspace): return _error('permission_denied', 403)
    kr = KeyResult.objects.filter(pk=p.get('key_result_id'), objective__workspace=workspace).first()
    process = OperatingProcess.objects.filter(pk=p.get('process_id'), workspace=workspace).first()
    owner = _owner(request.user, workspace, p.get('owner_id'))
    if not kr or not process or not owner or not p.get('title'): return _error('kr_process_title_and_owner_required')
    obj = Initiative.objects.create(workspace=workspace, key_result=kr, process=process, title=p['title'].strip(), description=p.get('description', ''), owner=owner, priority=p.get('priority', Priority.P2), health=p.get('health', Health.GREEN), status=p.get('status', WorkStatus.ACTIVE), start_date=_date(p.get('start_date')), due_date=_date(p.get('due_date')))
    return JsonResponse({'ok': True, 'initiative': _initiative_json(obj)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def initiative_detail(request, initiative_id):
    if (auth := _auth(request)): return auth
    obj = Initiative.objects.select_related('workspace', 'owner', 'process', 'key_result__objective').filter(pk=initiative_id, workspace__in=_accessible_workspaces(request.user)).first()
    if not obj: return _error('initiative_not_found', 404)
    if not _editable(request, obj.workspace): return _error('permission_denied', 403)
    if request.method == 'DELETE':
        if obj.tasks.exists() or obj.milestones.exists(): return _error('initiative_not_empty', 409)
        obj.delete(); return JsonResponse({'ok': True})
    p = _body(request)
    for field in ['title', 'description', 'priority', 'health', 'status']:
        if field in p: setattr(obj, field, p[field])
    for field in ['start_date', 'due_date']:
        if field in p: setattr(obj, field, _date(p[field]))
    if 'owner_id' in p:
        owner = _owner(request.user, obj.workspace, p['owner_id'])
        if not owner: return _error('invalid_owner')
        obj.owner = owner
    obj.save(); return JsonResponse({'ok': True, 'initiative': _initiative_json(obj)})


@require_http_methods(['GET', 'POST'])
def cycles(request):
    if (auth := _auth(request)): return auth
    p = _body(request) if request.method == 'POST' else {}
    workspace = _workspace(request, p)
    if not workspace: return _error('workspace_not_found', 404)
    if request.method == 'GET':
        qs = OperatingCycle.objects.filter(workspace=workspace).select_related('process', 'owner')
        return JsonResponse({'ok': True, 'cycles': [_cycle_json(x) for x in qs]})
    if not _editable(request, workspace): return _error('permission_denied', 403)
    process = OperatingProcess.objects.filter(pk=p.get('process_id'), workspace=workspace).first()
    owner = _owner(request.user, workspace, p.get('owner_id'))
    start, end = _date(p.get('start_date')), _date(p.get('end_date'))
    if not process or not owner or not p.get('name') or not start or not end or end < start: return _error('invalid_cycle')
    obj = OperatingCycle.objects.create(workspace=workspace, process=process, name=p['name'].strip(), cadence=p.get('cadence', OperatingCycle.Cadence.BIWEEKLY), owner=owner, start_date=start, end_date=end, status=p.get('status', WorkStatus.ACTIVE))
    return JsonResponse({'ok': True, 'cycle': _cycle_json(obj)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def cycle_detail(request, cycle_id):
    if (auth := _auth(request)): return auth
    obj = OperatingCycle.objects.select_related('workspace', 'process', 'owner').filter(pk=cycle_id, workspace__in=_accessible_workspaces(request.user)).first()
    if not obj: return _error('cycle_not_found', 404)
    if not _editable(request, obj.workspace): return _error('permission_denied', 403)
    if request.method == 'DELETE':
        if obj.tasks.exists() or obj.milestones.exists(): return _error('cycle_not_empty', 409)
        obj.delete(); return JsonResponse({'ok': True})
    p = _body(request)
    for field in ['name', 'cadence', 'status']:
        if field in p: setattr(obj, field, p[field])
    for field in ['start_date', 'end_date']:
        if field in p: setattr(obj, field, _date(p[field]))
    obj.save(); return JsonResponse({'ok': True, 'cycle': _cycle_json(obj)})


@require_http_methods(['GET', 'POST'])
def milestones(request):
    if (auth := _auth(request)): return auth
    p = _body(request) if request.method == 'POST' else {}
    workspace = _workspace(request, p)
    if not workspace: return _error('workspace_not_found', 404)
    if request.method == 'GET':
        qs = OperatingMilestone.objects.filter(workspace=workspace).select_related('initiative', 'owner')
        return JsonResponse({'ok': True, 'milestones': [_milestone_json(x) for x in qs]})
    if not _editable(request, workspace): return _error('permission_denied', 403)
    initiative = Initiative.objects.filter(pk=p.get('initiative_id'), workspace=workspace).first()
    owner = _owner(request.user, workspace, p.get('owner_id'))
    cycle = OperatingCycle.objects.filter(pk=p.get('cycle_id'), workspace=workspace).first() if p.get('cycle_id') else None
    project = ResearchProject.objects.filter(pk=p.get('project_id'), workspace=workspace).first() if p.get('project_id') else None
    if not initiative or not owner or not p.get('title'): return _error('initiative_title_and_owner_required')
    obj = OperatingMilestone.objects.create(workspace=workspace, initiative=initiative, cycle=cycle, project=project, title=p['title'].strip(), owner=owner, due_date=_date(p.get('due_date')), definition_of_done=p.get('definition_of_done', ''), health=p.get('health', Health.GREEN), status=p.get('status', WorkStatus.ACTIVE))
    return JsonResponse({'ok': True, 'milestone': _milestone_json(obj)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def milestone_detail(request, milestone_id):
    if (auth := _auth(request)): return auth
    obj = OperatingMilestone.objects.select_related('workspace', 'initiative', 'owner').filter(pk=milestone_id, workspace__in=_accessible_workspaces(request.user)).first()
    if not obj: return _error('milestone_not_found', 404)
    if not _editable(request, obj.workspace): return _error('permission_denied', 403)
    if request.method == 'DELETE':
        if obj.tasks.exists(): return _error('milestone_not_empty', 409)
        obj.delete(); return JsonResponse({'ok': True})
    p = _body(request)
    for field in ['title', 'definition_of_done', 'health', 'status']:
        if field in p: setattr(obj, field, p[field])
    if 'due_date' in p: obj.due_date = _date(p['due_date'])
    obj.save(); return JsonResponse({'ok': True, 'milestone': _milestone_json(obj)})


@require_http_methods(['GET', 'POST'])
def meetings(request):
    if (auth := _auth(request)): return auth
    p = _body(request) if request.method == 'POST' else {}
    workspace = _workspace(request, p)
    if not workspace: return _error('workspace_not_found', 404)
    if request.method == 'GET':
        qs = OperatingMeeting.objects.filter(workspace=workspace).select_related('owner', 'process').annotate(action_item_count=Count('action_items'))
        return JsonResponse({'ok': True, 'meetings': [_meeting_json(x) for x in qs], 'calendar': MEETING_CALENDAR})
    if not _editable(request, workspace): return _error('permission_denied', 403)
    owner = _owner(request.user, workspace, p.get('owner_id'))
    scheduled = _datetime(p.get('scheduled_for'))
    process = OperatingProcess.objects.filter(pk=p.get('process_id'), workspace=workspace).first() if p.get('process_id') else None
    if not owner or not scheduled or not p.get('title') or not p.get('kind'): return _error('invalid_meeting')
    obj = OperatingMeeting.objects.create(workspace=workspace, process=process, kind=p['kind'], title=p['title'].strip(), scheduled_for=scheduled, duration_minutes=int(p.get('duration_minutes', 60)), owner=owner, decisions=p.get('decisions', ''), notes=p.get('notes', ''), status=p.get('status', WorkStatus.ACTIVE))
    return JsonResponse({'ok': True, 'meeting': _meeting_json(obj)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def meeting_detail(request, meeting_id):
    if (auth := _auth(request)): return auth
    obj = OperatingMeeting.objects.select_related('workspace', 'owner', 'process').filter(pk=meeting_id, workspace__in=_accessible_workspaces(request.user)).first()
    if not obj: return _error('meeting_not_found', 404)
    if not _editable(request, obj.workspace): return _error('permission_denied', 403)
    if request.method == 'DELETE':
        if obj.action_items.exists(): return _error('meeting_has_action_items', 409)
        obj.delete(); return JsonResponse({'ok': True})
    p = _body(request)
    for field in ['kind', 'title', 'decisions', 'notes', 'status']:
        if field in p: setattr(obj, field, p[field])
    if 'scheduled_for' in p: obj.scheduled_for = _datetime(p['scheduled_for'])
    if 'duration_minutes' in p: obj.duration_minutes = int(p['duration_minutes'])
    obj.save(); return JsonResponse({'ok': True, 'meeting': _meeting_json(obj)})


@require_http_methods(['GET', 'POST'])
def tasks(request):
    if (auth := _auth(request)): return auth
    p = _body(request) if request.method == 'POST' else {}
    workspace = _workspace(request, p)
    if not workspace: return _error('workspace_not_found', 404)
    if request.method == 'GET':
        qs = OperatingTask.objects.filter(workspace=workspace).select_related('owner', 'initiative__process', 'initiative__key_result__objective')
        for key in ['status', 'priority', 'owner_id', 'initiative_id', 'cycle_id']:
            if request.GET.get(key): qs = qs.filter(**{key: request.GET[key]})
        return JsonResponse({'ok': True, 'tasks': [_task_json(x) for x in qs]})
    if not _editable(request, workspace): return _error('permission_denied', 403)
    initiative = Initiative.objects.select_related('key_result__objective', 'process').filter(pk=p.get('initiative_id'), workspace=workspace).first()
    owner = _owner(request.user, workspace, p.get('owner_id'))
    if not initiative or not owner or not p.get('title') or not p.get('definition_of_done'): return _error('task_requires_title_owner_initiative_and_done_definition')
    milestone = OperatingMilestone.objects.filter(pk=p.get('milestone_id'), workspace=workspace, initiative=initiative).first() if p.get('milestone_id') else None
    cycle = OperatingCycle.objects.filter(pk=p.get('cycle_id'), workspace=workspace).first() if p.get('cycle_id') else None
    project = ResearchProject.objects.filter(pk=p.get('project_id'), workspace=workspace).first() if p.get('project_id') else None
    meeting = OperatingMeeting.objects.filter(pk=p.get('meeting_id'), workspace=workspace).first() if p.get('meeting_id') else None
    dependency = OperatingTask.objects.filter(pk=p.get('dependency_id'), workspace=workspace).first() if p.get('dependency_id') else None
    obj = OperatingTask.objects.create(workspace=workspace, initiative=initiative, milestone=milestone, cycle=cycle, project=project, meeting=meeting, owner=owner, title=p['title'].strip(), description=p.get('description', ''), priority=p.get('priority', Priority.P2), status=p.get('status', WorkStatus.ACTIVE), due_date=_date(p.get('due_date')), definition_of_done=p['definition_of_done'].strip(), dependency=dependency, blocked_reason=p.get('blocked_reason', ''))
    return JsonResponse({'ok': True, 'task': _task_json(obj)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def task_detail(request, task_id):
    if (auth := _auth(request)): return auth
    obj = OperatingTask.objects.select_related('workspace', 'owner', 'initiative__process', 'initiative__key_result__objective').filter(pk=task_id, workspace__in=_accessible_workspaces(request.user)).first()
    if not obj: return _error('task_not_found', 404)
    if not _editable(request, obj.workspace): return _error('permission_denied', 403)
    if request.method == 'DELETE':
        obj.delete(); return JsonResponse({'ok': True})
    p = _body(request)
    for field in ['title', 'description', 'priority', 'status', 'definition_of_done', 'blocked_reason']:
        if field in p: setattr(obj, field, p[field])
    if 'due_date' in p: obj.due_date = _date(p['due_date'])
    if 'owner_id' in p:
        owner = _owner(request.user, obj.workspace, p['owner_id'])
        if not owner: return _error('invalid_owner')
        obj.owner = owner
    if p.get('status') == WorkStatus.DONE and not obj.completed_at: obj.completed_at = timezone.now()
    if p.get('status') and p.get('status') != WorkStatus.DONE: obj.completed_at = None
    obj.save(); return JsonResponse({'ok': True, 'task': _task_json(obj)})
