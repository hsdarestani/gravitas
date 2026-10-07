import hashlib
import json
import logging
from collections import defaultdict
from pathlib import PurePosixPath
from urllib.parse import quote

from django.conf import settings
from django.db import IntegrityError, connection, transaction
from django.db.models import Count, Q, Sum
from django.http import JsonResponse, StreamingHttpResponse
from django.utils import timezone
from django.utils.text import slugify
from django.views.decorators.http import require_http_methods

from . import cloud
from .models import (
    Collection, KnowledgeActivity, KnowledgeLink, KnowledgeResource,
    ProjectMembership, ResearchProject, StoragePlan, Tag, Workspace,
    WorkspaceMembership,
)

logger = logging.getLogger(__name__)
DATASET_EXTENSIONS = {'.csv', '.tsv', '.xlsx', '.xls', '.json', '.jsonl', '.zip', '.parquet', '.xml'}
FILE_KINDS = {KnowledgeResource.Kind.FILE, KnowledgeResource.Kind.DATASET}


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _auth(request):
    return _error('authentication_required', 401) if not request.user.is_authenticated else None


def _plan(user, *, lock=False):
    query = StoragePlan.objects.select_for_update() if lock else StoragePlan.objects
    plan, _ = query.get_or_create(
        user=user,
        defaults={'tier': 'free', 'quota_bytes': settings.GRAVITAS_DEFAULT_QUOTA_BYTES},
    )
    return plan


@transaction.atomic
def provision_personal_workspace(user):
    workspace, _ = Workspace.objects.get_or_create(
        owner=user,
        kind=Workspace.Kind.PERSONAL,
        defaults={'name': f"{user.first_name or 'My'} Research Workspace"},
    )
    WorkspaceMembership.objects.get_or_create(
        workspace=workspace,
        user=user,
        defaults={'role': WorkspaceMembership.Role.OWNER},
    )
    _plan(user)
    return workspace


def _accessible_workspaces(user):
    provision_personal_workspace(user)
    return Workspace.objects.filter(Q(owner=user) | Q(memberships__user=user)).distinct()


def _workspace_for(user, workspace_id=None):
    if not workspace_id:
        return provision_personal_workspace(user)
    return _accessible_workspaces(user).filter(pk=workspace_id).first()


def _workspace_role(user, workspace):
    if workspace.kind == Workspace.Kind.PERSONAL and workspace.owner_id == user.pk:
        return WorkspaceMembership.Role.OWNER
    membership = WorkspaceMembership.objects.filter(workspace=workspace, user=user).first()
    return membership.role if membership else None


def _can_edit_workspace(user, workspace):
    return _workspace_role(user, workspace) in {'owner', 'admin', 'member'}


def _can_manage_workspace(user, workspace):
    return _workspace_role(user, workspace) in {'owner', 'admin'}


def _project_for(user, pk):
    return ResearchProject.objects.select_related('workspace', 'owner').filter(
        Q(workspace__owner=user) | Q(workspace__memberships__user=user), pk=pk,
    ).distinct().first()


def _project_role(user, project):
    workspace_role = _workspace_role(user, project.workspace)
    if workspace_role in {'owner', 'admin'}:
        return workspace_role
    membership = ProjectMembership.objects.filter(project=project, user=user).first()
    if membership:
        return membership.role
    return ProjectMembership.Role.EDITOR if workspace_role == 'member' else None


def _can_edit_project(user, project):
    return _project_role(user, project) in {'owner', 'admin', 'editor'}


def _can_manage_project(user, project):
    return _project_role(user, project) in {'owner', 'admin'}


def _resource_for(user, pk):
    return KnowledgeResource.objects.select_related(
        'workspace', 'project', 'collection', 'owner',
    ).prefetch_related('tags').filter(
        Q(workspace__owner=user) | Q(workspace__memberships__user=user), pk=pk,
    ).distinct().first()


def _can_edit_resource(user, resource):
    return _can_edit_project(user, resource.project) if resource.project_id else _can_edit_workspace(user, resource.workspace)


def _touch_project(project):
    if project:
        ResearchProject.objects.filter(pk=project.pk).update(updated_at=timezone.now())


def _activity(workspace, user, action, resource=None, project=None, **detail):
    KnowledgeActivity.objects.create(
        workspace=workspace, actor=user, action=action, resource=resource,
        project=project, detail=detail,
    )
    _touch_project(project)


