import json

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .models import KnowledgeResource
from .platform_access import can_edit, can_manage
from .project_cockpit import project_cockpit as legacy_project_cockpit


@require_http_methods(['GET'])
def project_cockpit(request, project_id):
    """Expose one stable permission contract to every Research project client.

    The modern project serializer nests permissions, while a few older project
    views consumed top-level aliases. Resource rows also historically omitted
    edit/manage flags. Keep both shapes during the migration and make resource
    action visibility reflect the actual object ACL.
    """
    response = legacy_project_cockpit(request, project_id)
    if response.status_code != 200:
        return response

    data = json.loads(response.content.decode('utf-8'))
    project = data.get('project') or {}
    permissions = project.get('permissions') or {}
    for key in ('role', 'can_view', 'can_edit', 'can_manage'):
        if key in permissions:
            project.setdefault(key, permissions[key])

    resource_rows = data.get('resources') or []
    resource_ids = [row.get('id') for row in resource_rows if row.get('id')]
    resources = {
        item.pk: item
        for item in KnowledgeResource.objects.filter(pk__in=resource_ids).select_related('project', 'workspace', 'collection')
    }
    for row in resource_rows:
        item = resources.get(row.get('id'))
        if item is None:
            row['can_edit'] = False
            row['can_manage'] = False
            continue
        row['can_edit'] = can_edit(request.user, item)
        row['can_manage'] = can_manage(request.user, item)

    return JsonResponse(data)
