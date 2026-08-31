import json
from pathlib import PurePosixPath

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import cloud
from .models import KnowledgeResource, ResearchProject
from .platform_access import can_edit, can_view
from .platform_api import platform_project_detail as base_project_detail
from .platform_api import platform_projects as base_projects
from .platform_resources_api import platform_resource_detail as base_resource_detail
from .platform_resources_api import platform_resources as base_resources
from .space_models import NoteSpacePlacement, ProjectSpacePlacement, SpaceNode
from .space_service import (
    _list_dir,
    _read_text,
    create_space_node,
    ensure_default_space,
    identity_for,
    known_markdown,
    markdown_type,
    place_note,
    place_project,
    review_cloud_changes,
    storage_name,
    sync_all_to_cloud,
    sync_note,
    upload_note_attachment,
    walk_markdown,
)


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _auth(request):
    return _error('authentication_required', 401) if not request.user.is_authenticated else None


def _response_data(response):
    try:
        return json.loads(response.content.decode('utf-8'))
    except Exception:
        return {}


def _node_json(node):
    return {
        'id': node.pk,
        'kind': node.kind,
        'title': node.title,
        'parent_id': node.parent_id,
        'folder_path': node.folder_path,
        'markdown_path': node.markdown_path,
        'sync_state': node.sync_state,
    }


def _placement_json(placement):
    return {
        'parent_id': placement.parent_id,
        'folder_path': placement.folder_path,
        'markdown_path': placement.markdown_path,
        'sync_state': placement.sync_state,
    }


def _note_json(resource, placement=None):
    placement = placement or NoteSpacePlacement.objects.filter(resource=resource, owner=resource.owner).first()
    return {
        'id': resource.pk,
        'title': resource.title,
        'description': resource.description,
        'body': resource.body,
        'project_id': resource.project_id,
        'space_parent_id': placement.space_parent_id if placement else None,
        'parent_note_id': placement.parent_note_id if placement else None,
        'markdown_path': placement.markdown_path if placement else None,
        'attachments_path': placement.attachments_path if placement else None,
        'sync_state': placement.sync_state if placement else 'pending',
        'updated_at': resource.updated_at.isoformat(),
    }


def _backfill_space(user):
    try:
        ensure_default_space(user)
    except cloud.CloudError:
        # Keep database operations available even when Nextcloud is offline.
        pass
    for project in ResearchProject.objects.filter(owner=user, archived=False).exclude(space_placement__isnull=False):
        try:
            place_project(project)
        except (ValueError, cloud.CloudError):
            continue
    for resource in KnowledgeResource.objects.filter(owner=user, kind=KnowledgeResource.Kind.NOTE).exclude(space_placement__isnull=False):
        try:
            place_note(resource)
        except (ValueError, cloud.CloudError):
            continue


def _markdown_index(user):
    known = known_markdown(user)
    by_path = {item['path']: item for item in known}
    try:
        for entry in walk_markdown(user):
            path = entry['path']
            if path in by_path:
                continue
            try:
                text = _read_text(identity_for(user), path)
                kind = markdown_type(text)
            except cloud.CloudError:
                kind = 'markdown'
            title = PurePosixPath(path).stem.replace('_', ' ') or path
            item = {
                'type': kind,
                'title': title,
                'path': path,
                'editable': False,
                'sync_state': 'external',
                'object_id': None,
            }
            known.append(item)
            by_path[path] = item
    except cloud.CloudError:
        pass
    return sorted(known, key=lambda item: item['path'].lower())


@require_http_methods(['GET'])
def space_overview(request):
    if response := _auth(request):
        return response
    _backfill_space(request.user)
    nodes = list(SpaceNode.objects.filter(owner=request.user).select_related('parent'))
    projects = list(ProjectSpacePlacement.objects.filter(owner=request.user).select_related('project', 'parent'))
    return JsonResponse({
        'ok': True,
        'root': {'title': 'Space', 'folder_path': 'Space', 'markdown_path': 'Space.md', 'tag': '@space'},
        'nodes': [_node_json(node) for node in nodes],
        'projects': [{
            'id': item.project_id,
            'title': item.project.title,
            'parent_id': item.parent_id,
            'folder_path': item.folder_path,
            'markdown_path': item.markdown_path,
            'sync_state': item.sync_state,
        } for item in projects],
        'markdown': _markdown_index(request.user),
        'native_url': cloud.native_files_url('Space'),
    })


