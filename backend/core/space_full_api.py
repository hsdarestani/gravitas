import json

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import cloud
from .models import KnowledgeResource, ResearchProject
from .platform_access import can_edit, can_view
from .space_fs import SpaceConflict, ensure_defaults, notes_index, sync_node
from .space_items import create_item, delete_item, item_json, sync_item, update_item
from .space_models import NoteSpaceLink, ProjectSpaceLink, SpaceManagedItem, SpaceNode
from .space_moves import move_node, place_note, place_project, sync_note_moveaware, sync_project_moveaware


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _auth(request):
    return _error('authentication_required', 401) if not request.user.is_authenticated else None


def _project_json(link):
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


def _note_json(link):
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


@require_http_methods(['PATCH'])
def space_node_detail(request, node_id):
    if response := _auth(request):
        return response
    node = SpaceNode.objects.filter(pk=node_id, owner=request.user).select_related('parent').first()
    if not node:
        return _error('not_found', 404)
    data = _body(request)
    parent = node.parent
    if 'parent_id' in data:
        parent_id = data.get('parent_id')
        parent = None if parent_id in (None, '') else SpaceNode.objects.filter(pk=parent_id, owner=request.user).first()
        if parent_id not in (None, '') and not parent:
            return _error('parent_not_found', 404)
    force = bool(data.get('force'))
    if force and not data.get('confirmed'):
        return _error('confirmation_required', 409)
    try:
        node = move_node(node, title=data.get('title', node.title), parent=parent, force=force)
    except SpaceConflict as exc:
        return _error('space_sync_conflict', 409, path=exc.path, confirmation_required=True)
    except ValueError as exc:
        return _error(str(exc))
    except cloud.CloudError:
        return _error('cloud_unavailable', 503)
    return JsonResponse({'ok': True, 'node': {
        'id': node.pk, 'kind': node.kind, 'title': node.title, 'parent_id': node.parent_id,
        'filesystem_name': node.filesystem_name, 'path': node.nextcloud_path,
        'metadata_path': node.nextcloud_path + '.md', 'sync_state': node.sync_state,
    }})


@require_http_methods(['GET', 'PATCH'])
def space_project_full(request, project_id):
    if response := _auth(request):
        return response
    project = ResearchProject.objects.select_related('owner', 'workspace').filter(pk=project_id).first()
    if not project or not can_view(request.user, project):
        return _error('not_found', 404)
    existing = ProjectSpaceLink.objects.filter(project=project, user=request.user).select_related('category').first()
    if request.method == 'GET':
        try:
            link = existing or place_project(project, request.user)
        except (ValueError, cloud.CloudError):
            return _error('cloud_unavailable', 503)
        return JsonResponse({'ok': True, 'placement': _project_json(link)})
    data = _body(request)
    category_id = data.get('category_id')
    category = existing.category if existing else None
    if category_id not in (None, ''):
        category = SpaceNode.objects.filter(pk=category_id, owner=request.user, kind=SpaceNode.Kind.CATEGORY).first()
        if not category:
            return _error('invalid_project_category')
    force = bool(data.get('force'))
    if force and not data.get('confirmed'):
        return _error('confirmation_required', 409)
    try:
        link = place_project(project, request.user, category, force=force)
    except SpaceConflict as exc:
        return _error('space_sync_conflict', 409, path=exc.path, confirmation_required=True)
    except ValueError as exc:
        return _error(str(exc))
    except cloud.CloudError:
        return _error('cloud_unavailable', 503)
    return JsonResponse({'ok': True, 'placement': _project_json(link)})


