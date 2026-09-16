from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .models import KnowledgeResource
from .platform_access import can_view
from .platform_models import ProjectAuditEvent, ProjectDeliverable
from .research_project_tools import _audit, _error, _payload, _project


def _deliverable_json(item):
    return {
        'id': item.pk,
        'project_id': item.project_id,
        'title': item.title,
        'description': item.description,
        'status': item.status,
        'resource_id': item.resource_id,
        'client_visible': item.client_visible,
        'updated_at': item.updated_at.isoformat(),
    }


@require_http_methods(['PATCH', 'DELETE'])
def project_deliverable_detail(request, project_id, deliverable_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project = _project(request, project_id, 'edit')
    if not project:
        return _error('permission_denied', 403)
    item = ProjectDeliverable.objects.select_related('resource').filter(pk=deliverable_id, project=project).first()
    if not item:
        return _error('deliverable_not_found', 404)

    if request.method == 'DELETE':
        item_id = item.pk
        title = item.title
        item.delete()
        ProjectAuditEvent.objects.create(
            project=project,
            actor=request.user,
            action='deliverable_deleted',
            object_type='ProjectDeliverable',
            object_id=str(item_id),
            detail={'title': title},
        )
        return JsonResponse({'ok': True})

    data = _payload(request)
    if data is None:
        return _error('invalid_json')
    changed = []
    if 'title' in data:
        title = str(data.get('title') or '').strip()[:240]
        if not title:
            return _error('title_required')
        item.title = title
        changed.append('title')
    if 'description' in data:
        item.description = str(data.get('description') or '').strip()
        changed.append('description')
    if 'status' in data:
        status = str(data.get('status') or '').strip().lower()
        if status not in ProjectDeliverable.Status.values:
            return _error('invalid_status')
        item.status = status
        changed.append('status')
    if 'client_visible' in data:
        item.client_visible = bool(data.get('client_visible'))
        changed.append('client_visible')
    if 'resource_id' in data:
        resource = None
        if data.get('resource_id') not in (None, ''):
            resource = KnowledgeResource.objects.filter(pk=data['resource_id'], project=project).first()
            if not resource or not can_view(request.user, resource):
                return _error('invalid_resource')
        item.resource = resource
        changed.append('resource_id')
    item.save()
    _audit(project, request.user, 'deliverable_updated', item, title=item.title, status=item.status, fields=changed)
    return JsonResponse({'ok': True, 'item': _deliverable_json(item)})
