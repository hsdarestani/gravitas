import json

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import platform_api
from .models import KnowledgeResource
from .platform_access import can_edit, can_manage, can_view
from .research_models import DocumentAnnotation


MAX_ROWS = 500


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _resource(request, resource_id):
    try:
        resource_id = int(resource_id)
    except (TypeError, ValueError):
        return None
    resource = KnowledgeResource.objects.select_related('project', 'owner').filter(pk=resource_id).first()
    if not resource or not resource.project_id:
        return None
    if not can_view(request.user, resource) or not can_view(request.user, resource.project):
        return None
    return resource


def _json(item, user):
    project = item.project
    return {
        'id': item.pk,
        'project_id': item.project_id,
        'resource_id': item.resource_id,
        'parent_id': item.parent_id,
        'author_id': item.author_id,
        'author': item.author.get_full_name() or item.author.first_name or item.author.email,
        'body': item.body,
        'anchor': item.anchor if isinstance(item.anchor, dict) else {},
        'resolved': item.resolved,
        'can_edit': item.author_id == user.pk or can_manage(user, project),
        'created_at': item.created_at.isoformat(),
        'updated_at': item.updated_at.isoformat(),
    }


@require_http_methods(['GET', 'POST'])
def annotations(request):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)

    if request.method == 'GET':
        resource = _resource(request, request.GET.get('resource_id'))
        if not resource:
            return _error('resource_not_found_or_not_project_linked', 404)
        items = DocumentAnnotation.objects.filter(resource=resource).select_related('author', 'project', 'parent')
        if request.GET.get('resolved') in {'0', 'false', 'no'}:
            items = items.filter(resolved=False)
        return JsonResponse({
            'ok': True,
            'resource': {
                'id': resource.pk,
                'title': resource.title,
                'project_id': resource.project_id,
                'project_title': resource.project.title,
            },
            'annotations': [_json(item, request.user) for item in items[:MAX_ROWS]],
        })

    data = _body(request)
    if data is None:
        return _error('invalid_json')
    resource = _resource(request, data.get('resource_id'))
    if not resource:
        return _error('resource_not_found_or_not_project_linked', 404)
    if not can_edit(request.user, resource.project):
        return _error('permission_denied', 403)

    body = str(data.get('body') or '').strip()
    if not body:
        return _error('body_required')
    if len(body) > 10000:
        return _error('body_too_long')

    parent = None
    anchor = data.get('anchor') if isinstance(data.get('anchor'), dict) else {}
    if data.get('parent_id') not in (None, ''):
        try:
            parent = DocumentAnnotation.objects.select_related('project').get(
                pk=int(data['parent_id']),
                resource=resource,
                project=resource.project,
            )
        except (DocumentAnnotation.DoesNotExist, TypeError, ValueError):
            return _error('invalid_parent')
        # Replies belong to the parent thread. The anchor lives on the root so
        # a range edit never leaves sibling replies pointing at different text.
        anchor = {}

    item = DocumentAnnotation.objects.create(
        project=resource.project,
        resource=resource,
        author=request.user,
        parent=parent,
        body=body,
        anchor=anchor,
    )
    platform_api._audit(
        resource.project,
        request.user,
        'annotation.posted',
        item,
        resource_id=resource.pk,
        parent_id=item.parent_id,
        anchor=anchor,
    )
    return JsonResponse({'ok': True, 'annotation': _json(item, request.user)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def annotation_detail(request, annotation_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    item = DocumentAnnotation.objects.select_related('author', 'project', 'resource').filter(pk=annotation_id).first()
    if not item or not can_view(request.user, item.project) or not can_view(request.user, item.resource):
        return _error('not_found', 404)
    if item.author_id != request.user.pk and not can_manage(request.user, item.project):
        return _error('permission_denied', 403)

    if request.method == 'DELETE':
        item_id = item.pk
        project = item.project
        resource_id = item.resource_id
        item.delete()
        platform_api._audit(
            project,
            request.user,
            'annotation.deleted',
            project,
            annotation_id=item_id,
            resource_id=resource_id,
        )
        return JsonResponse({'ok': True, 'deleted': True})

    data = _body(request)
    if data is None:
        return _error('invalid_json')
    changed = []
    if 'body' in data:
        body = str(data.get('body') or '').strip()
        if not body:
            return _error('body_required')
        if len(body) > 10000:
            return _error('body_too_long')
        item.body = body
        changed.append('body')
    if 'resolved' in data:
        # Replies cannot resolve the thread independently; resolving a root is
        # reflected to its replies so both list and thread views stay coherent.
        root = item.parent or item
        value = bool(data.get('resolved'))
        root.resolved = value
        root.save(update_fields=['resolved', 'updated_at'])
        root.replies.update(resolved=value)
        item = root
        changed.append('resolved')
    elif changed:
        item.save(update_fields=['body', 'updated_at'])

    platform_api._audit(
        item.project,
        request.user,
        'annotation.updated',
        item,
        resource_id=item.resource_id,
        fields=changed,
        resolved=item.resolved,
    )
    return JsonResponse({'ok': True, 'annotation': _json(item, request.user)})
