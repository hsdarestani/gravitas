from django.contrib.contenttypes.models import ContentType
from django.db.models import Q
from django.utils import timezone
from contextlib import contextmanager
from contextvars import ContextVar

from .models import (
    Collection,
    KnowledgeResource,
    ProjectMembership,
    ResearchProject,
    Workspace,
    WorkspaceMembership,
)
from .operating_models import Initiative, OperatingTask
from .platform_models import (
    AccessGrant,
    ContentWorkItem,
    MindMap,
    ObjectPolicy,
    ProjectDeliverable,
    ResearchRequest,
)

ROLE_RANK = {'view': 10, 'comment': 20, 'edit': 30, 'manage': 40}
INHERIT_VISIBILITY = 'inherit'
VALID_VISIBILITIES = set(ObjectPolicy.Visibility.values) | {INHERIT_VISIBILITY}
_access_batch = ContextVar('platform_access_batch', default=None)


@contextmanager
def access_batch(user, objects):
    """Evaluate the unchanged policy rules from one request-local bulk read.

    Analytics can inspect thousands of tasks. Repeating the policy inheritance
    SQL walk for every metric is both slow and a tempting reason to skip ACLs.
    Only preloaded keys use this snapshot; other objects take the normal path.
    The snapshot is discarded before a mutation or another request.
    """
    objects = list(objects)
    all_objects = {}
    pending = objects[:]
    while pending:
        obj = pending.pop()
        if obj is None or (obj.__class__, obj.pk) in all_objects:
            continue
        all_objects[obj.__class__, obj.pk] = obj
        parent = _parent_object(obj)
        if parent is not None:
            pending.append(parent)
        workspace = _workspace(obj)
        if workspace is not None and workspace is not obj:
            pending.append(workspace)
    values = list(all_objects.values())
    types = ContentType.objects.get_for_models(*(set(type(obj) for obj in values)), for_concrete_models=False) if values else {}
    keys = {(types[type(obj)].pk, obj.pk) for obj in values}
    ctids = {key[0] for key in keys}
    ids = {key[1] for key in keys}
    policies = {(ct, pk): None for ct, pk in keys}
    grants = dict(policies)
    for row in ObjectPolicy.objects.filter(content_type_id__in=ctids, object_id__in=ids):
        policies[row.content_type_id, row.object_id] = row
    for row in AccessGrant.objects.filter(user=user, content_type_id__in=ctids, object_id__in=ids).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now())):
        grants[row.content_type_id, row.object_id] = row.role
    workspaces = {obj.pk for obj in values if isinstance(obj, Workspace)}
    projects = {obj.pk for obj in values if isinstance(obj, ResearchProject)}
    data = {'user': user.pk, 'policies': policies, 'grants': grants,
            'members': {pk: None for pk in workspaces}, 'projects': {pk: None for pk in projects}}
    data['members'].update(WorkspaceMembership.objects.filter(user=user, workspace_id__in=workspaces).values_list('workspace_id', 'role'))
    data['projects'].update(ProjectMembership.objects.filter(user=user, project_id__in=projects).values_list('project_id', 'role'))
    token = _access_batch.set(data)
    try:
        yield
    finally:
        _access_batch.reset(token)

TARGET_MODELS = {
    'workspace': Workspace,
    'project': ResearchProject,
    'resource': KnowledgeResource,
    'collection': Collection,
    'task': OperatingTask,
    'initiative': Initiative,
    'content-work': ContentWorkItem,
    'research-request': ResearchRequest,
    'mindmap': MindMap,
    'deliverable': ProjectDeliverable,
}


def resolve_target(target_type, object_id):
    model = TARGET_MODELS.get(str(target_type or '').strip().lower())
    if model is None:
        return None
    try:
        return model.objects.get(pk=int(object_id))
    except (model.DoesNotExist, TypeError, ValueError):
        return None


def content_type_for(obj):
    return ContentType.objects.get_for_model(obj, for_concrete_model=False)


def _workspace(obj):
    if isinstance(obj, Workspace):
        return obj
    workspace = getattr(obj, 'workspace', None)
    if workspace is not None:
        return workspace
    project = _project(obj)
    return getattr(project, 'workspace', None) if project is not None else None


def _project(obj):
    if isinstance(obj, ResearchProject):
        return obj
    project = getattr(obj, 'project', None)
    if project is not None:
        return project
    return getattr(obj, 'research_project', None)


def _parent_object(obj):
    if isinstance(obj, KnowledgeResource):
        if obj.collection_id:
            return obj.collection
        if obj.project_id:
            return obj.project
        return obj.workspace
    if isinstance(obj, Collection):
        if obj.parent_id:
            return obj.parent
        if obj.project_id:
            return obj.project
        return obj.workspace
    if isinstance(obj, ResearchProject):
        return obj.workspace
    project = _project(obj)
    if project is not None:
        return project
    workspace = _workspace(obj)
    if workspace is not obj:
        return workspace
    return None


