import json
import logging
import os
import re
import uuid
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.http import FileResponse, JsonResponse, StreamingHttpResponse
from django.utils.http import content_disposition_header
from django.views.decorators.http import require_http_methods

from . import cloud, nextcloud_bridge
from .layer_access import module_access
from .layer_models import ModuleGrant
from .models import WorkspaceMembership
from .platform_models import CoreAsset, CoreAssetAccess
from .platform_runtime_v3 import core_role, ensure_platform_workspaces


logger = logging.getLogger(__name__)
NEXTCLOUD_STORAGE_PREFIX = 'nextcloud:'


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


def _cloud_path(asset):
    value = str(asset.storage_path or '')
    return value[len(NEXTCLOUD_STORAGE_PREFIX):] if value.startswith(NEXTCLOUD_STORAGE_PREFIX) else ''


def _asset_json(asset, user, admin=False):
    cloud_path = _cloud_path(asset)
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
        'storage_backend': 'nextcloud' if cloud_path else ('local' if asset.storage_path else ''),
        'native_url': cloud.native_files_url(settings.CORE_ASSET_NEXTCLOUD_MOUNTPOINT) if cloud_path else '',
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


def _nextcloud_metadata(state='live'):
    return {
        'state': state,
        'mountpoint': settings.CORE_ASSET_NEXTCLOUD_MOUNTPOINT,
        'files_url': cloud.native_files_url(settings.CORE_ASSET_NEXTCLOUD_MOUNTPOINT),
    }


def _ensure_assets_team_folder(core):
    team = cloud.ensure_team_folder(
        settings.CORE_ASSET_NEXTCLOUD_MOUNTPOINT,
        settings.CORE_ASSET_NEXTCLOUD_GROUP,
    )
    for membership in WorkspaceMembership.objects.filter(workspace=core).select_related('user'):
        user = membership.user
        if not user.is_active:
            continue
        identity = nextcloud_bridge.ensure_user(user)
        cloud.add_user_to_group(identity.username, settings.CORE_ASSET_NEXTCLOUD_GROUP)
    return team


def _new_cloud_path(filename):
    return (
        f'{settings.CORE_ASSET_NEXTCLOUD_MOUNTPOINT}/'
        f'{uuid.uuid4().hex}-{_safe_filename(filename)}'
    )


def _migrate_legacy_local_assets():
    migrated = 0
    failed = 0
    qs = CoreAsset.objects.filter(kind=CoreAsset.Kind.FILE).exclude(storage_path='')
    for asset in qs.iterator():
        if _cloud_path(asset):
            continue
        local_path = str(asset.storage_path or '')
        if not local_path or not os.path.isfile(local_path):
            continue
        remote_path = _new_cloud_path(asset.original_name or asset.title or 'asset')
        try:
            with open(local_path, 'rb') as source:
                cloud.admin_upload(
                    remote_path,
                    source,
                    content_type=asset.mime_type or 'application/octet-stream',
                )
            asset.storage_path = NEXTCLOUD_STORAGE_PREFIX + remote_path
            asset.save(update_fields=['storage_path', 'updated_at'])
            try:
                os.remove(local_path)
            except OSError:
                logger.warning('Migrated Core asset %s but could not remove legacy local copy', asset.pk)
            migrated += 1
        except (cloud.CloudError, ImproperlyConfigured):
            logger.exception('Could not migrate Core asset %s to Nextcloud', asset.pk)
            failed += 1
    return migrated, failed


def _prepare_nextcloud(core, migrate=False):
    try:
        _ensure_assets_team_folder(core)
        if migrate:
            _migrated, failed = _migrate_legacy_local_assets()
            return 'partial' if failed else 'live'
        return 'live'
    except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError, ImproperlyConfigured):
        logger.exception('Core Assets Nextcloud Team Folder is unavailable')
        return 'unavailable'


