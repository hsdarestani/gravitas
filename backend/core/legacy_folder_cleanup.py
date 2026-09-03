import json
import logging
from xml.etree import ElementTree

from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import cloud, nextcloud_bridge
from .models import ResearchProject
from .platform_access import can_manage, can_view, content_type_for
from .platform_models import AccessGrant, ObjectPolicy, ProjectAuditEvent, ShareLink
from .space_fs import SpaceConflict
from .space_models import ProjectSpaceLink
from .space_moves import sync_project_moveaware

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


def _admin_folder_state(path):
    """Inspect a Team Folder path using the service account.

    Project Team Folders are group-mounted paths. On some Nextcloud builds an
    ordinary project member can browse the mount but a DELETE/PROPFIND used by
    the API is denied by Advanced Permissions. The service account is explicitly
    added to every project group, so it is the reliable control-plane identity.
    """
    response = cloud._request(
        'PROPFIND',
        cloud._admin_dav_url(path),
        auth=cloud._admin_auth(),
        expected={207, 404},
        headers={'Depth': '1'},
    )
    if response.status_code == 404:
        return {'exists': False, 'empty': True, 'via': 'admin'}
    try:
        root = ElementTree.fromstring(response.content)
    except ElementTree.ParseError as exc:
        raise cloud.CloudError('Invalid cloud folder response') from exc
    responses = root.findall('{DAV:}response')
    return {'exists': True, 'empty': len(responses) <= 1, 'via': 'admin'}


def _owner_folder_state(identity, path):
    if not cloud.path_exists(identity, path):
        return {'exists': False, 'empty': True, 'via': 'owner'}
    return {'exists': True, 'empty': cloud.folder_is_empty(identity, path), 'via': 'owner'}


def _remote_folder_state(identity, path):
    """Use admin DAV first and fall back to the project owner mount.

    A 404 from the admin mount is cross-checked with the owner before treating
    the folder as absent. This avoids deleting database metadata merely because
    a Group Folder mount is temporarily not visible to one identity.
    """
    try:
        admin_state = _admin_folder_state(path)
    except cloud.CloudError:
        logger.warning('Admin DAV could not inspect %s; falling back to owner DAV', path)
        return _owner_folder_state(identity, path)
    if admin_state['exists']:
        return admin_state
    try:
        owner_state = _owner_folder_state(identity, path)
    except cloud.CloudError:
        # Admin positively reported 404 but the owner check failed. Do not make
        # a destructive decision from an ambiguous state.
        raise cloud.CloudError('Could not verify Team Folder path with project owner')
    return owner_state


def _delete_remote_folder(identity, path, state):
    if not state.get('exists'):
        return 'missing'
    if state.get('via') == 'admin':
        try:
            cloud._request(
                'DELETE',
                cloud._admin_dav_url(path),
                auth=cloud._admin_auth(),
                expected={200, 204, 404},
            )
            return 'admin'
        except cloud.CloudError:
            logger.warning('Admin DAV could not delete %s; falling back to owner DAV', path)
    cloud.delete(identity, path)
    return 'owner'


def _reconcile_nextcloud(project):
    """Converge both native project storage and the user's canonical Space.

    The Team Folder remains the shared binary-storage backend, while the Space
    hierarchy is the user-facing filesystem model (Space/Subspace/Category/
    Project with Markdown sidecars). After cleanup both views are reconciled so
    stale fixed folders are not recreated and the selected Space placement is
    immediately present in Nextcloud.
    """
    result = {'team_folder': False, 'space_paths': [], 'space_pending': []}
    try:
        nextcloud_bridge.ensure_project_space(project)
        result['team_folder'] = True
    except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
        logger.exception('Could not reconcile Team Folder after legacy cleanup for project %s', project.pk)

    users = {project.owner_id: project.owner}
    for link in ProjectSpaceLink.objects.filter(project=project).select_related('user'):
        users[link.user_id] = link.user
    for user in users.values():
        try:
            link = sync_project_moveaware(project, user)
            result['space_paths'].append({
                'user_id': user.pk,
                'path': link.folder_path,
                'native_url': cloud.native_files_url(link.folder_path),
            })
        except SpaceConflict as exc:
            result['space_pending'].append({'user_id': user.pk, 'reason': 'conflict', 'path': exc.path})
        except (cloud.CloudError, ValueError):
            logger.exception('Could not reconcile Space for project %s user %s', project.pk, user.pk)
            result['space_pending'].append({'user_id': user.pk, 'reason': 'cloud_unavailable'})
    return result


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
            'nextcloud': _reconcile_nextcloud(project),
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
            # Provision/reconcile first so both the project owner and the service
            # account are members of the Team Folder group before inspection.
            nextcloud_bridge.ensure_project_space(project)
            identity = nextcloud_bridge.ensure_user(project.owner)
        except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
            logger.exception('Could not prepare project %s for legacy folder cleanup', project.pk)
            return _error('cloud_check_failed', 503, stage='prepare')

    verified_empty = []
    for folder in remote_candidates:
        path = nextcloud_bridge.project_storage_path(project, folder)
        try:
            state = _remote_folder_state(identity, path)
        except cloud.CloudError:
            logger.exception('Could not inspect legacy folder %s in project %s', folder.pk, project.pk)
            return _error('cloud_check_failed', 503, stage='inspect', folder=folder.name)
        if not state['empty']:
            blocked.append({
                'id': folder.pk,
                'name': folder.name,
                'reason': 'contains_nextcloud_content',
            })
            continue
        verified_empty.append((folder, path, state))

    cleaned = []
    for folder, path, state in verified_empty:
        try:
            deleted_via = _delete_remote_folder(identity, path, state)
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
            cleaned.append({'id': folder_id, 'name': name, 'deleted_via': deleted_via})

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

    # Re-run the current filesystem model after deleting old Collection rows.
    # This is what makes Nextcloud converge to the manager-defined structure
    # instead of the old six-folder template.
    nextcloud_state = _reconcile_nextcloud(project)
    after = _snapshot(project, request.user)
    return JsonResponse({
        'ok': True,
        'cleaned': cleaned,
        'blocked': blocked,
        'legacy': after,
        'nextcloud': nextcloud_state,
    })
