import json

from django.db.models import Count, Q
from django.utils import timezone
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import operating_api as base
from . import operating_api_v2 as v2
from . import operating_api_v3 as v3
from .models import ResearchProject
from .operating_models import (
    Initiative,
    OperatingCycle,
    OperatingMilestone,
    OperatingRisk,
    OperatingTask,
    OperatingWorkPackage,
    StrategicObjective,
    KeyResult,
    WorkStatus,
)
from .platform_runtime_v3 import ensure_platform_workspaces


def _research_projects_for_core(request, core_workspace):
    """Return Research projects belonging to the canonical Research surface.

    Core and Research intentionally live in separate canonical workspaces. Older
    operating APIs assumed ResearchProject.workspace == Core workspace, which
    made projects disappear from planning and silently dropped project links on
    newly-created milestones/tasks/risks/work packages. Keep legacy Core-bound
    projects visible while resolving current projects through the canonical
    Research workspace.
    """
    spaces = ensure_platform_workspaces(request.user)
    research = spaces['research']
    return ResearchProject.objects.filter(
        archived=False,
        workspace_id__in={core_workspace.pk, research.pk},
    )


def _research_project_for_core(request, core_workspace, project_id):
    if project_id in (None, ''):
        return None
    try:
        project_id = int(project_id)
    except (TypeError, ValueError):
        return None
    return _research_projects_for_core(request, core_workspace).filter(pk=project_id).first()


def _delegate_project_link(request, delegate, model, response_key):
    if request.method != 'POST':
        return delegate(request)

    payload = base._body(request)
    core = base._workspace(request, payload)
    if not core:
        return delegate(request)

    requested_project_id = payload.get('project_id')
    project = _research_project_for_core(request, core, requested_project_id)
    if requested_project_id not in (None, '') and not project:
        return base._error('project_not_found', 404)

    response = delegate(request)
    if response.status_code != 201 or not project:
        return response

    data = json.loads(response.content.decode('utf-8'))
    object_id = (data.get(response_key) or {}).get('id')
    if not object_id:
        return response

    model.objects.filter(pk=object_id, workspace=core).update(project=project)
    data[response_key]['project_id'] = project.pk
    return JsonResponse(data, status=response.status_code)


def _task_totals(by_kr, kr_id):
    # All counts use one task population; no JOIN multiplication from comments,
    # attachments or checklist records.
    return by_kr.get(kr_id, {'total': 0, 'open': 0, 'done': 0, 'overdue': 0}).copy()


def _schedule(actual, start_date, due_date, today):
    """Linear expected progress is an estimate, not a historical baseline."""
    unknown = {
        'schedule': 'unmeasured' if actual is None else 'unscheduled',
        'expected_progress': None, 'variance_points': None,
        'estimated_days_offset': None,
    }
    if actual is None or start_date is None or due_date is None:
        return unknown
    span = (due_date - start_date).days
    if span <= 0:
        return {**unknown, 'schedule': 'invalid_dates'}
    expected = round(max(0, min(100, 100 * (today - start_date).days / span)), 1)
    variance = round(float(actual) - expected, 1)
    return {
        'schedule': 'behind' if variance < -5 else ('ahead' if variance > 5 else 'on_track'),
        'expected_progress': expected, 'variance_points': variance,
        'estimated_days_offset': round(variance * span / 100),
    }


