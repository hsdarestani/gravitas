from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .models import KnowledgeResource, ResearchProject
from .operating_models import Initiative, OperatingTask
from .platform_access import can_view
from .platform_api import (
    _auth,
    _content_json,
    _json_date,
    _project_json,
    _request_json,
    _resource_json,
    _workspace_json,
    ensure_dual_workspaces,
)
from .platform_models import ContentWorkItem, MindMap, ResearchRequest


@require_http_methods(['GET'])
def platform_dashboard(request):
    if response := _auth(request):
        return response
    spaces = ensure_dual_workspaces(request.user)
    purpose = request.GET.get('workspace', 'core').strip().lower()
    if purpose not in {'core', 'research'}:
        purpose = 'core'
    workspace = spaces[purpose]

    if purpose == 'core':
        task_qs = OperatingTask.objects.filter(workspace=workspace).exclude(status='archived')
        initiative_qs = Initiative.objects.filter(workspace=workspace).exclude(status='archived')
        content_qs = ContentWorkItem.objects.filter(workspace=workspace).exclude(status='archived')
        request_qs = ResearchRequest.objects.filter(
            Q(workspace=workspace) | Q(content_work_item__workspace=workspace)
        ).distinct()

        tasks = list(task_qs.select_related('owner', 'initiative', 'project')[:12])
        initiatives = list(initiative_qs.select_related('owner', 'key_result', 'process')[:8])
        content = list(content_qs.select_related('owner', 'research_project')[:20])
        requests = [
            item for item in request_qs.select_related('project', 'content_work_item', 'assignee')[:60]
            if can_view(request.user, item)
        ][:12]
        research_waiting = sum(1 for item in requests if item.status not in {'done', 'cancelled'})

        return JsonResponse({
            'ok': True,
            'workspace': _workspace_json(workspace),
            'counts': {
                'tasks': task_qs.count(),
                'initiatives': initiative_qs.count(),
                'content': content_qs.count(),
                'research_waiting': research_waiting,
            },
            'tasks': [{
                'id': item.pk,
                'title': item.title,
                'owner': (item.owner.first_name or item.owner.email) if item.owner else None,
                'status': item.status,
                'priority': item.priority,
                'due_date': _json_date(item.due_date),
                'initiative': item.initiative.title,
                'project_id': item.project_id,
            } for item in tasks],
            'initiatives': [{
                'id': item.pk,
                'title': item.title,
                'status': item.status,
                'stage': item.stage,
                'priority': item.priority,
                'owner': (item.owner.first_name or item.owner.email) if item.owner else None,
            } for item in initiatives],
            'content': [_content_json(item) for item in content],
            'research_requests': [_request_json(item) for item in requests],
        })

    projects_qs = ResearchProject.objects.filter(workspace=workspace, archived=False).select_related('owner', 'workspace')
    visible_projects = [item for item in projects_qs if can_view(request.user, item)]
    visible_project_ids = [item.pk for item in visible_projects]

    request_qs = ResearchRequest.objects.filter(
        Q(project_id__in=visible_project_ids) | Q(requested_by=request.user) | Q(assignee=request.user)
    ).select_related('project', 'assignee').distinct()
    visible_requests = [item for item in request_qs[:80] if can_view(request.user, item)]

    resource_qs = KnowledgeResource.objects.filter(
        Q(workspace=workspace) | Q(owner=request.user)
    ).select_related('project', 'owner').distinct()
    recent_resources = [item for item in resource_qs[:120] if can_view(request.user, item)][:12]

    mindmap_qs = MindMap.objects.filter(
        Q(workspace=workspace) | Q(owner=request.user)
    ).select_related('project', 'owner').distinct()
    visible_maps = [item for item in mindmap_qs[:80] if can_view(request.user, item)][:8]

    return JsonResponse({
        'ok': True,
        'workspace': _workspace_json(workspace),
        'counts': {
            'projects': len(visible_projects),
            'client_projects': sum(1 for item in visible_projects if getattr(item, 'platform_profile', None) and item.platform_profile.category == 'client'),
            'community_projects': sum(1 for item in visible_projects if getattr(item, 'platform_profile', None) and item.platform_profile.category == 'community'),
            'research_requests': sum(1 for item in visible_requests if item.status not in {'done', 'cancelled'}),
        },
        'projects': [_project_json(item, request.user) for item in visible_projects[:12]],
        'research_requests': [_request_json(item) for item in visible_requests[:12]],
        'recent_resources': [_resource_json(item) for item in recent_resources],
        'mindmaps': [{
            'id': item.pk,
            'title': item.title,
            'project_id': item.project_id,
            'updated_at': item.updated_at.isoformat(),
        } for item in visible_maps],
    })