@require_http_methods(['POST'])
def space_nodes(request):
    if response := _auth(request):
        return response
    data = _body(request)
    title = str(data.get('title') or '').strip()
    if not title:
        return _error('title_required')
    parent = None
    if data.get('parent_id'):
        parent = SpaceNode.objects.filter(pk=data['parent_id'], owner=request.user).first()
        if not parent:
            return _error('invalid_parent')
    try:
        node = create_space_node(request.user, title, data.get('kind'), parent)
    except ValueError as exc:
        return _error(str(exc))
    except cloud.CloudError:
        return _error('cloud_sync_failed', 503)
    return JsonResponse({'ok': True, 'item': _node_json(node)}, status=201)


@require_http_methods(['GET'])
def space_markdown_list(request):
    if response := _auth(request):
        return response
    _backfill_space(request.user)
    return JsonResponse({'ok': True, 'items': _markdown_index(request.user)})


@require_http_methods(['GET'])
def space_markdown_content(request):
    if response := _auth(request):
        return response
    path = str(request.GET.get('path') or '').strip('/')
    allowed = {item['path']: item for item in _markdown_index(request.user)}
    if path not in allowed:
        return _error('not_found', 404)
    try:
        text = _read_text(identity_for(request.user), path)
    except cloud.CloudError:
        return _error('cloud_unavailable', 503)
    return JsonResponse({'ok': True, 'item': allowed[path], 'content': text})


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def space_note_detail(request, resource_id):
    if response := _auth(request):
        return response
    resource = KnowledgeResource.objects.select_related('project', 'owner').filter(
        pk=resource_id, owner=request.user, kind=KnowledgeResource.Kind.NOTE
    ).first()
    if not resource or not can_view(request.user, resource):
        return _error('not_found', 404)
    placement = NoteSpacePlacement.objects.filter(resource=resource, owner=request.user).select_related('space_parent', 'parent_note').first()
    if request.method == 'GET':
        if not placement:
            try:
                placement = place_note(resource)
            except (ValueError, cloud.CloudError):
                placement = None
        return JsonResponse({'ok': True, 'item': _note_json(resource, placement)})
    if not can_edit(request.user, resource):
        return _error('permission_denied', 403)
    if request.method == 'DELETE':
        if placement:
            try:
                identity = identity_for(request.user)
                if cloud.path_exists(identity, placement.markdown_path):
                    cloud.delete(identity, placement.markdown_path)
                # Attachment folders can contain user data, therefore deleting a
                # note does not silently remove that folder. The user can clean it
                # up directly in Nextcloud after reviewing its contents.
            except cloud.CloudError:
                pass
        resource.delete()
        return JsonResponse({'ok': True})

    data = _body(request)
    old_path = placement.markdown_path if placement else None
    old_title = resource.title
    if 'title' in data:
        title = str(data['title']).strip()
        if not title:
            return _error('title_required')
        resource.title = title[:240]
    if 'description' in data:
        resource.description = str(data['description']).strip()
    if 'body' in data:
        resource.body = str(data['body'])
    resource.save()

    space_parent = placement.space_parent if placement else None
    project = placement.project if placement else resource.project
    parent_note = placement.parent_note if placement else None
    if data.get('space_parent_id'):
        space_parent = SpaceNode.objects.filter(pk=data['space_parent_id'], owner=request.user, kind=SpaceNode.Kind.CATEGORY).first()
        if not space_parent:
            return _error('invalid_space_parent')
        project = None
        parent_note = None
    if data.get('project_id'):
        project = ResearchProject.objects.filter(pk=data['project_id']).first()
        if not project or not can_edit(request.user, project):
            return _error('invalid_project')
        space_parent = None
        parent_note = None
    if data.get('parent_note_id'):
        parent_note = NoteSpacePlacement.objects.filter(resource_id=data['parent_note_id'], owner=request.user).first()
        if not parent_note:
            return _error('invalid_parent_note')
        project = None
        space_parent = None
    try:
        if not placement:
            placement = place_note(resource, space_parent=space_parent, project=project, parent_note=parent_note)
        elif any(key in data for key in ('space_parent_id', 'project_id', 'parent_note_id')):
            placement = place_note(resource, space_parent=space_parent, project=project, parent_note=parent_note)
        elif old_title != resource.title and not placement.children.exists():
            identity = identity_for(request.user)
            attachments_exist = cloud.path_exists(identity, placement.attachments_path)
            if not attachments_exist:
                base = str(PurePosixPath(placement.markdown_path).parent)
                name = storage_name(resource.title)
                placement.storage_name = name
                placement.markdown_path = f'{base}/{name}.md'
                placement.attachments_path = f'{base}/{name}'
                placement.save(update_fields=['storage_name', 'markdown_path', 'attachments_path', 'updated_at'])
                sync_note(resource)
                if old_path and old_path != placement.markdown_path and cloud.path_exists(identity, old_path):
                    cloud.delete(identity, old_path)
            else:
                # Keep a stable filesystem name when an attachment folder exists;
                # moving a non-empty directory must be an explicit Nextcloud action.
                sync_note(resource)
        else:
            sync_note(resource)
    except ValueError as exc:
        return _error(str(exc))
    except cloud.CloudError:
        return _error('cloud_sync_failed', 503)
    placement.refresh_from_db()
    return JsonResponse({'ok': True, 'item': _note_json(resource, placement)})


