import json

from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .layer_access import object_layer_access, object_product_layer
from .layer_models import ModuleGrant
from .models import KnowledgeResource
from .operating_models import OperatingTask
from .platform_access import can_edit, can_view, content_type_for, resolve_target
from .platform_api import shared_link as base_shared_link, shared_with_me as base_shared_with_me
from .platform_models import EntityLink, ShareLink
from .platform_objects_api import shared_task_detail as base_shared_task_detail
from .platform_resources_api import (
    platform_file_download as base_platform_file_download,
    platform_resource_detail as base_platform_resource_detail,
    shared_file_download as base_shared_file_download,
)
from .structural_access_api import entity_links_safe as base_entity_links_safe


def _error(code, status=400):
    return JsonResponse({'ok': False, 'error': code}, status=status)


def _auth(request):
    return _error('authentication_required', 401) if not request.user.is_authenticated else None


def _body(request):
    try:
        data = json.loads(request.body.decode('utf-8') or '{}')
    except (TypeError, ValueError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _layer_error(user, obj):
    if object_layer_access(user, obj):
        return None
    layer = object_product_layer(obj)
    if layer == ModuleGrant.Module.CORE:
        return _error('core_workspace_for_internal_team_only', 403)
    if layer == ModuleGrant.Module.RESEARCH:
        return _error('research_access_required', 403)
    return _error('permission_denied', 403)


def _public_core_link(token):
    now = timezone.now()
    link = ShareLink.objects.select_related('content_type').filter(
        token=token,
        active=True,
    ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now)).first()
    obj = link.content_object if link else None
    return bool(obj and object_product_layer(obj) == ModuleGrant.Module.CORE)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def platform_resource_detail_layer_safe(request, resource_id):
    if response := _auth(request):
        return response
    resource = KnowledgeResource.objects.select_related('workspace', 'project').filter(pk=resource_id).first()
    if not resource or not can_view(request.user, resource):
        return _error('not_found', 404)
    if error := _layer_error(request.user, resource):
        return error
    return base_platform_resource_detail(request, resource_id)


@require_http_methods(['GET'])
def platform_file_download_layer_safe(request, resource_id):
    if response := _auth(request):
        return response
    resource = KnowledgeResource.objects.select_related('workspace', 'project').filter(pk=resource_id).first()
    if not resource or not resource.storage_path or not can_view(request.user, resource):
        return _error('not_found', 404)
    if error := _layer_error(request.user, resource):
        return error
    return base_platform_file_download(request, resource_id)


@require_http_methods(['GET', 'PATCH'])
def shared_task_detail_layer_safe(request, task_id):
    if response := _auth(request):
        return response
    task = OperatingTask.objects.select_related('workspace', 'project').filter(pk=task_id).first()
    if not task or not can_view(request.user, task):
        return _error('not_found', 404)
    if error := _layer_error(request.user, task):
        return error
    return base_shared_task_detail(request, task_id)


@require_http_methods(['GET'])
def shared_with_me_layer_safe(request):
    """Do not surface stale grants for a product layer the user cannot enter."""
    if response := _auth(request):
        return response
    response = base_shared_with_me(request)
    if response.status_code != 200:
        return response
    payload = json.loads(response.content.decode('utf-8'))
    visible = []
    for item in payload.get('items', []):
        obj = resolve_target(item.get('type'), item.get('id'))
        if obj is not None and object_layer_access(request.user, obj) and can_view(request.user, obj):
            visible.append(item)
    payload['items'] = visible
    return JsonResponse(payload)


@require_http_methods(['GET', 'POST', 'DELETE'])
def entity_links_layer_safe(request):
    """Apply product-layer gates to both ends of every cross-object link."""
    if response := _auth(request):
        return response

    if request.method == 'GET':
        obj = resolve_target(request.GET.get('type'), request.GET.get('id'))
        if not obj or not can_view(request.user, obj):
            return _error('not_found', 404)
        if error := _layer_error(request.user, obj):
            return error

        ct = content_type_for(obj)
        links = EntityLink.objects.filter(
            Q(source_content_type=ct, source_object_id=obj.pk)
            | Q(target_content_type=ct, target_object_id=obj.pk)
        ).select_related('source_content_type', 'target_content_type')
        result = []
        for link in links:
            other = (
                link.target_object
                if link.source_content_type_id == ct.pk and link.source_object_id == obj.pk
                else link.source_object
            )
            if not other or not can_view(request.user, other) or not object_layer_access(request.user, other):
                continue
            result.append({
                'id': link.pk,
                'relation': link.relation,
                'other_type': other.__class__.__name__,
                'other_id': other.pk,
                'other_title': getattr(other, 'title', None) or getattr(other, 'name', str(other)),
            })
        return JsonResponse({'ok': True, 'items': result})

    data = _body(request)
    source = resolve_target(data.get('source_type'), data.get('source_id'))
    target = resolve_target(data.get('target_type'), data.get('target_id'))
    if not source or not target or not can_edit(request.user, source) or not can_view(request.user, target):
        return _error('permission_denied', 403)
    if error := _layer_error(request.user, source):
        return error
    if error := _layer_error(request.user, target):
        return error
    return base_entity_links_safe(request)


@require_http_methods(['GET'])
def shared_link_core_safe(request, token):
    """Legacy Core share links must not keep Layer 5 publicly reachable."""
    if _public_core_link(token):
        return _error('not_found', 404)
    return base_shared_link(request, token)


@require_http_methods(['GET'])
def shared_file_download_core_safe(request, token):
    if _public_core_link(token):
        return _error('not_found', 404)
    return base_shared_file_download(request, token)
