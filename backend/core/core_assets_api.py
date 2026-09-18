import json
import os
import re
import uuid
from pathlib import Path

from django.conf import settings
from django.db.models import Q
from django.http import FileResponse, JsonResponse
from django.views.decorators.http import require_http_methods

from .layer_access import module_access
from .layer_models import ModuleGrant
from .models import WorkspaceMembership
from .platform_models import CoreAsset, CoreAssetAccess
from .platform_runtime_v3 import core_role, ensure_platform_workspaces



def _safe_filename(value):
    name = Path(str(value or '')).name.strip() or 'file'
    name = re.sub(r'[^A-Za-z0-9._ -]+', '_', name)
    return name[:255] or 'file'

def _deny(request):
    return JsonResponse(
        {'ok': False, 'error': 'authentication_required' if not request.user.is_authenticated else 'core_access_required'},
        status=401 if not request.user.is_authenticated else 403,
    )


def _core(request):
    if not request.user.is_authenticated or not module_access(request.user, ModuleGrant.Module.CORE):
        return None
    return ensure_platform_workspaces(request.user)['core']


def _is_admin(request, core):
    return request.user.is_superuser or core_role(request.user, core) in {'owner', 'admin'}


def _can_view(user, asset):
    return (
        asset.visible_to_all_core
        or asset.uploader_id == user.pk
        or asset.access_grants.filter(user=user).exists()
    )


def _can_edit(user, asset, admin=False):
    if admin or asset.uploader_id == user.pk:
        return True
    grant = asset.access_grants.filter(user=user).first()
    return bool(grant and grant.can_edit)


def _team(core):
    return [{
        'id': row.user_id,
        'name': row.user.get_full_name() or row.user.email,
        'email': row.user.email,
        'role': row.role,
    } for row in WorkspaceMembership.objects.filter(workspace=core).select_related('user').order_by('user__email')]


def _asset_json(asset, user, admin=False):
    return {
        'id': asset.pk,
        'title': asset.title,
        'kind': asset.kind,
        'description': asset.description,
        'source_url': asset.source_url,
        'original_name': asset.original_name,
        'mime_type': asset.mime_type,
        'file_size': asset.file_size,
        'visible_to_all_core': asset.visible_to_all_core,
        'uploader': asset.uploader.get_full_name() or asset.uploader.email,
        'uploader_id': asset.uploader_id,
        'created_at': asset.created_at.isoformat(),
        'updated_at': asset.updated_at.isoformat(),
        'can_edit': _can_edit(user, asset, admin),
        'download_url': f'/api/platform/core-assets/{asset.pk}/download/' if asset.kind == CoreAsset.Kind.FILE else '',
        'access': [{
            'user_id': grant.user_id,
            'name': grant.user.get_full_name() or grant.user.email,
            'email': grant.user.email,
            'can_edit': grant.can_edit,
        } for grant in asset.access_grants.select_related('user').all()],
    }


def _allowed_ids(core, raw):
    try:
        values = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError:
        values = []
    if not isinstance(values, list):
        return []
    valid = set(WorkspaceMembership.objects.filter(workspace=core).values_list('user_id', flat=True))
    out = []
    for value in values:
        try:
            user_id = int(value)
        except (TypeError, ValueError):
            continue
        if user_id in valid and user_id not in out:
            out.append(user_id)
    return out