def _activity_json(activity):
    labels = {
        'project_created': 'Created project', 'project_updated': 'Updated project',
        'project_archived': 'Archived project', 'note_created': 'Created note',
        'note_edited': 'Edited note', 'paper_created': 'Added reference',
        'paper_edited': 'Updated reference', 'file_uploaded': 'Uploaded file',
        'dataset_uploaded': 'Uploaded dataset', 'resource_updated': 'Updated knowledge item',
        'resource_deleted': 'Deleted knowledge item', 'item_moved': 'Moved item',
        'item_renamed': 'Renamed item', 'folder_created': 'Created folder',
        'folder_moved': 'Moved folder', 'folder_renamed': 'Renamed folder',
        'knowledge_linked': 'Linked knowledge', 'knowledge_unlinked': 'Removed knowledge link',
    }
    return {
        'id': activity.pk, 'action': activity.action,
        'label': labels.get(activity.action, 'Updated workspace'),
        'actor': (activity.actor.first_name or activity.actor.email) if activity.actor else 'Former member',
        'resource_id': activity.resource_id,
        'resource_title': activity.resource.title if activity.resource else activity.detail.get('title'),
        'project_id': activity.project_id,
        'project_title': activity.project.title if activity.project else None,
        'created_at': activity.created_at.isoformat(),
    }


def _project_json(project, user=None):
    count = getattr(project, 'resource_count', None)
    data = {
        'id': project.pk, 'workspace_id': project.workspace_id, 'title': project.title,
        'description': project.description, 'archived': project.archived,
        'owner': project.owner.first_name or project.owner.email,
        'resource_count': project.resources.count() if count is None else count,
        'created_at': project.created_at.isoformat(), 'updated_at': project.updated_at.isoformat(),
    }
    if user:
        data['permissions'] = {
            'role': _project_role(user, project), 'can_edit': _can_edit_project(user, project),
            'can_manage': _can_manage_project(user, project),
        }
    return data


def _resource_json(resource, include_body=False, user=None, include_links=False):
    data = {
        'id': resource.pk, 'workspace_id': resource.workspace_id, 'kind': resource.kind,
        'title': resource.title, 'description': resource.description,
        'source_url': resource.source_url, 'project_id': resource.project_id,
        'project_title': resource.project.title if resource.project else None,
        'collection_id': resource.collection_id,
        'collection_name': resource.collection.name if resource.collection else None,
        'original_name': resource.original_name, 'mime_type': resource.mime_type,
        'file_size': resource.file_size, 'has_download': bool(resource.storage_path),
        'ingestion_status': resource.ingestion_status,
        'tags': [{'id': tag.pk, 'name': tag.name, 'slug': tag.slug, 'color': tag.color} for tag in resource.tags.all()],
        'created_at': resource.created_at.isoformat(), 'updated_at': resource.updated_at.isoformat(),
    }
    if include_body:
        data.update(body=resource.body, metadata=resource.metadata)
    if user:
        data['permissions'] = {'can_edit': _can_edit_resource(user, resource)}
    if include_links:
        links = KnowledgeLink.objects.select_related(
            'source', 'target', 'source__project', 'target__project',
            'source__collection', 'target__collection',
        ).prefetch_related('source__tags', 'target__tags').filter(Q(source=resource) | Q(target=resource))
        data['related'] = [_link_json(link, resource) for link in links]
    return data


def _link_json(link, current):
    other = link.target if link.source_id == current.pk else link.source
    return {
        'id': link.pk, 'relation': link.relation,
        'direction': 'outgoing' if link.source_id == current.pk else 'backlink',
        'item': _resource_json(other), 'created_at': link.created_at.isoformat(),
    }


def _storage_json(user):
    plan = _plan(user)
    used = KnowledgeResource.objects.filter(owner=user).aggregate(total=Sum('file_size'))['total'] or 0
    quota = max(int(plan.quota_bytes), 1)
    percentage = round(min((used / quota) * 100, 100), 2)
    return {
        'tier': plan.tier, 'used_bytes': used, 'quota_bytes': quota,
        'remaining_bytes': max(quota - used, 0), 'percentage': percentage,
        'state': 'full' if percentage >= 100 else ('near_limit' if percentage >= 85 else 'ok'),
    }


def _collection_ancestors(item):
    result, seen, current = [], set(), item
    while current:
        if current.pk in seen:
            raise ValueError('folder_cycle')
        seen.add(current.pk)
        result.append(current)
        current = current.parent
    return list(reversed(result))


def _collection_path(collection):
    return cloud.drive_path([item.name for item in _collection_ancestors(collection)])


def _file_path(collection, filename):
    parts = [item.name for item in _collection_ancestors(collection)] if collection else []
    return cloud.drive_path(parts, filename)


def _collection_json(item):
    ancestors = _collection_ancestors(item)
    return {
        'id': item.pk, 'workspace_id': item.workspace_id, 'name': item.name,
        'project_id': item.project_id, 'parent_id': item.parent_id,
        'path': _collection_path(item),
        'breadcrumbs': [{'id': ancestor.pk, 'name': ancestor.name} for ancestor in ancestors],
        'child_count': getattr(item, 'child_count', item.children.count()),
        'resource_count': getattr(item, 'resource_count', item.resources.count()),
        'updated_at': item.updated_at.isoformat(),
    }


