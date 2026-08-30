import logging
from pathlib import PurePosixPath
from urllib.parse import quote

from django.conf import settings

from . import cloud
from .models import Collection, KnowledgeResource, ProjectMembership, StoragePlan, WorkspaceMembership
from .platform_access import INHERIT_VISIBILITY, content_type_for, policy_for
from .platform_models import AccessGrant

logger = logging.getLogger(__name__)


class NextcloudBridgeError(Exception):
    pass


def _plan(user):
    plan, _ = StoragePlan.objects.get_or_create(
        user=user,
        defaults={'tier': 'free', 'quota_bytes': settings.GRAVITAS_DEFAULT_QUOTA_BYTES},
    )
    return plan


def ensure_user(user):
    return cloud.ensure_identity(user, _plan(user).quota_bytes)


def project_users(project):
    users = {project.owner_id: project.owner}
    for membership in ProjectMembership.objects.filter(project=project).select_related('user'):
        users[membership.user_id] = membership.user
    return list(users.values())


def _collection_parts(collection):
    parts, seen, current = [], set(), collection
    while current:
        if current.pk in seen:
            raise NextcloudBridgeError('folder_cycle')
        seen.add(current.pk)
        parts.append(cloud.safe_filename(current.name))
        current = current.parent
    return list(reversed(parts))


def collection_relative_path(collection):
    return '/'.join(_collection_parts(collection))


def project_storage_path(project, collection=None, filename=None):
    parts = [cloud.project_mountpoint(project)]
    if collection:
        parts.extend(_collection_parts(collection))
    if filename:
        parts.append(cloud.safe_filename(filename))
    return '/'.join(parts)


def _ensure_collection_folder(project, collection, identity):
    cloud.make_folder(identity, project_storage_path(project, collection))


def _set_project_group_read_only(folder_id, group_id):
    response = cloud._request(
        'POST',
        f'{settings.NEXTCLOUD_INTERNAL_URL}/index.php/apps/groupfolders/folders/{folder_id}/groups/{quote(group_id, safe="")}',
        auth=cloud._admin_auth(),
        expected={200},
        headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
        data={'permissions': cloud.NC_PERMISSION_READ},
    )
    cloud._ocs_data(response, 'Could not configure project group permissions')


def _write_team_acl(mountpoint, relative_path, group_id, user_roles, visibility):
    """Write a complete Advanced Permissions list for a Team Folder path.

    The project group has read-only base access. Editors/managers are elevated
    with explicit user rules at the root. Restricted paths additionally deny
    the project group, then allow only explicitly permitted users/managers.
    """
    relative_path = str(relative_path or '').strip('/')
    path = cloud.safe_filename(mountpoint) + (f'/{relative_path}' if relative_path else '')
    roles = dict(user_roles or {})
    if settings.NEXTCLOUD_ADMIN_USER:
        roles.setdefault(settings.NEXTCLOUD_ADMIN_USER, 'manage')
    rules = []
    if visibility in {'specific', 'private'}:
        rules.append(('group', group_id, group_id, 0))
    for username, role in sorted(roles.items()):
        rules.append(('user', username, username, cloud.ROLE_PERMISSION_MAP.get(role, cloud.NC_PERMISSION_READ)))
    acl_xml = ''.join(
        '<nc:acl>'
        f'<nc:acl-mapping-type>{mapping_type}</nc:acl-mapping-type>'
        f'<nc:acl-mapping-id>{mapping_id}</nc:acl-mapping-id>'
        f'<nc:acl-mapping-display-name>{display}</nc:acl-mapping-display-name>'
        f'<nc:acl-mask>{cloud.NC_PERMISSION_ALL}</nc:acl-mask>'
        f'<nc:acl-permissions>{permissions}</nc:acl-permissions>'
        '</nc:acl>'
        for mapping_type, mapping_id, display, permissions in rules
    )
    body = (
        '<?xml version="1.0" encoding="utf-8" ?>'
        '<d:propertyupdate xmlns:d="DAV:" xmlns:nc="http://nextcloud.org/ns">'
        '<d:set><d:prop><nc:acl-list>' + acl_xml + '</nc:acl-list></d:prop></d:set>'
        '</d:propertyupdate>'
    )
    cloud._request(
        'PROPPATCH',
        cloud._admin_dav_url(path),
        auth=cloud._admin_auth(),
        expected={207},
        headers={'Content-Type': 'application/xml; charset=utf-8'},
        data=body.encode('utf-8'),
    )


def _project_root_roles(project):
    roles = {ensure_user(project.owner).username: 'manage'}
    for membership in ProjectMembership.objects.filter(project=project).select_related('user'):
        role = {'owner': 'manage', 'editor': 'edit', 'viewer': 'view'}.get(membership.role, 'view')
        roles[ensure_user(membership.user).username] = role
    for membership in WorkspaceMembership.objects.filter(
        workspace=project.workspace,
        role__in=['owner', 'admin'],
    ).select_related('user'):
        # Only users who are project members receive native root access. Core or
        # Research admins still recover ACLs through the service account unless
        # they have explicitly joined the project.
        if ProjectMembership.objects.filter(project=project, user=membership.user).exists() or membership.user_id == project.owner_id:
            roles[ensure_user(membership.user).username] = 'manage'
    return roles


