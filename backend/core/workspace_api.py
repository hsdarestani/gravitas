import hashlib
import json
import logging
from pathlib import PurePosixPath
from urllib.parse import quote

from django.conf import settings
from django.db import transaction
from django.db.models import Q, Sum
from django.http import JsonResponse, StreamingHttpResponse
from django.utils.text import slugify
from django.views.decorators.http import require_http_methods

from . import cloud
from .models import (
    Collection,
    KnowledgeActivity,
    KnowledgeResource,
    ResearchProject,
    StoragePlan,
    Tag,
    Workspace,
    WorkspaceMembership,
)

logger = logging.getLogger(__name__)
DATASET_EXTENSIONS = {'.csv', '.tsv', '.xlsx', '.xls', '.json', '.jsonl', '.zip', '.parquet', '.xml'}


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _auth(request):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    return None


@transaction.atomic
def _personal_workspace(user):
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
    StoragePlan.objects.get_or_create(
        user=user,
        defaults={'tier': 'free', 'quota_bytes': settings.GRAVITAS_DEFAULT_QUOTA_BYTES},
    )
    return workspace


def _workspace_ids(user):
    personal = _personal_workspace(user)
    shared = WorkspaceMembership.objects.filter(user=user).values_list('workspace_id', flat=True)
    return personal, set(shared) | {personal.pk}


def _project_for(user, pk):
    _, workspace_ids = _workspace_ids(user)
    return ResearchProject.objects.filter(pk=pk, workspace_id__in=workspace_ids).first()


def _resource_for(user, pk):
    _, workspace_ids = _workspace_ids(user)
    return KnowledgeResource.objects.select_related('project', 'collection').prefetch_related('tags').filter(
        pk=pk, workspace_id__in=workspace_ids,
    ).first()


def _activity(workspace, user, action, resource=None, project=None, **detail):
    KnowledgeActivity.objects.create(
        workspace=workspace,
        actor=user,
        action=action,
        resource=resource,
        project=project,
        detail=detail,
    )


def _project_json(project):
    return {
        'id': project.pk,
        'title': project.title,
        'description': project.description,
        'archived': project.archived,
        'owner': project.owner.first_name or project.owner.email,
        'resource_count': getattr(project, 'resource_count', project.resources.count()),
        'created_at': project.created_at.isoformat(),
        'updated_at': project.updated_at.isoformat(),
    }


def _resource_json(resource, include_body=False):
    data = {
        'id': resource.pk,
        'kind': resource.kind,
        'title': resource.title,
        'description': resource.description,
        'source_url': resource.source_url,
        'project_id': resource.project_id,
        'project_title': resource.project.title if resource.project else None,
        'collection_id': resource.collection_id,
        'collection_name': resource.collection.name if resource.collection else None,
        'original_name': resource.original_name,
        'mime_type': resource.mime_type,
        'file_size': resource.file_size,
        'ingestion_status': resource.ingestion_status,
        'tags': [{'id': tag.pk, 'name': tag.name, 'slug': tag.slug, 'color': tag.color} for tag in resource.tags.all()],
        'created_at': resource.created_at.isoformat(),
        'updated_at': resource.updated_at.isoformat(),
    }
    if include_body:
        data['body'] = resource.body
        data['metadata'] = resource.metadata
    return data


def _storage_json(user):
    plan, _ = StoragePlan.objects.get_or_create(
        user=user,
        defaults={'tier': 'free', 'quota_bytes': settings.GRAVITAS_DEFAULT_QUOTA_BYTES},
    )
    used = KnowledgeResource.objects.filter(
        workspace__owner=user,
        workspace__kind=Workspace.Kind.PERSONAL,
    ).aggregate(total=Sum('file_size'))['total'] or 0
    quota = max(int(plan.quota_bytes), 1)
    return {
        'tier': plan.tier,
        'used_bytes': used,
        'quota_bytes': quota,
        'remaining_bytes': max(quota - used, 0),
        'percentage': round(min((used / quota) * 100, 100), 2),
    }


@require_http_methods(['GET'])
def workspace_dashboard(request):
    if response := _auth(request):
        return response
    workspace, workspace_ids = _workspace_ids(request.user)
    projects = ResearchProject.objects.filter(workspace_id__in=workspace_ids, archived=False)[:6]
    resources = KnowledgeResource.objects.filter(workspace_id__in=workspace_ids).select_related('project', 'collection').prefetch_related('tags')[:10]
    return JsonResponse({
        'ok': True,
        'workspace': {'id': workspace.pk, 'name': workspace.name, 'kind': workspace.kind},
        'projects': [_project_json(item) for item in projects],
        'recent': [_resource_json(item) for item in resources],
        'storage': _storage_json(request.user),
        'counts': {
            'projects': ResearchProject.objects.filter(workspace_id__in=workspace_ids, archived=False).count(),
            'notes': KnowledgeResource.objects.filter(workspace_id__in=workspace_ids, kind='note').count(),
            'files': KnowledgeResource.objects.filter(workspace_id__in=workspace_ids, kind='file').count(),
            'datasets': KnowledgeResource.objects.filter(workspace_id__in=workspace_ids, kind='dataset').count(),
        },
    })