@require_http_methods(['GET', 'POST'])
def core_assets(request):
    core = _core(request)
    if core is None:
        return _deny(request)
    admin = _is_admin(request, core)

    if request.method == 'GET':
        sync_state = _prepare_nextcloud(core, migrate=True)
        qs = CoreAsset.objects.select_related('uploader').prefetch_related('access_grants__user')
        visible = [item for item in qs[:1000] if _can_view(request.user, item)]
        return JsonResponse({
            'ok': True,
            'assets': [_asset_json(item, request.user, admin) for item in visible[:300]],
            'team': _team(core),
            'max_file_bytes': settings.CORE_ASSET_MAX_BYTES,
            'nextcloud': _nextcloud_metadata(sync_state),
        })

    title = str(request.POST.get('title') or '').strip()[:240]
    description = str(request.POST.get('description') or '').strip()
    source_url = str(request.POST.get('source_url') or '').strip()[:1600]
    uploaded = request.FILES.get('file')
    if uploaded and not title:
        title = _safe_filename(uploaded.name)
    if not title:
        return JsonResponse({'ok': False, 'error': 'title_required'}, status=400)
    if not uploaded and not source_url:
        return JsonResponse({'ok': False, 'error': 'file_or_url_required'}, status=400)
    if uploaded and (uploaded.size <= 0 or uploaded.size > settings.CORE_ASSET_MAX_BYTES):
        return JsonResponse(
            {'ok': False, 'error': 'file_size_invalid', 'max_bytes': settings.CORE_ASSET_MAX_BYTES},
            status=413,
        )

    asset = CoreAsset(
        title=title,
        description=description,
        uploader=request.user,
        visible_to_all_core=True if uploaded else (
            str(request.POST.get('visible_to_all_core', '1')).lower() not in {'0', 'false', 'no'}
        ),
    )

    if uploaded:
        if _prepare_nextcloud(core) != 'live':
            return JsonResponse({'ok': False, 'error': 'nextcloud_unavailable'}, status=503)
        asset.kind = CoreAsset.Kind.FILE
        name = _safe_filename(uploaded.name)
        remote_path = _new_cloud_path(name)
        try:
            cloud.admin_upload(remote_path, uploaded, content_type=(uploaded.content_type or '')[:160])
        except (cloud.CloudError, ImproperlyConfigured):
            logger.exception('Core asset upload to Nextcloud failed')
            return JsonResponse({'ok': False, 'error': 'nextcloud_unavailable'}, status=503)
        asset.original_name = name
        asset.storage_path = NEXTCLOUD_STORAGE_PREFIX + remote_path
        asset.mime_type = (uploaded.content_type or '')[:160]
        asset.file_size = uploaded.size
        try:
            asset.save()
        except Exception:
            try:
                cloud.admin_delete(remote_path)
            except Exception:
                logger.exception('Could not rollback orphaned Nextcloud Core asset')
            raise
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
        return JsonResponse({
            'ok': True,
            'asset': _asset_json(asset, request.user, admin),
            'team': _team(core),
            'nextcloud': _nextcloud_metadata(_prepare_nextcloud(core)),
        })
    if not _can_edit(request.user, asset, admin):
        return JsonResponse({'ok': False, 'error': 'permission_denied'}, status=403)

    if request.method == 'DELETE':
        cloud_path = _cloud_path(asset)
        if cloud_path:
            try:
                cloud.admin_delete(cloud_path)
            except (cloud.CloudError, ImproperlyConfigured):
                logger.exception('Could not delete Core asset %s from Nextcloud', asset.pk)
                return JsonResponse({'ok': False, 'error': 'nextcloud_unavailable'}, status=503)
        else:
            path = asset.storage_path
            if path:
                try:
                    os.remove(path)
                except FileNotFoundError:
                    pass
        asset.delete()
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
    if 'visible_to_all_core' in data and asset.kind == CoreAsset.Kind.URL:
        asset.visible_to_all_core = bool(data['visible_to_all_core'])
    asset.save()

    if asset.kind == CoreAsset.Kind.URL and ('allowed_user_ids' in data or asset.visible_to_all_core):
        asset.access_grants.all().delete()
        if not asset.visible_to_all_core:
            editable = set(data.get('editable_user_ids') or [])
            for user_id in _allowed_ids(core, data.get('allowed_user_ids', [])):
                if user_id != asset.uploader_id:
                    CoreAssetAccess.objects.create(
                        asset=asset,
                        user_id=user_id,
                        can_edit=bool(user_id in editable),
                    )
    return JsonResponse({'ok': True, 'asset': _asset_json(asset, request.user, admin)})


@require_http_methods(['GET'])
def core_asset_download(request, asset_id):
    core = _core(request)
    if core is None:
        return _deny(request)
    asset = CoreAsset.objects.select_related('uploader').filter(pk=asset_id, kind=CoreAsset.Kind.FILE).first()
    if not asset or not _can_view(request.user, asset) or not asset.storage_path:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)

    cloud_path = _cloud_path(asset)
    if cloud_path:
        try:
            upstream = cloud.admin_download(cloud_path)
        except (cloud.CloudError, ImproperlyConfigured):
            logger.exception('Could not download Core asset %s from Nextcloud', asset.pk)
            return JsonResponse({'ok': False, 'error': 'nextcloud_unavailable'}, status=503)

        def stream():
            try:
                for chunk in upstream.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        yield chunk
            finally:
                upstream.close()

        response = StreamingHttpResponse(
            stream(),
            content_type=asset.mime_type or upstream.headers.get('Content-Type') or 'application/octet-stream',
        )
        response['Content-Disposition'] = content_disposition_header(
            True,
            asset.original_name or asset.title,
        )
        if asset.file_size:
            response['Content-Length'] = str(asset.file_size)
        return response

    if not os.path.isfile(asset.storage_path):
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    return FileResponse(
        open(asset.storage_path, 'rb'),
        as_attachment=True,
        filename=asset.original_name or asset.title,
    )
