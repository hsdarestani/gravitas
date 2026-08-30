import hashlib
import json
import logging
from pathlib import PurePosixPath
from urllib.parse import quote

from django.conf import settings
from django.db import transaction
from django.db.models import Q, Sum
from django.http import JsonResponse, StreamingHttpResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from . import cloud, nextcloud_bridge
from .models import Collection, KnowledgeResource, StoragePlan
from .platform_access import (
    INHERIT_VISIBILITY,
    VALID_VISIBILITIES,
    can_edit,
    can_view,
    downloads_allowed,
    inherited_from,
    policy_for,
)
from .platform_api import _audit, _resource_json, ensure_dual_workspaces
from .platform_models import ObjectPolicy, ShareLink

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


def _collection_ancestors(item):
    result, seen, current = [], set(), item
    while current:
        if current.pk in seen:
            raise ValueError('folder_cycle')
        seen.add(current.pk)
        result.append(current)
        current = current.parent
    return list(reversed(result))


def _project_storage_path(project, collection, filename):
    return nextcloud_bridge.project_storage_path(project, collection, filename)


def _personal_storage_path(collection, filename):
    parts = ['Gravitas', 'My Files']
    if collection:
        parts.extend(cloud.safe_filename(item.name) for item in _collection_ancestors(collection))
    if filename:
        parts.append(cloud.safe_filename(filename))
    return '/'.join(parts)


def _storage_path(project, collection, filename):
    return _project_storage_path(project, collection, filename) if project else _personal_storage_path(collection, filename)


def _visibility(data, project, workspace, collection=None):
    requested = str(data.get('visibility', '')).strip()
    if requested and requested not in VALID_VISIBILITIES:
        raise ValueError('invalid_visibility')
    if requested:
        return requested
    if project:
        # Project items inherit their folder/project ACL unless explicitly
        # overridden. This is the key to keeping Gravitas and Team Folders in
        # one permission tree.
        return INHERIT_VISIBILITY
    if workspace.kind == 'personal':
        return ObjectPolicy.Visibility.PRIVATE
    return ObjectPolicy.Visibility.PRIVATE


def _resolve_context(user, data):
    spaces = ensure_dual_workspaces(user)
    workspace_id = str(data.get('workspace_id') or '').strip()
    workspace = None
    if workspace_id:
        workspace = next((item for item in spaces.values() if str(item.pk) == workspace_id), None)
    if workspace is None:
        workspace = spaces['personal']
    project = None
    if data.get('project_id'):
        from .models import ResearchProject
        project = ResearchProject.objects.select_related('workspace', 'owner').filter(pk=data['project_id']).first()
        if not project or not can_edit(user, project):
            raise PermissionError
        workspace = project.workspace
    collection = None
    if data.get('collection_id'):
        collection = Collection.objects.select_related('workspace', 'project', 'parent').filter(pk=data['collection_id'], workspace=workspace).first()
        if not collection or not can_view(user, collection):
            raise ValueError('invalid_collection')
        if collection.project_id and (not project or collection.project_id != project.pk):
            raise ValueError('collection_project_mismatch')
        if project and not collection.project_id:
            raise ValueError('collection_project_mismatch')
    return workspace, project, collection


def _apply_policy(resource, user, visibility, allow_download=True):
    policy = policy_for(resource, create=True, created_by=user, default_visibility=visibility)
    policy.visibility = visibility
    policy.allow_download = bool(allow_download)
    policy.save(update_fields=['visibility', 'allow_download', 'updated_at'])
    return policy


def _resource_detail_json(resource, user):
    data = _resource_json(resource)
    policy = policy_for(resource)
    data.update({
        'body': resource.body,
        'source_url': resource.source_url,
        'mime_type': resource.mime_type,
        'metadata': resource.metadata,
        'collection_id': resource.collection_id,
        'collection_name': resource.collection.name if resource.collection else None,
        'native_url': nextcloud_bridge.native_url_for(resource) if resource.project_id else cloud.native_files_url('Gravitas/My Files'),
        'permissions': {
            'can_view': can_view(user, resource),
            'can_edit': can_edit(user, resource),
        },
        'policy': {
            'visibility': policy.visibility if policy else INHERIT_VISIBILITY,
            'allow_download': policy.allow_download if policy else True,
            'inherited_from': inherited_from(resource),
        },
    })
    return data