@require_http_methods(['GET', 'POST'])
def projects(request):
    if response := _auth(request):
        return response
    workspace, workspace_ids = _workspace_ids(request.user)
    if request.method == 'GET':
        items = ResearchProject.objects.filter(workspace_id__in=workspace_ids).select_related('owner')
        return JsonResponse({'ok': True, 'projects': [_project_json(item) for item in items]})
    data = _body(request)
    title = str(data.get('title', '')).strip()[:220]
    if not title:
        return _error('title_required')
    project = ResearchProject.objects.create(
        workspace=workspace,
        owner=request.user,
        title=title,
        description=str(data.get('description', '')).strip(),
    )
    project.memberships.create(user=request.user, role='owner')
    _activity(workspace, request.user, 'project_created', project=project)
    return JsonResponse({'ok': True, 'project': _project_json(project)}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def project_detail(request, project_id):
    if response := _auth(request):
        return response
    project = _project_for(request.user, project_id)
    if not project:
        return _error('not_found', 404)
    if request.method == 'GET':
        resources = project.resources.select_related('project', 'collection').prefetch_related('tags')
        return JsonResponse({'ok': True, 'project': _project_json(project), 'resources': [_resource_json(i) for i in resources]})
    if request.method == 'DELETE':
        if project.owner_id != request.user.pk:
            return _error('permission_denied', 403)
        if project.resources.filter(file_size__gt=0).exists():
            return _error('project_not_empty', 409)
        project.delete()
        return JsonResponse({'ok': True})
    if project.owner_id != request.user.pk:
        return _error('permission_denied', 403)
    data = _body(request)
    if 'title' in data:
        project.title = str(data['title']).strip()[:220]
        if not project.title:
            return _error('title_required')
    if 'description' in data:
        project.description = str(data['description']).strip()
    if 'archived' in data:
        project.archived = bool(data['archived'])
    project.save()
    _activity(project.workspace, request.user, 'project_updated', project=project)
    return JsonResponse({'ok': True, 'project': _project_json(project)})


def _resolve_relations(user, workspace, data):
    project = None
    collection = None
    if data.get('project_id'):
        project = _project_for(user, data['project_id'])
        if not project or project.workspace_id != workspace.pk:
            raise ValueError('invalid_project')
    if data.get('collection_id'):
        collection = Collection.objects.filter(pk=data['collection_id'], workspace=workspace).first()
        if not collection:
            raise ValueError('invalid_collection')
    return project, collection


def _set_tags(resource, values):
    if values is None:
        return
    if isinstance(values, (str, int)):
        values = [values]
    tags = list(Tag.objects.filter(workspace=resource.workspace, pk__in=[int(v) for v in values if str(v).isdigit()]))
    resource.tags.set(tags)


@require_http_methods(['GET', 'POST'])
def resources(request):
    if response := _auth(request):
        return response
    workspace, workspace_ids = _workspace_ids(request.user)
    if request.method == 'GET':
        qs = KnowledgeResource.objects.filter(workspace_id__in=workspace_ids).select_related('project', 'collection').prefetch_related('tags')
        kind = request.GET.get('kind', '').strip()
        query = request.GET.get('q', '').strip()[:200]
        if kind in KnowledgeResource.Kind.values:
            qs = qs.filter(kind=kind)
        if request.GET.get('project'):
            qs = qs.filter(project_id=request.GET['project'])
        if request.GET.get('collection'):
            qs = qs.filter(collection_id=request.GET['collection'])
        if query:
            qs = qs.filter(Q(title__icontains=query) | Q(description__icontains=query) | Q(body__icontains=query) | Q(original_name__icontains=query) | Q(tags__name__icontains=query)).distinct()
        return JsonResponse({'ok': True, 'items': [_resource_json(item) for item in qs[:200]]})

    data = _body(request)
    kind = str(data.get('kind', 'note'))
    if kind not in {KnowledgeResource.Kind.NOTE, KnowledgeResource.Kind.PAPER}:
        return _error('use_upload_endpoint')
    title = str(data.get('title', '')).strip()[:240]
    if not title:
        return _error('title_required')
    try:
        project, collection = _resolve_relations(request.user, workspace, data)
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
    _set_tags(resource, data.get('tag_ids'))
    _activity(workspace, request.user, f'{kind}_created', resource=resource, project=project)
    return JsonResponse({'ok': True, 'item': _resource_json(resource, True)}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def resource_detail(request, resource_id):
    if response := _auth(request):
        return response
    resource = _resource_for(request.user, resource_id)
    if not resource:
        return _error('not_found', 404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'item': _resource_json(resource, True)})
    if resource.owner_id != request.user.pk and resource.workspace.kind == Workspace.Kind.PERSONAL:
        return _error('permission_denied', 403)
    if request.method == 'DELETE':
        if resource.storage_path:
            try:
                identity = cloud.ensure_identity(request.user, _storage_json(request.user)['quota_bytes'])
                cloud.delete(identity, resource.storage_path)
            except cloud.CloudError:
                logger.exception('Cloud delete failed for resource %s', resource.pk)
                return _error('cloud_unavailable', 503)
        resource.delete()
        return JsonResponse({'ok': True})

    data = _body(request)
    try:
        project, collection = _resolve_relations(request.user, resource.workspace, data)
    except ValueError as exc:
        return _error(str(exc))
    old_path = resource.storage_path
    if 'title' in data:
        title = str(data['title']).strip()[:240]
        if not title:
            return _error('title_required')
        resource.title = title
    if 'description' in data:
        resource.description = str(data['description']).strip()
    if 'body' in data and resource.kind == KnowledgeResource.Kind.NOTE:
        resource.body = str(data['body']).strip()
    if 'source_url' in data and resource.kind == KnowledgeResource.Kind.PAPER:
        resource.source_url = str(data['source_url']).strip()[:1000]
    if 'project_id' in data:
        resource.project = project
    if 'collection_id' in data:
        resource.collection = collection
    if data.get('filename') and old_path and cloud.safe_filename(data['filename']) != resource.original_name:
        filename = cloud.safe_filename(data['filename'])
        new_path = str(PurePosixPath(old_path).with_name(filename))
        identity = cloud.ensure_identity(request.user, _storage_json(request.user)['quota_bytes'])
        try:
            cloud.move(identity, old_path, new_path)
        except cloud.CloudError:
            logger.exception('Cloud move failed for resource %s', resource.pk)
            return _error('cloud_unavailable', 503)
        resource.storage_path = new_path
        resource.original_name = filename
    resource.save()
    _set_tags(resource, data.get('tag_ids'))
    _activity(resource.workspace, request.user, 'resource_updated', resource=resource, project=resource.project)
    return JsonResponse({'ok': True, 'item': _resource_json(resource, True)})


@require_http_methods(['POST'])
def file_upload(request):
    if response := _auth(request):
        return response
    uploaded = request.FILES.get('file')
    if not uploaded:
        return _error('file_required')
    kind = request.POST.get('kind', 'file')
    if kind not in {KnowledgeResource.Kind.FILE, KnowledgeResource.Kind.DATASET}:
        return _error('invalid_kind')
    if uploaded.size <= 0 or uploaded.size > settings.GRAVITAS_MAX_UPLOAD_BYTES:
        return _error('file_size_invalid', 413, max_bytes=settings.GRAVITAS_MAX_UPLOAD_BYTES)
    filename = cloud.safe_filename(uploaded.name)
    if kind == KnowledgeResource.Kind.DATASET and PurePosixPath(filename).suffix.lower() not in DATASET_EXTENSIONS:
        return _error('unsupported_dataset_type', 415, allowed=sorted(DATASET_EXTENSIONS))
    workspace = _personal_workspace(request.user)
    data = request.POST
    try:
        project, collection = _resolve_relations(request.user, workspace, data)
    except ValueError as exc:
        return _error(str(exc))

    with transaction.atomic():
        plan = StoragePlan.objects.select_for_update().get(user=request.user)
        used = KnowledgeResource.objects.filter(workspace=workspace).aggregate(total=Sum('file_size'))['total'] or 0
        if used + uploaded.size > plan.quota_bytes:
            return _error('quota_exceeded', 413, storage=_storage_json(request.user))
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
            ingestion_status=KnowledgeResource.IngestionStatus.PENDING,
            metadata={'extension': PurePosixPath(filename).suffix.lower()},
        )
        resource.storage_path = cloud.resource_path(resource.pk, filename)
        resource.save(update_fields=['storage_path', 'updated_at'])
        _set_tags(resource, request.POST.getlist('tag_ids'))

    try:
        identity = cloud.ensure_identity(request.user, plan.quota_bytes)
        uploaded.seek(0)
        digest = hashlib.sha256()
        for chunk in uploaded.chunks():
            digest.update(chunk)
        uploaded.seek(0)
        cloud.upload(identity, resource.storage_path, uploaded)
    except Exception:
        resource.delete()
        logger.exception('Cloud upload failed for user %s', request.user.pk)
        return _error('cloud_unavailable', 503)
    resource.checksum = f'sha256:{digest.hexdigest()}'
    resource.save(update_fields=['checksum', 'updated_at'])
    _activity(workspace, request.user, f'{kind}_uploaded', resource=resource, project=project)
    return JsonResponse({'ok': True, 'item': _resource_json(resource, True), 'storage': _storage_json(request.user)}, status=201)


