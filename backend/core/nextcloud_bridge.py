import logging
from pathlib import PurePosixPath
from urllib.parse import quote

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from . import cloud
from .layer_models import CommunityProfile, ModuleGrant
from .models import (
    Collection,
    KnowledgeResource,
    ProjectMembership,
    ResearchProject,
    StoragePlan,
    WorkspaceMembership,
)
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


def _native_project_user_enabled(user):
    """Return whether a Research participant may exist in native project ACLs.

    ProjectMembership is the object relationship, while ModuleGrant/account and
    community state are the product-level gate. Native Nextcloud membership has
    to respect both; otherwise a user suspended in Gravitas can keep accessing
    Team Folders directly from a Nextcloud client.
    """
    if not user or not getattr(user, 'is_active', False):
        return False
    if getattr(user, 'is_superuser', False):
        return True

    profile = CommunityProfile.objects.filter(user=user).only('status').first()
    if profile is not None and profile.status != CommunityProfile.Status.ACTIVE:
        return False

    grant = ModuleGrant.objects.filter(
        user=user,
        module=ModuleGrant.Module.RESEARCH,
    ).first()
    if grant is not None and not grant.is_effective():
        return False
    return True


def project_users(project):
    users = {}
    if _native_project_user_enabled(project.owner):
        users[project.owner_id] = project.owner
    for membership in ProjectMembership.objects.filter(project=project).select_related('user'):
        if _native_project_user_enabled(membership.user):
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
    memberships = {
        item.user_id: item.role
        for item in ProjectMembership.objects.filter(project=project)
    }
    roles = {}
    for user in project_users(project):
        if user.pk == project.owner_id:
            role = 'manage'
        else:
            role = {
                'owner': 'manage',
                'editor': 'edit',
                'viewer': 'view',
            }.get(memberships.get(user.pk), 'view')
        roles[ensure_user(user).username] = role

    # Workspace administrators only receive native project management when they
    # are also legitimate project participants. Product-layer suspension above
    # therefore remains authoritative even for historical workspace members.
    eligible_ids = {user.pk for user in project_users(project)}
    for membership in WorkspaceMembership.objects.filter(
        workspace=project.workspace,
        role__in=['owner', 'admin'],
        user_id__in=eligible_ids,
    ).select_related('user'):
        roles[ensure_user(membership.user).username] = 'manage'
    return roles


def ensure_project_space(project):
    """Provision a native Team Folder and reconcile eligible membership/roles."""
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

    # A suspended/inactive owner must not be silently re-enabled merely because
    # collection folders need maintenance. Use any eligible project identity;
    # with no eligible project user, preserve existing folders and let a future
    # reconciliation create missing folders once someone is entitled again.
    writer_identity = identities.get(project.owner_id) or next(iter(identities.values()), None)
    if writer_identity is not None:
        for collection in Collection.objects.filter(project=project).select_related('parent').order_by('id'):
            _ensure_collection_folder(project, collection, writer_identity)

    return {
        'folder_id': team['id'],
        'mount_point': mountpoint,
        'group_id': group_id,
        'native_url': cloud.native_files_url(mountpoint),
        'member_count': len(identities),
    }


def add_project_user(project, user):
    if not _native_project_user_enabled(user):
        raise NextcloudBridgeError('research_access_disabled')
    team = ensure_project_space(project)
    identity = ensure_user(user)
    cloud.add_user_to_group(identity.username, team['group_id'])
    ensure_project_space(project)
    return identity


def remove_project_user(project, user):
    # Owners cannot be removed while they are entitled, but an account/module
    # suspension must be able to deprovision an owner from native access too.
    if user.pk == project.owner_id and _native_project_user_enabled(user):
        return
    identity = getattr(user, 'gravitas_nextcloud', None)
    if identity:
        cloud.remove_user_from_group(identity.username, cloud.project_group_id(project))
    ensure_project_space(project)


def reconcile_user_research_access(user):
    """Converge all native Research project groups for one account.

    This is intentionally idempotent and queries current database state, which
    also makes it usable as compensation after a surrounding DB transaction is
    rolled back because a native synchronization failed.
    """
    projects = ResearchProject.objects.filter(archived=False).filter(
        Q(owner=user) | Q(memberships__user=user)
    ).select_related('owner', 'workspace').distinct().order_by('id')
    enabled = _native_project_user_enabled(user)
    identity = getattr(user, 'gravitas_nextcloud', None)
    reconciled = 0
    for project in projects:
        if not enabled and identity is not None:
            cloud.remove_user_from_group(identity.username, cloud.project_group_id(project))
        ensure_project_space(project)
        reconciled += 1
    return {'enabled': enabled, 'projects': reconciled}


def _manager_users(project):
    eligible = {user.pk: user for user in project_users(project)}
    users = {}
    if project.owner_id in eligible:
        users[project.owner_id] = eligible[project.owner_id]
    for membership in WorkspaceMembership.objects.filter(
        workspace=project.workspace,
        role__in=['owner', 'admin'],
        user_id__in=eligible.keys(),
    ).select_related('user'):
        users[membership.user_id] = membership.user
    return list(users.values())


def _explicit_roles(obj):
    roles = {}
    now = timezone.now()
    grants = AccessGrant.objects.filter(
        content_type=content_type_for(obj),
        object_id=obj.pk,
    ).filter(
        Q(expires_at__isnull=True) | Q(expires_at__gt=now)
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
            if user is not None and _native_project_user_enabled(user):
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
    eligible = project_users(project)
    writer = next((user for user in eligible if user.pk == project.owner_id), None)
    writer = writer or (eligible[0] if eligible else None)
    if writer is not None:
        _ensure_collection_folder(project, collection, ensure_user(writer))
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
    response = cloud._request(
        'GET',
        f'{settings.NEXTCLOUD_INTERNAL_URL}/ocs/v2.php/core/getapppassword',
        auth=cloud._auth(identity),
        expected={200},
        headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
        params={'format': 'json'},
    )
    data = cloud._ocs_data(response, 'Could not create Nextcloud app password')
    app_password = data.get('apppassword') if isinstance(data, dict) else data
    if not app_password:
        raise cloud.CloudError('Nextcloud did not return an app password')
    return {
        'server': f'{settings.PUBLIC_BASE_URL}/nextcloud',
        'username': identity.username,
        'app_password': str(app_password),
        'web_url': f'{settings.PUBLIC_BASE_URL}/nextcloud/',
        'note': 'This app password is shown once. Store it in the official Nextcloud client; it can be revoked from Nextcloud security settings.',
    }