@require_http_methods(['GET'])
def space_notes_full(request):
    if response := _auth(request):
        return response
    include_remote = request.GET.get('remote') in {'1', 'true', 'yes'}
    try:
        items = notes_index(request.user, include_remote=include_remote)
        cloud_error = False
    except cloud.CloudError:
        items = notes_index(request.user, include_remote=False)
        cloud_error = True
    managed_paths = {item['path'] for item in items}
    for managed in SpaceManagedItem.objects.filter(owner=request.user):
        if managed.file_path in managed_paths:
            for row in items:
                if row['path'] == managed.file_path:
                    row.update({
                        'type': managed.kind, 'tag': '@' + managed.kind, 'title': managed.title,
                        'sync_state': managed.sync_state, 'sync_error': managed.sync_error,
                        'source': 'managed', 'id': managed.pk,
                    })
            continue
        items.append({
            'type': managed.kind, 'tag': '@' + managed.kind, 'title': managed.title,
            'path': managed.file_path, 'sync_state': managed.sync_state,
            'sync_error': managed.sync_error, 'source': 'managed', 'id': managed.pk,
        })
    items.sort(key=lambda item: (item['path'].lower(), item['type']))
    notes = list(KnowledgeResource.objects.filter(owner=request.user, kind=KnowledgeResource.Kind.NOTE).values('id', 'title'))
    return JsonResponse({'ok': True, 'items': items, 'notes': notes, 'cloud_unavailable': cloud_error})


@require_http_methods(['GET', 'PATCH'])
def space_note_full(request, resource_id):
    if response := _auth(request):
        return response
    resource = KnowledgeResource.objects.select_related('owner', 'project').filter(pk=resource_id, kind=KnowledgeResource.Kind.NOTE).first()
    if not resource or not can_view(request.user, resource):
        return _error('not_found', 404)
    if resource.owner_id != request.user.pk:
        return _error('space_placement_is_owner_private', 403)
    existing = NoteSpaceLink.objects.filter(resource=resource).select_related('category', 'parent_note').first()
    if request.method == 'GET':
        try:
            link = existing or place_note(resource)
        except (ValueError, cloud.CloudError):
            return _error('cloud_unavailable', 503)
        return JsonResponse({'ok': True, 'placement': _note_json(link)})
    if not can_edit(request.user, resource):
        return _error('permission_denied', 403)
    data = _body(request)
    category = existing.category if existing else None
    if 'category_id' in data:
        category_id = data.get('category_id')
        category = None if category_id in (None, '') else SpaceNode.objects.filter(pk=category_id, owner=request.user, kind=SpaceNode.Kind.CATEGORY).first()
        if category_id not in (None, '') and not category:
            return _error('invalid_note_category')
    parent_note = existing.parent_note if existing else None
    if 'parent_note_id' in data:
        parent_id = data.get('parent_note_id')
        parent_note = None if parent_id in (None, '') else KnowledgeResource.objects.filter(
            pk=parent_id, owner=request.user, kind=KnowledgeResource.Kind.NOTE,
        ).first()
        if parent_id not in (None, '') and not parent_note:
            return _error('invalid_parent_note')
    attachments = bool(data.get('attachments')) if 'attachments' in data else bool(existing and existing.attachments_path)
    force = bool(data.get('force'))
    if force and not data.get('confirmed'):
        return _error('confirmation_required', 409)
    try:
        link = place_note(resource, category=category, parent_note=parent_note, attachments=attachments, force=force)
    except SpaceConflict as exc:
        return _error('space_sync_conflict', 409, path=exc.path, confirmation_required=True)
    except ValueError as exc:
        return _error(str(exc))
    except cloud.CloudError:
        return _error('cloud_unavailable', 503)
    return JsonResponse({'ok': True, 'placement': _note_json(link)})