@require_http_methods(['GET'])
def file_download(request, resource_id):
    if response := _auth(request):
        return response
    resource = _resource_for(request.user, resource_id)
    if not resource or not resource.storage_path:
        return _error('not_found', 404)
    try:
        identity = cloud.ensure_identity(request.user, _storage_json(request.user)['quota_bytes'])
        upstream = cloud.download(identity, resource.storage_path)
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
    if response := _auth(request):
        return response
    _personal_workspace(request.user)
    return JsonResponse({'ok': True, 'storage': _storage_json(request.user), 'max_upload_bytes': settings.GRAVITAS_MAX_UPLOAD_BYTES})


@require_http_methods(['GET', 'POST'])
def collections(request):
    if response := _auth(request):
        return response
    workspace, _ = _workspace_ids(request.user)
    if request.method == 'GET':
        items = Collection.objects.filter(workspace=workspace)
        return JsonResponse({'ok': True, 'collections': [{'id': i.pk, 'name': i.name, 'project_id': i.project_id, 'parent_id': i.parent_id} for i in items]})
    data = _body(request)
    name = str(data.get('name', '')).strip()[:180]
    if not name:
        return _error('name_required')
    try:
        project, _ = _resolve_relations(request.user, workspace, data)
    except ValueError as exc:
        return _error(str(exc))
    parent = Collection.objects.filter(pk=data.get('parent_id'), workspace=workspace).first() if data.get('parent_id') else None
    item, created = Collection.objects.get_or_create(workspace=workspace, project=project, parent=parent, name=name, defaults={'created_by': request.user})
    return JsonResponse({'ok': True, 'collection': {'id': item.pk, 'name': item.name, 'project_id': item.project_id, 'parent_id': item.parent_id}}, status=201 if created else 200)