@require_http_methods(['GET'])
def operating_dashboard(request):
    response = v3.operating_dashboard(request)
    if response.status_code != 200:
        return response
    core = base._workspace(request)
    if not core:
        return response

    data = json.loads(response.content.decode('utf-8'))
    projects = _research_projects_for_core(request, core).order_by('title', 'id')
    data.setdefault('counts', {})['projects'] = projects.count()
    data['projects'] = [{'id': item.pk, 'title': item.title} for item in projects]

    # The Core planning UI consumes complete initiative and cycle collections,
    # not only the dashboard's abbreviated recent/upcoming slices.
    initiatives = (
        Initiative.objects.filter(workspace=core)
        .exclude(status__in=[WorkStatus.DONE, WorkStatus.ARCHIVED])
        .select_related('owner', 'process', 'key_result__objective')
        .annotate(task_count=Count('tasks'))
        .order_by('priority', 'due_date', 'id')
    )
    cycles = (
        OperatingCycle.objects.filter(workspace=core)
        .exclude(status__in=[WorkStatus.DONE, WorkStatus.ARCHIVED])
        .select_related('owner', 'process')
        .order_by('end_date', 'id')
    )
    data['initiatives'] = [v2._initiative_json(item) for item in initiatives]
    data['cycles'] = [base._cycle_json(item) for item in cycles]

    planning_objectives = list(
        StrategicObjective.objects.filter(workspace=core)
        .exclude(status=WorkStatus.ARCHIVED)
        .select_related('owner')
        .annotate(key_result_count=Count('key_results', distinct=True))
        .order_by('sort_order', 'id')
    )
    planning_krs = list(
        KeyResult.objects.filter(objective__workspace=core)
        .exclude(status=WorkStatus.ARCHIVED)
        .select_related('objective', 'owner')
        .order_by('objective__sort_order', 'objective_id', 'sort_order', 'id')
    )
    planning_milestones = list(
        OperatingMilestone.objects.filter(workspace=core)
        .exclude(status=WorkStatus.ARCHIVED)
        .select_related('initiative__key_result__objective', 'owner', 'project')
        .order_by('due_date', 'id')
    )

    today = timezone.localdate()
    active = [WorkStatus.DONE, WorkStatus.ARCHIVED]
    kr_task_totals = {
        row['initiative__key_result_id']: {
            'total': row['total'], 'open': row['open'],
            'done': row['done'], 'overdue': row['overdue'],
        }
        for row in OperatingTask.objects.filter(
            workspace=core, initiative__key_result__objective__workspace=core
        ).values('initiative__key_result_id').annotate(
            total=Count('id'),
            open=Count('id', filter=~Q(status__in=active)),
            done=Count('id', filter=Q(status=WorkStatus.DONE)),
            overdue=Count('id', filter=Q(due_date__lt=today) & ~Q(status__in=active)),
        )
    }

    def kr_row(kr):
        objective = kr.objective
        result = base._kr_json(kr)
        result['tasks'] = _task_totals(kr_task_totals, kr.pk)
        start = objective.start_date or objective.created_at.date()
        result['timeline_start'] = start.isoformat()
        result['timeline_basis'] = 'objective_start' if objective.start_date else 'objective_created'
        result.update(_schedule(result['progress'], start, kr.due_date or objective.due_date, today))
        return result

    krs_by_objective = {}
    for kr in planning_krs:
        krs_by_objective.setdefault(kr.objective_id, []).append(kr)

    objective_rows = []
    for objective in planning_objectives:
        rows = krs_by_objective.get(objective.pk, [])
        measurable = [base._kr_progress(item) for item in rows]
        measurable = [value for value in measurable if value is not None]
        progress = round(sum(measurable) / len(measurable), 1) if measurable else None
        kr_rows = [kr_row(item) for item in rows]
        counts = {field: sum(row['tasks'][field] for row in kr_rows)
                  for field in ('total', 'open', 'done', 'overdue')}
        start = objective.start_date or objective.created_at.date()
        objective_rows.append({
            **base._objective_json(objective),
            'progress': progress,
            'tasks': counts,
            'timeline_start': start.isoformat(),
            'timeline_basis': 'objective_start' if objective.start_date else 'objective_created',
            **_schedule(progress, start, objective.due_date, today),
            'key_results': kr_rows,
        })

    data['planning'] = {
        'objectives': objective_rows,
        'key_results': [kr_row(item) for item in planning_krs],
        'milestones': [base._milestone_json(item) for item in planning_milestones],
        'counts': {
            'unlinked_tasks': OperatingTask.objects.filter(workspace=core, initiative__isnull=True).count(),
            'objectives': len(planning_objectives),
            'key_results': len(planning_krs),
            'milestones_open': sum(
                1 for item in planning_milestones
                if item.status not in {WorkStatus.DONE, WorkStatus.ARCHIVED}
            ),
            'milestones_done': sum(1 for item in planning_milestones if item.status == WorkStatus.DONE),
        },
    }
    return JsonResponse(data)


@require_http_methods(['GET', 'POST'])
def milestones(request):
    return _delegate_project_link(request, base.milestones, OperatingMilestone, 'milestone')


@require_http_methods(['GET', 'POST'])
def work_packages(request):
    return _delegate_project_link(request, v2.work_packages, OperatingWorkPackage, 'work_package')


@require_http_methods(['GET', 'POST'])
def tasks(request):
    return _delegate_project_link(request, v2.tasks, OperatingTask, 'task')


@require_http_methods(['GET', 'POST'])
def risks(request):
    return _delegate_project_link(request, v2.risks, OperatingRisk, 'risk')
