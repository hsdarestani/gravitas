import json

from django.db.models import Count
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import operating_api as base
from .operating_api_v2 import _initiative_json, operating_dashboard as operating_dashboard_v2
from .operating_models import Initiative, WorkStatus


@require_http_methods(['GET'])
def operating_dashboard(request):
    """Expose the richer dashboard while keeping the first UI contract stable."""
    response = operating_dashboard_v2(request)
    if response.status_code != 200:
        return response
    data = json.loads(response.content.decode('utf-8'))

    # Initiative.Meta deliberately prioritizes P0/P1 work, but a dashboard
    # field named recent_initiatives must be newest-first. Without an explicit
    # order a busy production workspace can hide a just-created lower-priority
    # initiative from this summary.
    workspace = base._workspace(request)
    if workspace:
        recent = (
            Initiative.objects.filter(workspace=workspace, status=WorkStatus.ACTIVE)
            .select_related('process', 'key_result__objective', 'owner')
            .annotate(task_count=Count('tasks'))
            .order_by('-updated_at', '-id')[:8]
        )
        data['recent_initiatives'] = [_initiative_json(item) for item in recent]

    for warning in data.get('capacity_warnings', []):
        warning['high_priority_active'] = warning.get('active_main_priorities', 0)
    return JsonResponse(data)
