import json

from django.db.models import Count
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