def _valid_folder_name(value):
    name = str(value or '').strip()[:180]
    if not name or name != cloud.safe_filename(name) or name in {'.', '..'}:
        raise ValueError('invalid_folder_name')
    return name


def _folder_permission(user, collection):
    return _can_edit_project(user, collection.project) if collection.project_id else _can_edit_workspace(user, collection.workspace)


def _resolve_relations(user, workspace, data):
    project = collection = None
    if data.get('project_id'):
        project = _project_for(user, data['project_id'])
        if not project or project.workspace_id != workspace.pk:
            raise ValueError('invalid_project')
        if not _can_edit_project(user, project):
            raise PermissionError
    if data.get('collection_id'):
        collection = Collection.objects.select_related('project', 'workspace', 'parent').filter(
            pk=data['collection_id'], workspace=workspace,
        ).first()
        if not collection:
            raise ValueError('invalid_collection')
        if not _folder_permission(user, collection):
            raise PermissionError
        if project and collection.project_id and collection.project_id != project.pk:
            raise ValueError('collection_project_mismatch')
    return project, collection


def _set_tags(resource, values):
    if values is None:
        return
    if isinstance(values, (str, int)):
        values = [values]
    ids = [int(value) for value in values if str(value).isdigit()]
    tags = list(Tag.objects.filter(workspace=resource.workspace, pk__in=ids))
    if len(tags) != len(set(ids)):
        raise ValueError('invalid_tag')
    resource.tags.set(tags)


@require_http_methods(['GET'])
def workspace_dashboard(request):
    if response := _auth(request): return response
    personal = provision_personal_workspace(request.user)
    workspace_ids = list(_accessible_workspaces(request.user).values_list('id', flat=True))
    projects_qs = ResearchProject.objects.filter(workspace_id__in=workspace_ids, archived=False).select_related('owner', 'workspace').annotate(resource_count=Count('resources', distinct=True))[:6]
    recent_qs = KnowledgeResource.objects.filter(workspace_id__in=workspace_ids).select_related('project', 'collection', 'workspace').prefetch_related('tags')[:10]
    recent_files = KnowledgeResource.objects.filter(workspace_id__in=workspace_ids, kind__in=FILE_KINDS).select_related('project', 'collection', 'workspace').prefetch_related('tags')[:6]
    activities = KnowledgeActivity.objects.filter(workspace_id__in=workspace_ids).select_related('actor', 'resource', 'project')[:12]
    return JsonResponse({
        'ok': True, 'workspace': {'id': personal.pk, 'name': personal.name, 'kind': personal.kind},
        'greeting_name': request.user.first_name or request.user.email.split('@')[0],
        'projects': [_project_json(item, request.user) for item in projects_qs],
        'recent': [_resource_json(item) for item in recent_qs],
        'recent_files': [_resource_json(item) for item in recent_files],
        'activity': [_activity_json(item) for item in activities], 'storage': _storage_json(request.user),
        'counts': {
            'projects': ResearchProject.objects.filter(workspace_id__in=workspace_ids, archived=False).count(),
            'notes': KnowledgeResource.objects.filter(workspace_id__in=workspace_ids, kind='note').count(),
            'files': KnowledgeResource.objects.filter(workspace_id__in=workspace_ids, kind='file').count(),
            'datasets': KnowledgeResource.objects.filter(workspace_id__in=workspace_ids, kind='dataset').count(),
        },
    })