@require_http_methods(['GET', 'POST'])
def space_note_attachments(request, resource_id):
    if response := _auth(request):
        return response
    resource = KnowledgeResource.objects.filter(pk=resource_id, owner=request.user, kind=KnowledgeResource.Kind.NOTE).first()
    if not resource or not can_view(request.user, resource):
        return _error('not_found', 404)
    placement = NoteSpacePlacement.objects.filter(resource=resource, owner=request.user).first()
    if not placement:
        try:
            placement = place_note(resource)
        except (ValueError, cloud.CloudError):
            return _error('cloud_sync_failed', 503)
    if request.method == 'GET':
        try:
            identity = identity_for(request.user)
            items = _list_dir(identity, placement.attachments_path) if cloud.path_exists(identity, placement.attachments_path) else []
        except cloud.CloudError:
            return _error('cloud_unavailable', 503)
        return JsonResponse({'ok': True, 'items': [item for item in items if not item['is_dir']], 'path': placement.attachments_path})
    if not can_edit(request.user, resource):
        return _error('permission_denied', 403)
    uploaded = request.FILES.get('file')
    if not uploaded:
        return _error('file_required')
    try:
        item = upload_note_attachment(resource, uploaded)
    except ValueError as exc:
        return _error(str(exc), 409)
    except cloud.CloudError:
        return _error('cloud_unavailable', 503)
    return JsonResponse({'ok': True, 'item': item}, status=201)


@require_http_methods(['POST'])
def space_sync(request):
    if response := _auth(request):
        return response
    data = _body(request)
    direction = str(data.get('direction') or 'cloud_to_db')
    try:
        if direction == 'db_to_cloud':
            items = sync_all_to_cloud(request.user)
            return JsonResponse({'ok': True, 'direction': direction, 'items': items})
        changes = review_cloud_changes(request.user, confirm=bool(data.get('confirm')))
        return JsonResponse({
            'ok': True,
            'direction': 'cloud_to_db',
            'confirmed': bool(data.get('confirm')),
            'changes': changes,
            'requires_confirmation': any(item.get('requires_confirmation') and not item.get('applied') for item in changes),
        })
    except cloud.CloudError:
        return _error('cloud_unavailable', 503)


