import logging
from pathlib import PurePosixPath

from django.conf import settings

from . import cloud
from .models import Collection, KnowledgeResource, ProjectMembership, StoragePlan, WorkspaceMembership
from .platform_access import INHERIT_VISIBILITY, content_type_for, policy_for
from .platform_models import AccessGrant, ObjectPolicy

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


def ensure_project_space(project):
    """Provision a native Team Folder and map all project members into it.

    This operation is idempotent and can safely be called on project open,
    membership changes and file uploads. The mount point is derived from the
    immutable project id, so renaming the project never breaks sync clients.
    """
    mountpoint = cloud.project_mountpoint(project)
    group_id = cloud.project_group_id(project)
    team = cloud.ensure_team_folder(mountpoint, group_id)

    identities = {}
    for user in project_users(project):
        identity = ensure_user(user)
        identities[user.pk] = identity
        cloud.add_user_to_group(identity.username, group_id)

    owner_identity = identities.get(project.owner_id) or ensure_user(project.owner)
    # Ensure the standard project tree and all custom nested collections exist
    # physically in the Team Folder so native Nextcloud clients see the same
    # structure as Gravitas.
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
    return identity


def remove_project_user(project, user):
    if user.pk == project.owner_id:
        return
    identity = getattr(user, 'gravitas_nextcloud', None)
    if identity:
        cloud.remove_user_from_group(identity.username, cloud.project_group_id(project))


def _manager_users(project):
    users = {project.owner_id: project.owner}
    workspace_admins = WorkspaceMembership.objects.filter(
        workspace=project.workspace,
        role__in=['owner', 'admin'],
    ).select_related('user')
    for membership in workspace_admins:
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
    if visibility not in {'specific', 'private'}:
        return {}
    roles = _explicit_roles(obj)
    # ACL recovery: project owner/workspace admins always retain management.
    for user in _manager_users(project):
        roles[user.pk] = (user, 'manage')
    # The creator/owner of the object also keeps management when available.
    for attr in ('owner', 'created_by'):
        user = getattr(obj, attr, None)
        if user is not None:
            roles[user.pk] = (user, 'manage')
    result = {}
    for user, role in roles.values():
        # Native Team Folder ACL can only grant users who are project members.
        # A direct object share does not silently expose the rest of the project.
        if user.pk not in {item.pk for item in project_users(project)}:
            continue
        result[ensure_user(user).username] = role
    return result


def _visibility(obj):
    policy = policy_for(obj)
    if not policy:
        return INHERIT_VISIBILITY
    return policy.visibility


def sync_collection_acl(collection):
    if not collection.project_id:
        return None
    project = collection.project
    team = ensure_project_space(project)
    owner_identity = ensure_user(project.owner)
    _ensure_collection_folder(project, collection, owner_identity)
    visibility = _visibility(collection)
    cloud.set_team_folder_acl(
        team['mount_point'],
        collection_relative_path(collection),
        team['group_id'],
        _acl_user_roles(collection, project, visibility),
        visibility=visibility,
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
        # Legacy per-user resource. It remains protected by Gravitas until the
        # migration command moves it into the project Team Folder.
        return {'legacy': True, **team}
    relative = clean[len(mountpoint):].strip('/')
    visibility = _visibility(resource)
    cloud.set_team_folder_acl(
        mountpoint,
        relative,
        team['group_id'],
        _acl_user_roles(resource, project, visibility),
        visibility=visibility,
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
    mountpoint = cloud.project_mountpoint(project)
    if isinstance(obj, Collection):
        return cloud.native_files_url(project_storage_path(project, obj))
    if isinstance(obj, KnowledgeResource) and obj.storage_path:
        path = str(PurePosixPath(obj.storage_path).parent)
        return cloud.native_files_url(path)
    return cloud.native_files_url(mountpoint)


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