@require_http_methods(['GET', 'POST'])
def core_assets(request):
    core = _core(request)
    if core is None:
        return _deny(request)
    admin = _is_admin(request, core)
    if request.method == 'GET':
        qs = CoreAsset.objects.select_related('uploader').prefetch_related('access_grants__user')
        visible = [item for item in qs[:1000] if _can_view(request.user, item)]
        return JsonResponse({
            'ok': True,
            'assets': [_asset_json(item, request.user, admin) for item in visible[:300]],
            'team': _team(core),
            'max_file_bytes': settings.CORE_ASSET_MAX_BYTES,
        })

    title = str(request.POST.get('title') or '').strip()[:240]
    description = str(request.POST.get('description') or '').strip()
    source_url = str(request.POST.get('source_url') or '').strip()[:1600]
    uploaded = request.FILES.get('file')
    if not title:
        return JsonResponse({'ok': False, 'error': 'title_required'}, status=400)
    if not uploaded and not source_url:
        return JsonResponse({'ok': False, 'error': 'file_or_url_required'}, status=400)
    if uploaded and (uploaded.size <= 0 or uploaded.size > settings.CORE_ASSET_MAX_BYTES):
        return JsonResponse({'ok': False, 'error': 'file_size_invalid', 'max_bytes': settings.CORE_ASSET_MAX_BYTES}, status=413)

    asset = CoreAsset(
        title=title, description=description, uploader=request.user,
        visible_to_all_core=str(request.POST.get('visible_to_all_core', '1')).lower() not in {'0', 'false', 'no'},
    )
    if uploaded:
        asset.kind = CoreAsset.Kind.FILE
        name = _safe_filename(uploaded.name)
        root = Path(settings.CORE_UPLOAD_ROOT) / 'assets'
        root.mkdir(parents=True, exist_ok=True)
        path = root / f'{uuid.uuid4().hex}-{name}'
        with path.open('wb') as handle:
            for chunk in uploaded.chunks():
                handle.write(chunk)
        asset.original_name = name
        asset.storage_path = str(path)
        asset.mime_type = (uploaded.content_type or '')[:160]
        asset.file_size = uploaded.size
    else:
        asset.kind = CoreAsset.Kind.URL
        asset.source_url = source_url
    asset.save()

    if not asset.visible_to_all_core:
        for user_id in _allowed_ids(core, request.POST.get('allowed_user_ids', '[]')):
            if user_id != request.user.pk:
                CoreAssetAccess.objects.get_or_create(asset=asset, user_id=user_id)
    return JsonResponse({'ok': True, 'asset': _asset_json(asset, request.user, admin)}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def core_asset_detail(request, asset_id):
    core = _core(request)
    if core is None:
        return _deny(request)
    admin = _is_admin(request, core)
    asset = CoreAsset.objects.select_related('uploader').prefetch_related('access_grants__user').filter(pk=asset_id).first()
    if not asset or not _can_view(request.user, asset):
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'asset': _asset_json(asset, request.user, admin), 'team': _team(core)})
    if not _can_edit(request.user, asset, admin):
        return JsonResponse({'ok': False, 'error': 'permission_denied'}, status=403)
    if request.method == 'DELETE':
        path = asset.storage_path
        asset.delete()
        if path:
            try:
                os.remove(path)
            except FileNotFoundError:
                pass
        return JsonResponse({'ok': True})

    try:
        data = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        data = {}
    if 'title' in data:
        asset.title = str(data['title'] or '').strip()[:240]
        if not asset.title:
            return JsonResponse({'ok': False, 'error': 'title_required'}, status=400)
    if 'description' in data:
        asset.description = str(data['description'] or '')
    if 'source_url' in data and asset.kind == CoreAsset.Kind.URL:
        asset.source_url = str(data['source_url'] or '').strip()[:1600]
    if 'visible_to_all_core' in data:
        asset.visible_to_all_core = bool(data['visible_to_all_core'])
    asset.save()
    if 'allowed_user_ids' in data or asset.visible_to_all_core:
        asset.access_grants.all().delete()
        if not asset.visible_to_all_core:
            for user_id in _allowed_ids(core, data.get('allowed_user_ids', [])):
                if user_id != asset.uploader_id:
                    CoreAssetAccess.objects.create(
                        asset=asset, user_id=user_id,
                        can_edit=bool(user_id in set(data.get('editable_user_ids') or [])),
                    )
    return JsonResponse({'ok': True, 'asset': _asset_json(asset, request.user, admin)})


@require_http_methods(['GET'])
def core_asset_download(request, asset_id):
    core = _core(request)
    if core is None:
        return _deny(request)
    asset = CoreAsset.objects.select_related('uploader').filter(pk=asset_id, kind=CoreAsset.Kind.FILE).first()
    if not asset or not _can_view(request.user, asset) or not asset.storage_path or not os.path.isfile(asset.storage_path):
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    return FileResponse(open(asset.storage_path, 'rb'), as_attachment=True, filename=asset.original_name or asset.title)