@require_http_methods(['GET', 'POST'])
def projects(request):
    if response := _auth(request): return response
    if request.method == 'GET':
        qs = ResearchProject.objects.filter(workspace__in=_accessible_workspaces(request.user)).select_related('owner', 'workspace').annotate(resource_count=Count('resources', distinct=True))
        if request.GET.get('archived') in {'0', '1'}:
            qs = qs.filter(archived=request.GET['archived'] == '1')
        return JsonResponse({'ok': True, 'projects': [_project_json(item, request.user) for item in qs]})
    data = _body(request)
    workspace = _workspace_for(request.user, data.get('workspace_id'))
    if not workspace: return _error('not_found', 404)
    if not _can_edit_workspace(request.user, workspace): return _error('permission_denied', 403)
    title = str(data.get('title', '')).strip()[:220]
    if not title: return _error('title_required')
    project = ResearchProject.objects.create(
        workspace=workspace, owner=request.user, title=title,
        description=str(data.get('description', '')).strip(),
    )
    ProjectMembership.objects.get_or_create(project=project, user=request.user, defaults={'role': 'owner'})
    _activity(workspace, request.user, 'project_created', project=project)
    return JsonResponse({'ok': True, 'project': _project_json(project, request.user)}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def project_detail(request, project_id):
    if response := _auth(request): return response
    project = _project_for(request.user, project_id)
    if not project: return _error('not_found', 404)
    if request.method == 'GET':
        qs = project.resources.select_related('project', 'collection', 'workspace').prefetch_related('tags')
        query, kind = request.GET.get('q', '').strip()[:200], request.GET.get('kind', '').strip()
        if query:
            qs = qs.filter(
                Q(title__icontains=query) | Q(description__icontains=query) | Q(body__icontains=query) |
                Q(original_name__icontains=query) | Q(source_url__icontains=query) | Q(tags__name__icontains=query)
            ).distinct()
        if kind in KnowledgeResource.Kind.values: qs = qs.filter(kind=kind)
        activities = project.activities.select_related('actor', 'resource', 'project')[:20]
        folders = project.collections.select_related('parent', 'project', 'workspace').annotate(child_count=Count('children', distinct=True), resource_count=Count('resources', distinct=True))
        return JsonResponse({
            'ok': True, 'project': _project_json(project, request.user),
            'resources': [_resource_json(item) for item in qs[:300]],
            'folders': [_collection_json(item) for item in folders],
            'activity': [_activity_json(item) for item in activities],
            'counts': {value: project.resources.filter(kind=value).count() for value in KnowledgeResource.Kind.values},
        })
    if not _can_manage_project(request.user, project): return _error('permission_denied', 403)
    if request.method == 'DELETE':
        if project.resources.exists() or project.collections.exists(): return _error('project_not_empty', 409)
        project.delete()
        return JsonResponse({'ok': True})
    data = _body(request)
    if 'title' in data:
        project.title = str(data['title']).strip()[:220]
        if not project.title: return _error('title_required')
    if 'description' in data: project.description = str(data['description']).strip()
    if 'archived' in data: project.archived = bool(data['archived'])
    project.save()
    _activity(project.workspace, request.user, 'project_archived' if project.archived else 'project_updated', project=project)
    return JsonResponse({'ok': True, 'project': _project_json(project, request.user)})


@require_http_methods(['GET', 'POST'])
def resources(request):
    if response := _auth(request): return response
    if request.method == 'GET':
        qs = KnowledgeResource.objects.filter(workspace__in=_accessible_workspaces(request.user)).select_related('project', 'collection', 'workspace').prefetch_related('tags')
        kind, query = request.GET.get('kind', '').strip(), request.GET.get('q', '').strip()[:200]
        if kind in KnowledgeResource.Kind.values: qs = qs.filter(kind=kind)
        if request.GET.get('project'): qs = qs.filter(project_id=request.GET['project'])
        if request.GET.get('collection'): qs = qs.filter(collection_id=request.GET['collection'])
        if request.GET.get('tag'): qs = qs.filter(tags__id=request.GET['tag'])
        if request.GET.get('workspace'): qs = qs.filter(workspace_id=request.GET['workspace'])
        if query:
            search = (
                Q(title__icontains=query) | Q(description__icontains=query) | Q(body__icontains=query) |
                Q(original_name__icontains=query) | Q(source_url__icontains=query) |
                Q(tags__name__icontains=query)
            )
            if connection.vendor == 'postgresql':
                search |= Q(metadata__icontains=query)
            qs = qs.filter(search).distinct()
        return JsonResponse({'ok': True, 'items': [_resource_json(item) for item in qs[:300]]})
    data = _body(request)
    workspace = _workspace_for(request.user, data.get('workspace_id'))
    if not workspace: return _error('not_found', 404)
    if not _can_edit_workspace(request.user, workspace): return _error('permission_denied', 403)
    kind = str(data.get('kind', 'note'))
    if kind not in {'note', 'paper'}: return _error('use_upload_endpoint')
    title = str(data.get('title', '')).strip()[:240]
    if not title: return _error('title_required')
    try:
        project, collection = _resolve_relations(request.user, workspace, data)
    except PermissionError: return _error('permission_denied', 403)
    except ValueError as exc: return _error(str(exc))
    resource = KnowledgeResource.objects.create(
        workspace=workspace, project=project, collection=collection, owner=request.user,
        kind=kind, title=title, description=str(data.get('description', '')).strip(),
        body=str(data.get('body', '')).strip(), source_url=str(data.get('source_url', '')).strip()[:1000],
        metadata=data.get('metadata') if isinstance(data.get('metadata'), dict) else {},
    )
    try: _set_tags(resource, data.get('tag_ids'))
    except ValueError as exc:
        resource.delete()
        return _error(str(exc))
    _activity(workspace, request.user, f'{kind}_created', resource=resource, project=project)
    return JsonResponse({'ok': True, 'item': _resource_json(resource, True, request.user, True)}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def resource_detail(request, resource_id):
    if response := _auth(request): return response
    resource = _resource_for(request.user, resource_id)
    if not resource: return _error('not_found', 404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'item': _resource_json(resource, True, request.user, True)})
    if not _can_edit_resource(request.user, resource): return _error('permission_denied', 403)
    if request.method == 'DELETE':
        if resource.storage_path:
            try:
                cloud.delete(cloud.ensure_identity(resource.owner, _plan(resource.owner).quota_bytes), resource.storage_path)
            except cloud.CloudError:
                logger.exception('Cloud delete failed for resource %s', resource.pk)
                return _error('cloud_unavailable', 503)
        project, workspace, title = resource.project, resource.workspace, resource.title
        resource.delete()
        _activity(workspace, request.user, 'resource_deleted', project=project, title=title)
        return JsonResponse({'ok': True})
    data = _body(request)
    try: project, collection = _resolve_relations(request.user, resource.workspace, data)
    except PermissionError: return _error('permission_denied', 403)
    except ValueError as exc: return _error(str(exc))
    old_project, old_collection_id = resource.project, resource.collection_id
    old_name, old_path = resource.original_name, resource.storage_path
    if 'title' in data:
        resource.title = str(data['title']).strip()[:240]
        if not resource.title: return _error('title_required')
    if 'description' in data: resource.description = str(data['description']).strip()
    if 'body' in data and resource.kind == 'note': resource.body = str(data['body']).strip()
    if 'source_url' in data and resource.kind == 'paper': resource.source_url = str(data['source_url']).strip()[:1000]
    if 'project_id' in data: resource.project = project
    if 'collection_id' in data: resource.collection = collection
    filename = cloud.safe_filename(data['filename']) if data.get('filename') and resource.kind in FILE_KINDS else old_name
    cloud_moved, new_path, identity = False, old_path, None
    if old_path and resource.kind in FILE_KINDS:
        new_path = _file_path(resource.collection, filename)
        if KnowledgeResource.objects.filter(
            workspace=resource.workspace, collection=resource.collection,
            original_name__iexact=filename, kind__in=FILE_KINDS,
        ).exclude(pk=resource.pk).exists(): return _error('file_exists', 409)
        if new_path != old_path:
            try:
                identity = cloud.ensure_identity(resource.owner, _plan(resource.owner).quota_bytes)
                cloud.move(identity, old_path, new_path)
                cloud_moved = True
            except cloud.CloudError:
                logger.exception('Cloud move failed for resource %s', resource.pk)
                return _error('cloud_unavailable', 503)
        resource.storage_path, resource.original_name = new_path, filename
    try:
        with transaction.atomic():
            resource.save()
            _set_tags(resource, data.get('tag_ids'))
    except (IntegrityError, ValueError) as exc:
        if cloud_moved:
            try: cloud.move(identity, new_path, old_path)
            except cloud.CloudError: logger.exception('Could not roll back cloud move for resource %s', resource.pk)
        return _error(str(exc))
    action = 'item_moved' if old_collection_id != resource.collection_id else (
        'item_renamed' if old_name != resource.original_name else (
            'note_edited' if resource.kind == 'note' else ('paper_edited' if resource.kind == 'paper' else 'resource_updated')
        )
    )
    _activity(resource.workspace, request.user, action, resource=resource, project=resource.project)
    _touch_project(old_project)
    return JsonResponse({'ok': True, 'item': _resource_json(resource, True, request.user, True)})


@require_http_methods(['POST'])
def file_upload(request):
    if response := _auth(request): return response
    uploaded = request.FILES.get('file')
    if not uploaded: return _error('file_required')
    kind = request.POST.get('kind', 'file')
    if kind not in FILE_KINDS: return _error('invalid_kind')
    if uploaded.size <= 0 or uploaded.size > settings.GRAVITAS_MAX_UPLOAD_BYTES:
        return _error('file_size_invalid', 413, max_bytes=settings.GRAVITAS_MAX_UPLOAD_BYTES)
    filename = cloud.safe_filename(uploaded.name)
    if kind == 'dataset' and PurePosixPath(filename).suffix.lower() not in DATASET_EXTENSIONS:
        return _error('unsupported_dataset_type', 415, allowed=sorted(DATASET_EXTENSIONS))
    workspace = _workspace_for(request.user, request.POST.get('workspace_id'))
    if not workspace: return _error('not_found', 404)
    if not _can_edit_workspace(request.user, workspace): return _error('permission_denied', 403)
    try: project, collection = _resolve_relations(request.user, workspace, request.POST)
    except PermissionError: return _error('permission_denied', 403)
    except ValueError as exc: return _error(str(exc))
    if KnowledgeResource.objects.filter(
        workspace=workspace, collection=collection, original_name__iexact=filename, kind__in=FILE_KINDS,
    ).exists(): return _error('file_exists', 409)
    with transaction.atomic():
        plan = _plan(request.user, lock=True)
        used = KnowledgeResource.objects.filter(owner=request.user).aggregate(total=Sum('file_size'))['total'] or 0
        if used + uploaded.size > plan.quota_bytes: return _error('quota_exceeded', 413, storage=_storage_json(request.user))
        resource = KnowledgeResource.objects.create(
            workspace=workspace, project=project, collection=collection, owner=request.user,
            kind=kind, title=(request.POST.get('title') or filename)[:240],
            description=request.POST.get('description', '').strip(), original_name=filename,
            mime_type=(uploaded.content_type or 'application/octet-stream')[:160], file_size=uploaded.size,
            ingestion_status='pending', metadata={'extension': PurePosixPath(filename).suffix.lower()},
            storage_path=_file_path(collection, filename),
        )
        try: _set_tags(resource, request.POST.getlist('tag_ids'))
        except ValueError as exc:
            resource.delete()
            return _error(str(exc))
    try:
        identity = cloud.ensure_identity(request.user, plan.quota_bytes)
        digest = hashlib.sha256()
        uploaded.seek(0)
        for chunk in uploaded.chunks(): digest.update(chunk)
        uploaded.seek(0)
        cloud.upload(identity, resource.storage_path, uploaded)
    except Exception:
        resource.delete()
        logger.exception('Cloud upload failed for user %s', request.user.pk)
        return _error('cloud_unavailable', 503)
    resource.checksum = f'sha256:{digest.hexdigest()}'
    resource.save(update_fields=['checksum', 'updated_at'])
    _activity(workspace, request.user, f'{kind}_uploaded', resource=resource, project=project)
    return JsonResponse({'ok': True, 'item': _resource_json(resource, True, request.user, True), 'storage': _storage_json(request.user)}, status=201)


@require_http_methods(['GET'])
def file_download(request, resource_id):
    if response := _auth(request): return response
    resource = _resource_for(request.user, resource_id)
    if not resource or not resource.storage_path: return _error('not_found', 404)
    try:
        upstream = cloud.download(cloud.ensure_identity(resource.owner, _plan(resource.owner).quota_bytes), resource.storage_path)
    except cloud.CloudError:
        logger.exception('Cloud download failed for resource %s', resource.pk)
        return _error('cloud_unavailable', 503)
    response = StreamingHttpResponse(upstream.iter_content(chunk_size=64 * 1024), content_type=resource.mime_type or 'application/octet-stream')
    response['Content-Length'] = resource.file_size
    response['Content-Disposition'] = f"attachment; filename*=UTF-8''{quote(resource.original_name, safe='')}"
    response['X-Content-Type-Options'] = 'nosniff'
    return response


@require_http_methods(['GET'])
def storage_status(request):
    if response := _auth(request): return response
    provision_personal_workspace(request.user)
    return JsonResponse({'ok': True, 'storage': _storage_json(request.user), 'max_upload_bytes': settings.GRAVITAS_MAX_UPLOAD_BYTES})


@require_http_methods(['GET', 'POST'])
def collections(request):
    if response := _auth(request): return response
    if request.method == 'GET':
        workspace = _workspace_for(request.user, request.GET.get('workspace'))
        if not workspace: return _error('not_found', 404)
        qs = Collection.objects.filter(workspace=workspace).select_related('parent', 'project', 'workspace').annotate(child_count=Count('children', distinct=True), resource_count=Count('resources', distinct=True))
        if request.GET.get('project'): qs = qs.filter(project_id=request.GET['project'])
        return JsonResponse({'ok': True, 'collections': [_collection_json(item) for item in qs]})
    data = _body(request)
    workspace = _workspace_for(request.user, data.get('workspace_id'))
    if not workspace: return _error('not_found', 404)
    if not _can_edit_workspace(request.user, workspace): return _error('permission_denied', 403)
    try:
        name = _valid_folder_name(data.get('name'))
        project, _ = _resolve_relations(request.user, workspace, data)
    except PermissionError: return _error('permission_denied', 403)
    except ValueError as exc: return _error(str(exc))
    parent = None
    if data.get('parent_id'):
        parent = Collection.objects.select_related('project', 'workspace', 'parent').filter(pk=data['parent_id'], workspace=workspace).first()
        if not parent: return _error('invalid_parent')
        if not _folder_permission(request.user, parent): return _error('permission_denied', 403)
        if parent.project_id: project = parent.project
    if Collection.objects.filter(workspace=workspace, parent=parent, name__iexact=name).exists(): return _error('folder_exists', 409)
    item = Collection.objects.create(workspace=workspace, project=project, parent=parent, name=name, created_by=request.user)
    try:
        cloud.make_folder(cloud.ensure_identity(request.user, _plan(request.user).quota_bytes), _collection_path(item))
    except Exception:
        item.delete()
        logger.exception('Cloud folder creation failed for user %s', request.user.pk)
        return _error('cloud_unavailable', 503)
    _activity(workspace, request.user, 'folder_created', project=project, folder=name)
    return JsonResponse({'ok': True, 'collection': _collection_json(item)}, status=201)


def _collection_descendants(item):
    result, queue = [], [item]
    while queue:
        current = queue.pop(0)
        result.append(current)
        queue.extend(list(current.children.select_related('parent', 'project', 'workspace')))
    return result


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def collection_detail(request, collection_id):
    if response := _auth(request): return response
    item = Collection.objects.select_related('workspace', 'project', 'parent', 'created_by').filter(
        Q(workspace__owner=request.user) | Q(workspace__memberships__user=request.user), pk=collection_id,
    ).distinct().first()
    if not item: return _error('not_found', 404)
    if request.method == 'GET':
        children = item.children.select_related('parent', 'project', 'workspace').annotate(child_count=Count('children', distinct=True), resource_count=Count('resources', distinct=True))
        files = item.resources.filter(kind__in=FILE_KINDS).select_related('project', 'collection', 'workspace').prefetch_related('tags')
        return JsonResponse({'ok': True, 'collection': _collection_json(item), 'children': [_collection_json(child) for child in children], 'files': [_resource_json(file) for file in files]})
    if not _folder_permission(request.user, item): return _error('permission_denied', 403)
    if request.method == 'DELETE':
        if item.children.exists() or item.resources.exists(): return _error('folder_not_empty', 409)
        try:
            identity = cloud.ensure_identity(item.created_by, _plan(item.created_by).quota_bytes)
            if not cloud.folder_is_empty(identity, _collection_path(item)): return _error('folder_not_empty', 409)
            cloud.delete(identity, _collection_path(item))
        except cloud.CloudError:
            logger.exception('Cloud folder delete failed for collection %s', item.pk)
            return _error('cloud_unavailable', 503)
        item.delete()
        return JsonResponse({'ok': True})
    data = _body(request)
    try: new_name = _valid_folder_name(data.get('name', item.name))
    except ValueError as exc: return _error(str(exc))
    new_parent = item.parent
    if 'parent_id' in data:
        new_parent = None
        if data.get('parent_id'):
            new_parent = Collection.objects.select_related('project', 'workspace', 'parent').filter(pk=data['parent_id'], workspace=item.workspace).first()
            if not new_parent: return _error('invalid_parent')
            if new_parent.pk in {folder.pk for folder in _collection_descendants(item)}: return _error('folder_cycle')
            if not _folder_permission(request.user, new_parent): return _error('permission_denied', 403)
    if Collection.objects.filter(workspace=item.workspace, parent=new_parent, name__iexact=new_name).exclude(pk=item.pk).exists(): return _error('folder_exists', 409)
    old_base, subtree = _collection_path(item), _collection_descendants(item)
    old_paths = {folder.pk: _collection_path(folder) for folder in subtree}
    old_parent, old_name, old_project = item.parent, item.name, item.project
    item.parent, item.name = new_parent, new_name
    if new_parent and new_parent.project_id: item.project = new_parent.project
    new_base = _collection_path(item)
    resources_by_folder = defaultdict(list)
    for resource in KnowledgeResource.objects.filter(collection__in=subtree, kind__in=FILE_KINDS).select_related('owner', 'collection'):
        resources_by_folder[resource.collection_id].append(resource)
    file_moves, new_paths = [], {}
    for folder in subtree:
        relative = old_paths[folder.pk][len(old_base):].lstrip('/')
        new_folder_path = '/'.join(part for part in [new_base, relative] if part)
        new_paths[folder.pk] = new_folder_path
        for resource in resources_by_folder[folder.pk]:
            file_moves.append((resource, resource.storage_path, f'{new_folder_path}/{cloud.safe_filename(resource.original_name)}'))
    completed = []
    try:
        for resource, old_path, new_path in file_moves:
            if old_path and old_path != new_path:
                identity = cloud.ensure_identity(resource.owner, _plan(resource.owner).quota_bytes)
                cloud.move(identity, old_path, new_path)
                completed.append((identity, old_path, new_path))
        creator_identity = cloud.ensure_identity(item.created_by, _plan(item.created_by).quota_bytes)
        for folder in subtree:
            cloud.make_folder(creator_identity, new_paths[folder.pk])
        with transaction.atomic():
            item.save()
            for resource, _, new_path in file_moves:
                resource.storage_path = new_path
                resource.save(update_fields=['storage_path', 'updated_at'])
        if old_base != new_base:
            for folder in reversed(subtree):
                old_path = old_paths[folder.pk]
                try:
                    if cloud.folder_is_empty(creator_identity, old_path):
                        cloud.delete(creator_identity, old_path)
                except cloud.CloudError:
                    logger.warning('Old cloud folder could not be removed after move: %s', old_path)
    except Exception:
        for identity, old_path, new_path in reversed(completed):
            try: cloud.move(identity, new_path, old_path)
            except cloud.CloudError: logger.exception('Could not roll back folder move %s', item.pk)
        item.parent, item.name, item.project = old_parent, old_name, old_project
        logger.exception('Folder move failed for collection %s', item.pk)
        return _error('cloud_unavailable', 503)
    _activity(item.workspace, request.user, 'folder_moved' if old_parent != new_parent else 'folder_renamed', project=item.project, folder=item.name)
    return JsonResponse({'ok': True, 'collection': _collection_json(item)})


@require_http_methods(['GET', 'POST'])
def tags(request):
    if response := _auth(request): return response
    data = _body(request) if request.method == 'POST' else request.GET
    workspace = _workspace_for(request.user, data.get('workspace_id') or data.get('workspace'))
    if not workspace: return _error('not_found', 404)
    if request.method == 'GET':
        items = Tag.objects.filter(workspace=workspace).annotate(resource_count=Count('resources', distinct=True))
        return JsonResponse({'ok': True, 'tags': [{'id': item.pk, 'name': item.name, 'slug': item.slug, 'color': item.color, 'resource_count': item.resource_count} for item in items]})
    if not _can_edit_workspace(request.user, workspace): return _error('permission_denied', 403)
    name = str(data.get('name', '')).strip()[:80]
    if not name: return _error('name_required')
    base, index = slugify(name)[:80] or f'tag-{Tag.objects.filter(workspace=workspace).count() + 1}', 2
    slug = base
    while Tag.objects.filter(workspace=workspace, slug=slug).exists():
        slug, index = f'{base[:75]}-{index}', index + 1
    item = Tag.objects.create(workspace=workspace, name=name, slug=slug, color=str(data.get('color', '#7566f6'))[:16])
    return JsonResponse({'ok': True, 'tag': {'id': item.pk, 'name': item.name, 'slug': item.slug, 'color': item.color}}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def tag_detail(request, tag_id):
    if response := _auth(request): return response
    item = Tag.objects.select_related('workspace').filter(
        Q(workspace__owner=request.user) | Q(workspace__memberships__user=request.user), pk=tag_id,
    ).distinct().first()
    if not item: return _error('not_found', 404)
    if not _can_edit_workspace(request.user, item.workspace): return _error('permission_denied', 403)
    if request.method == 'DELETE': item.delete(); return JsonResponse({'ok': True})
    data = _body(request)
    name = str(data.get('name', item.name)).strip()[:80]
    if not name: return _error('name_required')
    item.name = name
    if 'color' in data: item.color = str(data['color'])[:16]
    item.save()
    return JsonResponse({'ok': True, 'tag': {'id': item.pk, 'name': item.name, 'slug': item.slug, 'color': item.color}})


@require_http_methods(['GET', 'POST'])
def knowledge_links(request, resource_id):
    if response := _auth(request): return response
    resource = _resource_for(request.user, resource_id)
    if not resource: return _error('not_found', 404)
    if request.method == 'GET':
        links = KnowledgeLink.objects.select_related(
            'source', 'target', 'source__project', 'target__project',
            'source__collection', 'target__collection',
        ).prefetch_related('source__tags', 'target__tags').filter(Q(source=resource) | Q(target=resource))
        return JsonResponse({'ok': True, 'links': [_link_json(link, resource) for link in links]})
    if not _can_edit_resource(request.user, resource): return _error('permission_denied', 403)
    data = _body(request)
    target = _resource_for(request.user, data.get('target_id'))
    if not target or target.workspace_id != resource.workspace_id: return _error('invalid_target')
    if target.pk == resource.pk: return _error('self_link_not_allowed')
    if not _can_edit_resource(request.user, target): return _error('permission_denied', 403)
    source, destination = (resource, target) if resource.pk < target.pk else (target, resource)
    relation = str(data.get('relation', 'related')).strip()[:40] or 'related'
    link, created = KnowledgeLink.objects.get_or_create(source=source, target=destination, relation=relation)
    if created: _activity(resource.workspace, request.user, 'knowledge_linked', resource=resource, project=resource.project, target_id=target.pk)
    return JsonResponse({'ok': True, 'link': _link_json(link, resource)}, status=201 if created else 200)


@require_http_methods(['DELETE'])
def knowledge_link_detail(request, resource_id, link_id):
    if response := _auth(request): return response
    resource = _resource_for(request.user, resource_id)
    if not resource: return _error('not_found', 404)
    if not _can_edit_resource(request.user, resource): return _error('permission_denied', 403)
    link = KnowledgeLink.objects.filter(pk=link_id).filter(Q(source=resource) | Q(target=resource)).first()
    if not link: return _error('not_found', 404)
    link.delete()
    _activity(resource.workspace, request.user, 'knowledge_unlinked', resource=resource, project=resource.project)
    return JsonResponse({'ok': True})