@require_http_methods(['GET', 'POST'])
def platform_resources(request):
    if response := _auth(request):
        return response
    spaces = ensure_dual_workspaces(request.user)
    if request.method == 'GET':
        qs = KnowledgeResource.objects.select_related('workspace', 'project', 'collection', 'owner').filter(
            workspace__in=list(spaces.values())
        )
        if request.GET.get('workspace') in spaces:
            qs = qs.filter(workspace=spaces[request.GET['workspace']])
        if request.GET.get('project'):
            qs = qs.filter(project_id=request.GET['project'])
        if request.GET.get('kind') in KnowledgeResource.Kind.values:
            qs = qs.filter(kind=request.GET['kind'])
        query = request.GET.get('q', '').strip()[:200]
        if query:
            qs = qs.filter(
                Q(title__icontains=query) | Q(description__icontains=query) |
                Q(body__icontains=query) | Q(original_name__icontains=query) |
                Q(source_url__icontains=query)
            ).distinct()
        items = [item for item in qs[:800] if can_view(request.user, item)]
        return JsonResponse({'ok': True, 'items': [_resource_json(item) for item in items[:300]]})

    data = _body(request)
    kind = str(data.get('kind', 'note')).strip()
    if kind not in {'note', 'paper'}:
        return _error('use_upload_endpoint')
    title = str(data.get('title', '')).strip()[:240]
    if not title:
        return _error('title_required')
    try:
        workspace, project, collection = _resolve_context(request.user, data)
        visibility = _visibility(data, project, workspace, collection)
    except PermissionError:
        return _error('permission_denied', 403)
    except ValueError as exc:
        return _error(str(exc))
    resource = KnowledgeResource.objects.create(
        workspace=workspace,
        project=project,
        collection=collection,
        owner=request.user,
        kind=kind,
        title=title,
        description=str(data.get('description', '')).strip(),
        body=str(data.get('body', '')).strip(),
        source_url=str(data.get('source_url', '')).strip()[:1000],
        metadata=data.get('metadata') if isinstance(data.get('metadata'), dict) else {},
    )
    _apply_policy(resource, request.user, visibility, data.get('allow_download') is not False)
    _audit(project, request.user, f'{kind}_created', resource, visibility=visibility)
    return JsonResponse({'ok': True, 'item': _resource_detail_json(resource, request.user)}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def platform_resource_detail(request, resource_id):
    if response := _auth(request):
        return response
    resource = KnowledgeResource.objects.select_related('workspace', 'project', 'collection', 'owner').filter(pk=resource_id).first()
    if not resource or not can_view(request.user, resource):
        return _error('not_found', 404)
    if request.method == 'GET':
        _audit(resource.project, request.user, 'resource_viewed', resource)
        return JsonResponse({'ok': True, 'item': _resource_detail_json(resource, request.user)})
    if not can_edit(request.user, resource):
        return _error('permission_denied', 403)
    if request.method == 'DELETE':
        if resource.storage_path:
            try:
                identity = nextcloud_bridge.ensure_user(request.user if resource.project_id else resource.owner)
                cloud.delete(identity, resource.storage_path)
            except cloud.CloudError:
                logger.exception('V4 cloud delete failed for resource %s', resource.pk)
                return _error('cloud_unavailable', 503)
        project = resource.project
        _audit(project, request.user, 'resource_deleted', resource, title=resource.title)
        resource.delete()
        return JsonResponse({'ok': True})

    data = _body(request)
    if 'title' in data:
        resource.title = str(data['title']).strip()[:240]
        if not resource.title:
            return _error('title_required')
    if 'description' in data:
        resource.description = str(data['description']).strip()
    if 'body' in data and resource.kind == 'note':
        resource.body = str(data['body']).strip()
    if 'source_url' in data and resource.kind == 'paper':
        resource.source_url = str(data['source_url']).strip()[:1000]
    try:
        if 'visibility' in data:
            visibility = _visibility(data, resource.project, resource.workspace, resource.collection)
            _apply_policy(resource, request.user, visibility, data.get('allow_download', True))
        elif 'allow_download' in data:
            policy = policy_for(resource, create=True, created_by=request.user)
            policy.allow_download = bool(data['allow_download'])
            policy.save(update_fields=['allow_download', 'updated_at'])
        resource.save()
        if resource.project_id and resource.storage_path:
            nextcloud_bridge.sync_resource_acl(resource)
    except ValueError as exc:
        return _error(str(exc))
    except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
        logger.exception('Could not synchronize resource ACL %s to Nextcloud', resource.pk)
        return _error('cloud_acl_sync_failed', 503)
    _audit(resource.project, request.user, 'resource_updated', resource)
    return JsonResponse({'ok': True, 'item': _resource_detail_json(resource, request.user)})


@require_http_methods(['POST'])
def platform_file_upload(request):
    if response := _auth(request):
        return response
    uploaded = request.FILES.get('file')
    if not uploaded:
        return _error('file_required')
    kind = request.POST.get('kind', 'file')
    if kind not in FILE_KINDS:
        return _error('invalid_kind')
    if uploaded.size <= 0 or uploaded.size > settings.GRAVITAS_MAX_UPLOAD_BYTES:
        return _error('file_size_invalid', 413, max_bytes=settings.GRAVITAS_MAX_UPLOAD_BYTES)
    filename = cloud.safe_filename(uploaded.name)
    if kind == 'dataset' and PurePosixPath(filename).suffix.lower() not in DATASET_EXTENSIONS:
        return _error('unsupported_dataset_type', 415, allowed=sorted(DATASET_EXTENSIONS))
    try:
        workspace, project, collection = _resolve_context(request.user, request.POST)
        visibility = _visibility(request.POST, project, workspace, collection)
    except PermissionError:
        return _error('permission_denied', 403)
    except ValueError as exc:
        return _error(str(exc))
    if project and not can_edit(request.user, project):
        return _error('permission_denied', 403)
    if KnowledgeResource.objects.filter(
        workspace=workspace,
        project=project,
        collection=collection,
        original_name__iexact=filename,
        kind__in=FILE_KINDS,
    ).exists():
        return _error('file_exists', 409)

    try:
        if project:
            nextcloud_bridge.ensure_project_space(project)
    except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
        logger.exception('Could not provision Team Folder for project %s', project.pk if project else None)
        return _error('cloud_unavailable', 503)

    with transaction.atomic():
        plan = _plan(request.user, lock=True)
        used = KnowledgeResource.objects.filter(owner=request.user).aggregate(total=Sum('file_size'))['total'] or 0
        if used + uploaded.size > plan.quota_bytes:
            return _error('quota_exceeded', 413)
        path = _storage_path(project, collection, filename)
        resource = KnowledgeResource.objects.create(
            workspace=workspace,
            project=project,
            collection=collection,
            owner=request.user,
            kind=kind,
            title=(request.POST.get('title') or filename)[:240],
            description=request.POST.get('description', '').strip(),
            original_name=filename,
            mime_type=(uploaded.content_type or 'application/octet-stream')[:160],
            file_size=uploaded.size,
            ingestion_status='pending',
            metadata={
                'extension': PurePosixPath(filename).suffix.lower(),
                'storage_zone': collection.name if collection else ('project-root' if project else 'personal'),
                'project_data_room': bool(project),
                'nextcloud_team_folder': bool(project),
            },
            storage_path=path,
        )
        _apply_policy(resource, request.user, visibility, request.POST.get('allow_download', '1') not in {'0', 'false', 'False'})
    try:
        identity = nextcloud_bridge.ensure_user(request.user)
        digest = hashlib.sha256()
        uploaded.seek(0)
        for chunk in uploaded.chunks():
            digest.update(chunk)
        uploaded.seek(0)
        cloud.upload(identity, resource.storage_path, uploaded)
        if project:
            nextcloud_bridge.sync_resource_acl(resource)
    except Exception:
        try:
            if resource.storage_path:
                cloud.delete(identity, resource.storage_path)
        except Exception:
            pass
        resource.delete()
        logger.exception('V4 cloud upload failed for user %s', request.user.pk)
        return _error('cloud_unavailable', 503)
    resource.checksum = f'sha256:{digest.hexdigest()}'
    resource.save(update_fields=['checksum', 'updated_at'])
    _audit(project, request.user, f'{kind}_uploaded', resource, path=resource.storage_path, size=resource.file_size, visibility=visibility)
    return JsonResponse({'ok': True, 'item': _resource_detail_json(resource, request.user)}, status=201)


def _download_response(resource, access_user=None):
    try:
        identity_user = access_user if (access_user and resource.project_id) else resource.owner
        upstream = cloud.download(
            nextcloud_bridge.ensure_user(identity_user),
            resource.storage_path,
        )
    except cloud.CloudError:
        logger.exception('V4 cloud download failed for resource %s', resource.pk)
        return _error('cloud_unavailable', 503)
    response = StreamingHttpResponse(
        upstream.iter_content(chunk_size=64 * 1024),
        content_type=resource.mime_type or 'application/octet-stream',
    )
    response['Content-Length'] = resource.file_size
    response['Content-Disposition'] = f"attachment; filename*=UTF-8''{quote(resource.original_name, safe='')}"
    response['X-Content-Type-Options'] = 'nosniff'
    return response


@require_http_methods(['GET'])
def platform_file_download(request, resource_id):
    if response := _auth(request):
        return response
    resource = KnowledgeResource.objects.select_related('owner', 'project').filter(pk=resource_id).first()
    if not resource or not resource.storage_path or not can_view(request.user, resource):
        return _error('not_found', 404)
    if not downloads_allowed(resource):
        return _error('download_not_allowed', 403)
    _audit(resource.project, request.user, 'resource_downloaded', resource)
    return _download_response(resource, request.user)


@require_http_methods(['GET'])
def shared_file_download(request, token):
    now = timezone.now()
    link = ShareLink.objects.select_related('content_type').filter(
        token=token,
        active=True,
        allow_download=True,
    ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now)).first()
    resource = link.content_object if link else None
    if not isinstance(resource, KnowledgeResource) or not resource.storage_path:
        return _error('not_found', 404)
    if not downloads_allowed(resource):
        return _error('download_not_allowed', 403)
    _audit(resource.project, request.user if request.user.is_authenticated else None, 'shared_resource_downloaded', resource, share_link_id=link.pk)
    # Shared-link downloads are brokered with the project owner's Team Folder
    # identity after Gravitas validates the link policy.
    access_user = resource.project.owner if resource.project_id else None
    return _download_response(resource, access_user)
