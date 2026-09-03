import json
import logging

from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import cloud, nextcloud_bridge
from .models import ResearchProject
from .platform_access import can_manage, can_view, content_type_for
from .platform_models import AccessGrant, ObjectPolicy, ProjectAuditEvent, ShareLink

logger = logging.getLogger(__name__)


LEGACY_PROJECT_FOLDERS = (
    '01 Client Input',
    '02 Working',
    '03 Datasets',
    '04 Analysis',
    '05 Deliverables',
    '06 Archive',
)
LEGACY_CLEANUP_ACTION = 'legacy_folder_cleanup'


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _project(request, project_id):
    project = ResearchProject.objects.select_related('owner', 'workspace').filter(
        pk=project_id,
        archived=False,
    ).first()
    return project if project and can_view(request.user, project) else None


def _legacy_folders(project):
    return list(
        project.collections.filter(
            parent__isnull=True,
            name__in=LEGACY_PROJECT_FOLDERS,
        ).order_by('name', 'id')
    )


def _folder_snapshot(project, folder):
    storage_path = nextcloud_bridge.project_storage_path(project, folder)
    child_count = folder.children.count()
    resource_count = folder.resources.count()
    loose_resource_count = project.resources.filter(
        Q(storage_path=storage_path) | Q(storage_path__startswith=storage_path + '/')
    ).exclude(collection=folder).count()
    return {
        'id': folder.pk,
        'name': folder.name,
        'storage_path': storage_path,
        'child_count': child_count,
        'resource_count': resource_count,
        'loose_resource_count': loose_resource_count,
        'database_empty': child_count == 0 and resource_count == 0 and loose_resource_count == 0,
    }


def _snapshot(project, user):
    folders = _legacy_folders(project)
    names = {folder.name for folder in folders}
    full_signature = all(name in names for name in LEGACY_PROJECT_FOLDERS)
    previously_confirmed = ProjectAuditEvent.objects.filter(
        project=project,
        action=LEGACY_CLEANUP_ACTION,
    ).exists()
    items = [_folder_snapshot(project, folder) for folder in folders]
    active = bool(items) and (full_signature or previously_confirmed)
    return {
        'active': active,
        'full_signature': full_signature,
        'previously_confirmed': previously_confirmed,
        'can_cleanup': can_manage(user, project),
        'count': len(items),
        'database_empty_count': sum(1 for item in items if item['database_empty']),
        'database_blocked_count': sum(1 for item in items if not item['database_empty']),
        'items': items,
    }


def _delete_folder_records(folder):
    content_type = content_type_for(folder)
    AccessGrant.objects.filter(content_type=content_type, object_id=folder.pk).delete()
    ShareLink.objects.filter(content_type=content_type, object_id=folder.pk).delete()
    ObjectPolicy.objects.filter(content_type=content_type, object_id=folder.pk).delete()
    folder.delete()


@require_http_methods(['GET', 'POST'])
def project_legacy_folders(request, project_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project = _project(request, project_id)
    if not project:
        return _error('not_found', 404)

    if request.method == 'GET':
        return JsonResponse({'ok': True, 'legacy': _snapshot(project, request.user)})

    if not can_manage(request.user, project):
        return _error('permission_denied', 403)
    data = _body(request)
    if data.get('confirmed') is not True:
        return _error('confirmation_required', 400)

    before = _snapshot(project, request.user)
    if not before['active']:
        return JsonResponse({
            'ok': True,
            'cleaned': [],
            'blocked': [],
            'legacy': before,
        })

    folders_by_id = {folder.pk: folder for folder in _legacy_folders(project)}
    blocked = []
    remote_candidates = []
    for item in before['items']:
        folder = folders_by_id.get(item['id'])
        if not folder:
            continue
        if not item['database_empty']:
            blocked.append({
                'id': folder.pk,
                'name': folder.name,
                'reason': 'contains_database_content',
            })
            continue
        remote_candidates.append(folder)

    identity = None
    if remote_candidates:
        try:
            # Reconcile membership first so the project owner can reliably see
            # the native Team Folder. This also recreates a missing empty folder,
            # which is safe because the cleanup immediately verifies emptiness.
            nextcloud_bridge.ensure_project_space(project)
            identity = nextcloud_bridge.ensure_user(project.owner)
        except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
            logger.exception('Could not prepare project %s for legacy folder cleanup', project.pk)
            return _error('cloud_check_failed', 503)

    verified_empty = []
    for folder in remote_candidates:
        path = nextcloud_bridge.project_storage_path(project, folder)
        try:
            empty = cloud.folder_is_empty(identity, path)
        except cloud.CloudError:
            logger.exception('Could not inspect legacy folder %s in project %s', folder.pk, project.pk)
            return _error('cloud_check_failed', 503)
        if not empty:
            blocked.append({
                'id': folder.pk,
                'name': folder.name,
                'reason': 'contains_nextcloud_content',
            })
            continue
        verified_empty.append((folder, path))

    cleaned = []
    for folder, path in verified_empty:
        try:
            cloud.delete(identity, path)
        except cloud.CloudError:
            logger.exception('Could not delete empty legacy folder %s in project %s', folder.pk, project.pk)
            blocked.append({
                'id': folder.pk,
                'name': folder.name,
                'reason': 'cloud_delete_failed',
            })
            continue
        with transaction.atomic():
            name = folder.name
            folder_id = folder.pk
            _delete_folder_records(folder)
            cleaned.append({'id': folder_id, 'name': name})

    ProjectAuditEvent.objects.create(
        project=project,
        actor=request.user,
        action=LEGACY_CLEANUP_ACTION,
        object_type='ResearchProject',
        object_id=str(project.pk),
        detail={
            'cleaned': [item['name'] for item in cleaned],
            'blocked': blocked,
        },
    )

    after = _snapshot(project, request.user)
    return JsonResponse({
        'ok': True,
        'cleaned': cleaned,
        'blocked': blocked,
        'legacy': after,
    })