@require_http_methods(['GET', 'POST'])
def space_items(request):
    if response := _auth(request):
        return response
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'items': [item_json(item) for item in SpaceManagedItem.objects.filter(owner=request.user)]})
    data = _body(request)
    project = None
    category = None
    parent = None
    if data.get('project_id') not in (None, ''):
        project = ResearchProject.objects.filter(pk=data['project_id']).first()
        if not project or not can_view(request.user, project):
            return _error('invalid_project')
    if data.get('category_id') not in (None, ''):
        category = SpaceNode.objects.filter(pk=data['category_id'], owner=request.user, kind=SpaceNode.Kind.CATEGORY).first()
        if not category:
            return _error('invalid_managed_category')
    if data.get('parent_id') not in (None, ''):
        parent = SpaceManagedItem.objects.filter(pk=data['parent_id'], owner=request.user).first()
        if not parent:
            return _error('invalid_managed_parent')
    try:
        item = create_item(
            request.user, kind=data.get('kind'), title=data.get('title'), body=data.get('body', ''),
            metadata=data.get('metadata'), project=project, category=category, parent=parent, sync=True,
        )
    except ValueError as exc:
        return _error(str(exc))
    except (SpaceConflict, cloud.CloudError):
        return _error('cloud_unavailable', 503)
    return JsonResponse({'ok': True, 'item': item_json(item)}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def space_item_detail(request, item_id):
    if response := _auth(request):
        return response
    item = SpaceManagedItem.objects.select_related('project', 'category', 'parent').filter(pk=item_id, owner=request.user).first()
    if not item:
        return _error('not_found', 404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'item': item_json(item)})
    if request.method == 'DELETE':
        try:
            delete_item(item)
        except ValueError as exc:
            return _error(str(exc), 409)
        except cloud.CloudError:
            return _error('cloud_unavailable', 503)
        return JsonResponse({'ok': True})
    data = _body(request)
    project = item.project
    category = item.category
    parent = item.parent
    if 'project_id' in data:
        pid = data.get('project_id')
        project = None if pid in (None, '') else ResearchProject.objects.filter(pk=pid).first()
        if pid not in (None, '') and (not project or not can_view(request.user, project)):
            return _error('invalid_project')
    if 'category_id' in data:
        cid = data.get('category_id')
        category = None if cid in (None, '') else SpaceNode.objects.filter(pk=cid, owner=request.user, kind=SpaceNode.Kind.CATEGORY).first()
        if cid not in (None, '') and not category:
            return _error('invalid_managed_category')
    if 'parent_id' in data:
        parent_id = data.get('parent_id')
        parent = None if parent_id in (None, '') else SpaceManagedItem.objects.filter(pk=parent_id, owner=request.user).first()
        if parent_id not in (None, '') and not parent:
            return _error('invalid_managed_parent')
    force = bool(data.get('force'))
    if force and not data.get('confirmed'):
        return _error('confirmation_required', 409)
    try:
        item = update_item(
            item, title=data.get('title'), body=data.get('body') if 'body' in data else None,
            metadata=data.get('metadata') if 'metadata' in data else None,
            project=project, category=category, parent=parent, force=force,
        )
    except SpaceConflict as exc:
        return _error('space_sync_conflict', 409, path=exc.path, confirmation_required=True)
    except ValueError as exc:
        return _error(str(exc))
    except cloud.CloudError:
        return _error('cloud_unavailable', 503)
    return JsonResponse({'ok': True, 'item': item_json(item)})


@require_http_methods(['POST'])
def space_sync_full(request):
    if response := _auth(request):
        return response
    data = _body(request)
    force = bool(data.get('force'))
    if force and not data.get('confirmed'):
        return _error('confirmation_required', 409)
    conflicts = []
    errors = []
    try:
        ensure_defaults(request.user, sync=False)
    except cloud.CloudError:
        return _error('cloud_unavailable', 503)
    for node in SpaceNode.objects.filter(owner=request.user):
        try:
            sync_node(node, force=force)
        except SpaceConflict as exc:
            conflicts.append(exc.path)
        except cloud.CloudError as exc:
            errors.append(str(exc))
    projects = ResearchProject.objects.filter(owner=request.user, archived=False)
    projects = projects | ResearchProject.objects.filter(memberships__user=request.user, archived=False)
    for project in projects.distinct():
        try:
            sync_project_moveaware(project, request.user, force=force)
        except SpaceConflict as exc:
            conflicts.append(exc.path)
        except (ValueError, cloud.CloudError) as exc:
            errors.append(str(exc))
    for note in KnowledgeResource.objects.filter(owner=request.user, kind=KnowledgeResource.Kind.NOTE).select_related('project'):
        try:
            sync_note_moveaware(note, force=force)
        except SpaceConflict as exc:
            conflicts.append(exc.path)
        except (ValueError, cloud.CloudError) as exc:
            errors.append(str(exc))
    for item in SpaceManagedItem.objects.filter(owner=request.user):
        try:
            sync_item(item, force=force)
        except SpaceConflict as exc:
            conflicts.append(exc.path)
        except cloud.CloudError as exc:
            errors.append(str(exc))
    status = 409 if conflicts and not force else (503 if errors else 200)
    return JsonResponse({'ok': not conflicts and not errors, 'conflicts': conflicts, 'errors': errors}, status=status)