@require_http_methods(['GET', 'POST'])
def platform_projects_v6(request):
    if request.method == 'GET':
        return base_projects(request)
    if response := _auth(request):
        return response
    data = _body(request)
    parent = None
    if data.get('space_parent_id'):
        parent = SpaceNode.objects.filter(pk=data['space_parent_id'], owner=request.user, kind=SpaceNode.Kind.CATEGORY).first()
        if not parent:
            return _error('project_parent_must_be_category')
    response = base_projects(request)
    if response.status_code >= 400:
        return response
    payload = _response_data(response)
    project = ResearchProject.objects.filter(pk=(payload.get('project') or {}).get('id')).first()
    if project:
        try:
            placement = place_project(project, parent)
            payload['project']['space'] = _placement_json(placement)
        except (ValueError, cloud.CloudError):
            payload['project']['space'] = {'sync_state': 'pending'}
    return JsonResponse(payload, status=response.status_code)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def platform_project_detail_v6(request, project_id):
    if request.method == 'GET':
        response = base_project_detail(request, project_id)
        if response.status_code >= 400:
            return response
        payload = _response_data(response)
        project = ResearchProject.objects.filter(pk=project_id, owner=request.user).first()
        placement = ProjectSpacePlacement.objects.filter(project_id=project_id, owner=request.user).first()
        if project and not placement:
            try:
                placement = place_project(project)
            except (ValueError, cloud.CloudError):
                placement = None
        if placement:
            payload['project']['space'] = _placement_json(placement)
        return JsonResponse(payload)
    data = _body(request) if request.method == 'PATCH' else {}
    response = base_project_detail(request, project_id)
    if response.status_code >= 400 or request.method == 'DELETE':
        return response
    project = ResearchProject.objects.filter(pk=project_id).first()
    if project and project.owner_id == request.user.pk:
        parent = None
        if data.get('space_parent_id'):
            parent = SpaceNode.objects.filter(pk=data['space_parent_id'], owner=request.user, kind=SpaceNode.Kind.CATEGORY).first()
            if not parent:
                return _error('project_parent_must_be_category')
        current = ProjectSpacePlacement.objects.filter(project=project, owner=request.user).select_related('parent').first()
        try:
            placement = place_project(project, parent or (current.parent if current else None))
            payload = _response_data(response)
            payload['project']['space'] = _placement_json(placement)
            return JsonResponse(payload)
        except (ValueError, cloud.CloudError):
            pass
    return response


@require_http_methods(['GET', 'POST'])
def platform_resources_v6(request):
    if request.method == 'GET':
        return base_resources(request)
    if response := _auth(request):
        return response
    data = _body(request)
    response = base_resources(request)
    if response.status_code >= 400 or str(data.get('kind')) != KnowledgeResource.Kind.NOTE:
        return response
    payload = _response_data(response)
    item = payload.get('item') or {}
    resource = KnowledgeResource.objects.filter(pk=item.get('id'), owner=request.user).first()
    if not resource:
        return response
    space_parent = None
    if data.get('space_parent_id'):
        space_parent = SpaceNode.objects.filter(pk=data['space_parent_id'], owner=request.user, kind=SpaceNode.Kind.CATEGORY).first()
        if not space_parent:
            resource.delete()
            return _error('invalid_space_parent')
    parent_note = None
    if data.get('parent_note_id'):
        parent_note = NoteSpacePlacement.objects.filter(resource_id=data['parent_note_id'], owner=request.user).first()
        if not parent_note:
            resource.delete()
            return _error('invalid_parent_note')
    try:
        placement = place_note(resource, space_parent=space_parent, project=resource.project if not space_parent and not parent_note else None, parent_note=parent_note)
        item['space'] = {
            'markdown_path': placement.markdown_path,
            'attachments_path': placement.attachments_path,
            'sync_state': placement.sync_state,
        }
    except (ValueError, cloud.CloudError):
        item['space'] = {'sync_state': 'pending'}
    payload['item'] = item
    return JsonResponse(payload, status=response.status_code)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def platform_resource_detail_v6(request, resource_id):
    resource = KnowledgeResource.objects.filter(pk=resource_id).first()
    was_note = bool(resource and resource.kind == KnowledgeResource.Kind.NOTE)
    response = base_resource_detail(request, resource_id)
    if response.status_code >= 400 or not was_note or request.method == 'DELETE':
        return response
    resource = KnowledgeResource.objects.filter(pk=resource_id, owner=request.user).first()
    if resource:
        try:
            sync_note(resource)
        except cloud.CloudError:
            pass
    return response