def ensure_project_space(project):
    """Provision a native Team Folder and reconcile project membership/roles."""
    mountpoint = cloud.project_mountpoint(project)
    group_id = cloud.project_group_id(project)
    team = cloud.ensure_team_folder(mountpoint, group_id)

    identities = {}
    for user in project_users(project):
        identity = ensure_user(user)
        identities[user.pk] = identity
        cloud.add_user_to_group(identity.username, group_id)

    _set_project_group_read_only(team['id'], group_id)
    _write_team_acl(mountpoint, '', group_id, _project_root_roles(project), 'project')

    owner_identity = identities.get(project.owner_id) or ensure_user(project.owner)
    for collection in Collection.objects.filter(project=project).select_related('parent').order_by('id'):
        _ensure_collection_folder(project, collection, owner_identity)

    return {
        'folder_id': team['id'],
        'mount_point': mountpoint,
        'group_id': group_id,
        'native_url': cloud.native_files_url(mountpoint),
        'member_count': len(identities),
    }


def add_project_user(project, user):
    team = ensure_project_space(project)
    identity = ensure_user(user)
    cloud.add_user_to_group(identity.username, team['group_id'])
    ensure_project_space(project)
    return identity


def remove_project_user(project, user):
    if user.pk == project.owner_id:
        return
    identity = getattr(user, 'gravitas_nextcloud', None)
    if identity:
        cloud.remove_user_from_group(identity.username, cloud.project_group_id(project))
    ensure_project_space(project)


def _manager_users(project):
    users = {project.owner_id: project.owner}
    workspace_admins = WorkspaceMembership.objects.filter(
        workspace=project.workspace,
        role__in=['owner', 'admin'],
    ).select_related('user')
    project_user_ids = {item.pk for item in project_users(project)}
    for membership in workspace_admins:
        if membership.user_id in project_user_ids:
            users[membership.user_id] = membership.user
    return list(users.values())


def _explicit_roles(obj):
    roles = {}
    grants = AccessGrant.objects.filter(
        content_type=content_type_for(obj),
        object_id=obj.pk,
    ).select_related('user')
    for grant in grants:
        roles[grant.user_id] = (grant.user, grant.role)
    return roles


def _acl_user_roles(obj, project, visibility):
    roles = _explicit_roles(obj)
    if visibility in {'specific', 'private'}:
        for user in _manager_users(project):
            roles[user.pk] = (user, 'manage')
        for attr in ('owner', 'created_by'):
            user = getattr(obj, attr, None)
            if user is not None:
                roles[user.pk] = (user, 'manage')
    project_user_ids = {item.pk for item in project_users(project)}
    result = {}
    for user, role in roles.values():
        if user.pk not in project_user_ids:
            continue
        result[ensure_user(user).username] = role
    if settings.NEXTCLOUD_ADMIN_USER:
        result.setdefault(settings.NEXTCLOUD_ADMIN_USER, 'manage')
    return result


def _visibility(obj):
    policy = policy_for(obj)
    return policy.visibility if policy else INHERIT_VISIBILITY


def sync_collection_acl(collection):
    if not collection.project_id:
        return None
    project = collection.project
    team = ensure_project_space(project)
    owner_identity = ensure_user(project.owner)
    _ensure_collection_folder(project, collection, owner_identity)
    visibility = _visibility(collection)
    _write_team_acl(
        team['mount_point'],
        collection_relative_path(collection),
        team['group_id'],
        _acl_user_roles(collection, project, visibility),
        visibility,
    )
    return team


def sync_resource_acl(resource):
    if not resource.project_id or not resource.storage_path:
        return None
    project = resource.project
    team = ensure_project_space(project)
    mountpoint = team['mount_point']
    clean = str(resource.storage_path).strip('/')
    if not (clean == mountpoint or clean.startswith(mountpoint + '/')):
        return {'legacy': True, **team}
    relative = clean[len(mountpoint):].strip('/')
    visibility = _visibility(resource)
    _write_team_acl(
        mountpoint,
        relative,
        team['group_id'],
        _acl_user_roles(resource, project, visibility),
        visibility,
    )
    return team


def sync_object_acl(obj):
    if isinstance(obj, Collection):
        return sync_collection_acl(obj)
    if isinstance(obj, KnowledgeResource):
        return sync_resource_acl(obj)
    return None


def native_url_for(obj):
    if hasattr(obj, 'workspace') and obj.__class__.__name__ == 'ResearchProject':
        return cloud.native_files_url(cloud.project_mountpoint(obj))
    project = getattr(obj, 'project', None)
    if project is None:
        return cloud.native_files_url()
    if isinstance(obj, Collection):
        return cloud.native_files_url(project_storage_path(project, obj))
    if isinstance(obj, KnowledgeResource) and obj.storage_path:
        return cloud.native_files_url(str(PurePosixPath(obj.storage_path).parent))
    return cloud.native_files_url(cloud.project_mountpoint(project))


def create_native_client_credentials(user):
    identity = ensure_user(user)
    app_password = cloud.create_app_password(identity)
    return {
        'server': f'{settings.PUBLIC_BASE_URL}/nextcloud',
        'username': identity.username,
        'app_password': app_password,
        'web_url': f'{settings.PUBLIC_BASE_URL}/nextcloud/',
        'note': 'This app password is shown once. Store it in the official Nextcloud client; it can be revoked from Nextcloud security settings.',
    }