def _workspace_role(user, workspace):
    if not user or not getattr(user, 'is_authenticated', False) or workspace is None:
        return None
    if workspace.kind == Workspace.Kind.PERSONAL and workspace.owner_id == user.pk:
        return 'manage'
    batch = _access_batch.get()
    if batch and batch['user'] == user.pk and workspace.pk in batch['members']:
        role = batch['members'][workspace.pk]
        return ('manage' if role in {'owner', 'admin'} else 'edit') if role else None
    membership = WorkspaceMembership.objects.filter(workspace=workspace, user=user).first()
    if not membership:
        return None
    return 'manage' if membership.role in {'owner', 'admin'} else 'edit'


def _workspace_admin_role(user, workspace):
    if not user or not getattr(user, 'is_authenticated', False) or workspace is None:
        return None
    if workspace.kind == Workspace.Kind.PERSONAL and workspace.owner_id == user.pk:
        return 'manage'
    batch = _access_batch.get()
    if batch and batch['user'] == user.pk and workspace.pk in batch['members']:
        return 'manage' if batch['members'][workspace.pk] in {'owner', 'admin'} else None
    membership = WorkspaceMembership.objects.filter(workspace=workspace, user=user).first()
    return 'manage' if membership and membership.role in {'owner', 'admin'} else None


def _project_role(user, project):
    if not user or not getattr(user, 'is_authenticated', False) or project is None:
        return None
    if project.owner_id == user.pk:
        return 'manage'
    batch = _access_batch.get()
    if batch and batch['user'] == user.pk and project.pk in batch['projects']:
        return {'owner': 'manage', 'editor': 'edit', 'viewer': 'view'}.get(batch['projects'][project.pk])
    membership = ProjectMembership.objects.filter(project=project, user=user).first()
    if membership:
        return {'owner': 'manage', 'editor': 'edit', 'viewer': 'view'}.get(membership.role, 'view')
    return None


def _owner_role(user, obj):
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    for attr in ('owner_id', 'created_by_id', 'requested_by_id'):
        if getattr(obj, attr, None) == user.pk:
            return 'manage'
    if isinstance(obj, Workspace) and obj.owner_id == user.pk:
        return 'manage'
    return None


def _administrative_role(user, obj):
    project = _project(obj)
    if project is not None and project.owner_id == getattr(user, 'pk', None):
        return 'manage'
    return _workspace_admin_role(user, _workspace(obj))


def direct_grant(user, obj):
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    batch = _access_batch.get()
    key = (content_type_for(obj).pk, obj.pk)
    if batch and batch['user'] == user.pk and key in batch['grants']:
        return batch['grants'][key]
    now = timezone.now()
    grant = AccessGrant.objects.filter(
        content_type=content_type_for(obj),
        object_id=obj.pk,
        user=user,
    ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now)).first()
    return grant.role if grant else None


def policy_for(obj, *, create=False, created_by=None, default_visibility=None):
    ct = content_type_for(obj)
    batch = _access_batch.get()
    if not create and batch and (ct.pk, obj.pk) in batch['policies']:
        return batch['policies'][ct.pk, obj.pk]
    policy = ObjectPolicy.objects.filter(content_type=ct, object_id=obj.pk).first()
    if policy or not create:
        return policy
    if default_visibility is None:
        if isinstance(obj, Workspace) and obj.kind == Workspace.Kind.PERSONAL:
            default_visibility = ObjectPolicy.Visibility.PRIVATE
        elif _project(obj) is not None and not isinstance(obj, ResearchProject):
            default_visibility = INHERIT_VISIBILITY
        else:
            default_visibility = ObjectPolicy.Visibility.WORKSPACE
    return ObjectPolicy.objects.create(
        content_type=ct,
        object_id=obj.pk,
        visibility=default_visibility,
        created_by=created_by,
    )