@require_http_methods(['GET', 'POST'])
def tags(request):
    if response := _auth(request):
        return response
    workspace, _ = _workspace_ids(request.user)
    if request.method == 'GET':
        items = Tag.objects.filter(workspace=workspace)
        return JsonResponse({'ok': True, 'tags': [{'id': i.pk, 'name': i.name, 'slug': i.slug, 'color': i.color} for i in items]})
    data = _body(request)
    name = str(data.get('name', '')).strip()[:80]
    if not name:
        return _error('name_required')
    base = slugify(name)[:80] or f'tag-{Tag.objects.filter(workspace=workspace).count() + 1}'
    slug = base
    index = 2
    while Tag.objects.filter(workspace=workspace, slug=slug).exists():
        slug = f'{base[:75]}-{index}'
        index += 1
    item = Tag.objects.create(workspace=workspace, name=name, slug=slug, color=str(data.get('color', '#7566f6'))[:16])
    return JsonResponse({'ok': True, 'tag': {'id': item.pk, 'name': item.name, 'slug': item.slug, 'color': item.color}}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def collection_detail(request, collection_id):
    if response := _auth(request):
        return response
    workspace, _ = _workspace_ids(request.user)
    item = Collection.objects.filter(pk=collection_id, workspace=workspace).first()
    if not item:
        return _error('not_found', 404)
    if request.method == 'DELETE':
        item.delete()
        return JsonResponse({'ok': True})
    data = _body(request)
    name = str(data.get('name', item.name)).strip()[:180]
    if not name:
        return _error('name_required')
    parent = None
    if data.get('parent_id'):
        parent = Collection.objects.filter(pk=data['parent_id'], workspace=workspace).exclude(pk=item.pk).first()
        if not parent:
            return _error('invalid_parent')
    item.name = name
    if 'parent_id' in data:
        item.parent = parent
    item.save()
    return JsonResponse({'ok': True, 'collection': {'id': item.pk, 'name': item.name, 'project_id': item.project_id, 'parent_id': item.parent_id}})


@require_http_methods(['PATCH', 'DELETE'])
def tag_detail(request, tag_id):
    if response := _auth(request):
        return response
    workspace, _ = _workspace_ids(request.user)
    item = Tag.objects.filter(pk=tag_id, workspace=workspace).first()
    if not item:
        return _error('not_found', 404)
    if request.method == 'DELETE':
        item.delete()
        return JsonResponse({'ok': True})
    data = _body(request)
    name = str(data.get('name', item.name)).strip()[:80]
    if not name:
        return _error('name_required')
    item.name = name
    if 'color' in data:
        item.color = str(data['color'])[:16]
    item.save()
    return JsonResponse({'ok': True, 'tag': {'id': item.pk, 'name': item.name, 'slug': item.slug, 'color': item.color}})
