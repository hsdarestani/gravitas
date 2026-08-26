import json

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .operating_api_v2 import operating_dashboard as operating_dashboard_v2


@require_http_methods(['GET'])
def operating_dashboard(request):
    """Expose the richer dashboard while keeping the first UI contract stable."""
    response = operating_dashboard_v2(request)
    if response.status_code != 200:
        return response
    data = json.loads(response.content.decode('utf-8'))
    for warning in data.get('capacity_warnings', []):
        warning['high_priority_active'] = warning.get('active_main_priorities', 0)
    return JsonResponse(data)
