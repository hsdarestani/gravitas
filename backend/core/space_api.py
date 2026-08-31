import json

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import cloud
from .models import KnowledgeResource, ResearchProject
from .platform_access import can_edit, can_view
from .space_fs import (
    SpaceConflict,
    create_node,
    ensure_defaults,
    ensure_note_link,
    ensure_project_link,
    notes_index,
    sync_all,
    sync_note,
    sync_project,
)
from .space_models import NoteSpaceLink, ProjectSpaceLink, SpaceNode


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _auth(request):
    return _error('authentication_required', 401) if not request.user.is_authenticated else None


def _node_json(node):
    return {
        'id': node.pk,
        'kind': node.kind,
        'title': node.title,
        'parent_id': node.parent_id,
        'filesystem_name': node.filesystem_name,
        'path': node.nextcloud_path,
        'metadata_path': node.nextcloud_path + '.md',
        'sync_state': node.sync_state,
        'sync_error': node.sync_error,
    }


def _tree_json(user):
    nodes = list(SpaceNode.objects.filter(owner=user).select_related('parent'))
    children = {}
    for node in nodes:
        children.setdefault(node.parent_id, []).append(node)

    def branch(node):
        data = _node_json(node)
        data['children'] = [branch(item) for item in children.get(node.pk, [])]
        return data

    return [branch(item) for item in children.get(None, [])]


def _project_link_json(link):
    return {
        'project_id': link.project_id,
        'category_id': link.category_id,
        'category_title': link.category.title,
        'folder_path': link.folder_path,
        'metadata_path': link.metadata_path,
        'sync_state': link.sync_state,
        'sync_error': link.sync_error,
        'last_synced_at': link.last_synced_at.isoformat() if link.last_synced_at else None,
    }


def _note_link_json(link):
    return {
        'resource_id': link.resource_id,
        'category_id': link.category_id,
        'parent_note_id': link.parent_note_id,
        'note_path': link.note_path,
        'attachments_path': link.attachments_path,
        'sync_state': link.sync_state,
        'sync_error': link.sync_error,
        'last_synced_at': link.last_synced_at.isoformat() if link.last_synced_at else None,
    }


@require_http_methods(['GET', 'POST'])
def space_tree(request):
    if response := _auth(request):
        return response
    try:
        ensure_defaults(request.user, sync=request.method == 'POST')
    except cloud.CloudError:
        # The database tree remains usable while Nextcloud is unavailable.
        pass

    if request.method == 'GET':
        return JsonResponse({
            'ok': True,
            'root': {'title': 'Space', 'path': 'Space', 'metadata_path': 'Space.md', 'tag': '@space'},
            'nodes': [_node_json(item) for item in SpaceNode.objects.filter(owner=request.user)],
            'tree': _tree_json(request.user),
        })

    data = _body(request)
    title = str(data.get('title') or '').strip()[:220]
    kind = str(data.get('kind') or 'category').strip().lower()
    if not title:
        return _error('title_required')
    parent = None
    if data.get('parent_id') not in (None, ''):
        parent = SpaceNode.objects.filter(pk=data['parent_id'], owner=request.user).first()
        if not parent:
            return _error('parent_not_found', 404)
    try:
        node = create_node(request.user, title, kind, parent=parent, sync=True)
    except ValueError as exc:
        return _error(str(exc))
    except SpaceConflict as exc:
        node = SpaceNode.objects.filter(owner=request.user, nextcloud_path=exc.path[:-3] if exc.path.endswith('.md') else exc.path).first()
        return _error('space_sync_conflict', 409, path=exc.path, node=_node_json(node) if node else None)
    except cloud.CloudError:
        return _error('cloud_unavailable', 503)
    return JsonResponse({'ok': True, 'node': _node_json(node), 'tree': _tree_json(request.user)}, status=201)