def effective_role(user, obj, _seen=None):
    if obj is None:
        return None
    _seen = set() if _seen is None else _seen
    key = (obj.__class__.__name__, getattr(obj, 'pk', None))
    if key in _seen:
        return None
    _seen.add(key)

    roles = []
    owner_role = _owner_role(user, obj)
    if owner_role:
        roles.append(owner_role)
    admin_role = _administrative_role(user, obj)
    if admin_role:
        roles.append(admin_role)
    grant_role = direct_grant(user, obj)
    if grant_role:
        roles.append(grant_role)

    policy = policy_for(obj)
    project = _project(obj)
    workspace = _workspace(obj)

    if policy is None:
        parent = _parent_object(obj)
        if parent is not None and not isinstance(obj, ResearchProject):
            inherited = effective_role(user, parent, _seen)
            if inherited:
                roles.append(inherited)
        elif isinstance(obj, ResearchProject):
            project_role = _project_role(user, obj)
            if project_role:
                roles.append(project_role)
        else:
            project_role = _project_role(user, project)
            workspace_role = _workspace_role(user, workspace)
            if project_role:
                roles.append(project_role)
            elif workspace_role:
                roles.append(workspace_role)
    elif policy.visibility == INHERIT_VISIBILITY:
        inherited = effective_role(user, _parent_object(obj), _seen)
        if inherited:
            roles.append(inherited)
    elif policy.visibility == ObjectPolicy.Visibility.PRIVATE:
        pass
    elif policy.visibility == ObjectPolicy.Visibility.SPECIFIC:
        pass
    elif policy.visibility == ObjectPolicy.Visibility.PROJECT:
        project_role = _project_role(user, project)
        if project_role:
            roles.append(project_role)
    elif policy.visibility == ObjectPolicy.Visibility.WORKSPACE:
        # Research projects are security boundaries. Historical project records
        # used WORKSPACE as their default policy, but broad Research workspace
        # membership must not imply project access. ProjectMembership remains
        # the gate; workspace admins retain recovery through admin_role above.
        if isinstance(obj, ResearchProject):
            project_role = _project_role(user, obj)
            if project_role:
                roles.append(project_role)
        else:
            workspace_role = _workspace_role(user, workspace)
            if workspace_role:
                roles.append(workspace_role)
    elif policy.visibility == ObjectPolicy.Visibility.LINK:
        project_role = _project_role(user, project)
        workspace_role = _workspace_role(user, workspace)
        if project_role:
            roles.append(project_role)
        elif workspace_role:
            roles.append(workspace_role)
    elif policy.visibility == ObjectPolicy.Visibility.PUBLIC:
        roles.append('view')
        project_role = _project_role(user, project)
        workspace_role = _workspace_role(user, workspace)
        if project_role:
            roles.append(project_role)
        elif workspace_role:
            roles.append(workspace_role)

    if not roles:
        return None
    return max(roles, key=lambda value: ROLE_RANK.get(value, 0))


def access_flags(user, obj):
    """Serialize several permissions from one authoritative access evaluation.

    This is not a cache: each object and each request still consults current
    policy/grants. Calling effective_role independently for every output flag
    repeated the entire inheritance/SQL walk three times per cockpit row.
    """
    role = effective_role(user, obj)
    rank = ROLE_RANK.get(role, 0)
    return {'role': role, 'can_edit': rank >= ROLE_RANK['edit'],
            'can_manage': rank >= ROLE_RANK['manage']}


def has_role(user, obj, minimum='view'):
    role = effective_role(user, obj)
    return bool(role and ROLE_RANK.get(role, 0) >= ROLE_RANK[minimum])


def can_view(user, obj):
    return has_role(user, obj, 'view')


def can_comment(user, obj):
    return has_role(user, obj, 'comment')


def can_edit(user, obj):
    return has_role(user, obj, 'edit')


def can_manage(user, obj):
    return has_role(user, obj, 'manage')


def inherited_from(obj):
    parent = _parent_object(obj)
    if parent is None:
        return None
    target_type = next((key for key, model in TARGET_MODELS.items() if isinstance(parent, model)), parent.__class__.__name__.lower())
    return {
        'type': target_type,
        'id': parent.pk,
        'title': getattr(parent, 'title', None) or getattr(parent, 'name', str(parent)),
    }


def public_view_allowed(obj):
    policy = policy_for(obj)
    return bool(policy and policy.visibility == ObjectPolicy.Visibility.PUBLIC)


def link_allowed_for_project(obj):
    project = _project(obj)
    if project is None:
        return True
    profile = getattr(project, 'platform_profile', None)
    if profile is None:
        return True
    if profile.secure_data_room and not profile.allow_public_links:
        return False
    return profile.allow_public_links or profile.visibility in {'community', 'public'}


def downloads_allowed(obj, _seen=None):
    _seen = set() if _seen is None else _seen
    if obj is None:
        return True
    key = (obj.__class__.__name__, getattr(obj, 'pk', None))
    if key in _seen:
        return False
    _seen.add(key)
    policy = policy_for(obj)
    if policy and not policy.allow_download:
        return False
    if policy and policy.visibility == INHERIT_VISIBILITY:
        parent = _parent_object(obj)
        if parent is not None and not downloads_allowed(parent, _seen):
            return False
    project = _project(obj)
    profile = getattr(project, 'platform_profile', None) if project else None
    return not profile or profile.allow_downloads


def grant_role(obj, user, role, granted_by=None, expires_at=None):
    if role not in ROLE_RANK:
        raise ValueError('invalid_role')
    return AccessGrant.objects.update_or_create(
        content_type=content_type_for(obj),
        object_id=obj.pk,
        user=user,
        defaults={'role': role, 'granted_by': granted_by, 'expires_at': expires_at},
    )[0]