@require_http_methods(['GET', 'PATCH'])
def space_project(request, project_id):
    if response := _auth(request):
        return response
    project = ResearchProject.objects.select_related('owner', 'workspace').filter(pk=project_id).first()
    if not project or not can_view(request.user, project):
        return _error('not_found', 404)

    existing = ProjectSpaceLink.objects.filter(project=project, user=request.user).select_related('category').first()
    if request.method == 'GET':
        try:
            link = existing or ensure_project_link(project, user=request.user, sync=False)
        except (ValueError, cloud.CloudError):
            return _error('cloud_unavailable', 503)
        return JsonResponse({'ok': True, 'placement': _project_link_json(link)})

    data = _body(request)
    category_id = data.get('category_id')
    category = SpaceNode.objects.filter(pk=category_id, owner=request.user, kind=SpaceNode.Kind.CATEGORY).first()
    if not category:
        return _error('invalid_project_category')
    force = bool(data.get('force'))
    if force and not bool(data.get('confirmed')):
        return _error('confirmation_required', 409)
    try:
        ensure_project_link(project, user=request.user, category=category, sync=False)
        link = sync_project(project, user=request.user, force=force)
    except SpaceConflict as exc:
        return _error('space_sync_conflict', 409, path=exc.path, confirmation_required=True)
    except (ValueError, cloud.CloudError):
        return _error('cloud_unavailable', 503)
    return JsonResponse({'ok': True, 'placement': _project_link_json(link)})


@require_http_methods(['GET'])
def space_notes(request):
    if response := _auth(request):
        return response
    include_remote = request.GET.get('remote') in {'1', 'true', 'yes'}
    try:
        items = notes_index(request.user, include_remote=include_remote)
        cloud_error = False
    except cloud.CloudError:
        items = notes_index(request.user, include_remote=False)
        cloud_error = True
    notes = list(KnowledgeResource.objects.filter(owner=request.user, kind=KnowledgeResource.Kind.NOTE).values('id', 'title'))
    return JsonResponse({'ok': True, 'items': items, 'notes': notes, 'cloud_unavailable': cloud_error})


@require_http_methods(['GET', 'PATCH'])
def space_note(request, resource_id):
    if response := _auth(request):
        return response
    resource = KnowledgeResource.objects.select_related('owner', 'project').filter(pk=resource_id, kind=KnowledgeResource.Kind.NOTE).first()
    if not resource or not can_view(request.user, resource):
        return _error('not_found', 404)
    if resource.owner_id != request.user.pk:
        return _error('space_placement_is_owner_private', 403)

    if request.method == 'GET':
        try:
            link = NoteSpaceLink.objects.filter(resource=resource).select_related('category', 'parent_note').first() or ensure_note_link(resource, sync=False)
        except (ValueError, cloud.CloudError):
            return _error('cloud_unavailable', 503)
        return JsonResponse({'ok': True, 'placement': _note_link_json(link)})

    if not can_edit(request.user, resource):
        return _error('permission_denied', 403)
    data = _body(request)
    category = None
    if data.get('category_id') not in (None, ''):
        category = SpaceNode.objects.filter(pk=data['category_id'], owner=request.user, kind=SpaceNode.Kind.CATEGORY).first()
        if not category:
            return _error('invalid_note_category')
    parent_note = None
    if data.get('parent_note_id') not in (None, ''):
        parent_note = KnowledgeResource.objects.filter(
            pk=data['parent_note_id'], owner=request.user, kind=KnowledgeResource.Kind.NOTE,
        ).first()
        if not parent_note:
            return _error('invalid_parent_note')
    force = bool(data.get('force'))
    if force and not bool(data.get('confirmed')):
        return _error('confirmation_required', 409)
    try:
        ensure_note_link(
            resource,
            category=category,
            parent_note=parent_note,
            attachments=bool(data.get('attachments')),
            sync=False,
        )
        link = sync_note(resource, force=force)
    except SpaceConflict as exc:
        return _error('space_sync_conflict', 409, path=exc.path, confirmation_required=True)
    except ValueError as exc:
        return _error(str(exc))
    except cloud.CloudError:
        return _error('cloud_unavailable', 503)
    return JsonResponse({'ok': True, 'placement': _note_link_json(link)})


@require_http_methods(['POST'])
def space_sync(request):
    if response := _auth(request):
        return response
    data = _body(request)
    force = bool(data.get('force'))
    if force and not bool(data.get('confirmed')):
        return _error('confirmation_required', 409)
    try:
        result = sync_all(request.user, force=force)
    except cloud.CloudError:
        return _error('cloud_unavailable', 503)
    status = 409 if result['conflicts'] and not force else (503 if result['errors'] else 200)
    return JsonResponse(result, status=status)
