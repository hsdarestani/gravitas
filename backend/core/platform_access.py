from django.contrib.contenttypes.models import ContentType
from django.db.models import Q
from django.utils import timezone

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
    """Return the object whose ACL should be inherited by ``obj``.

    Collections inherit from their parent folder and then from the project.
    Project resources inherit from their collection when present. Other
    project-scoped objects inherit from the project; workspace-scoped objects
    inherit from the workspace. This keeps permission inheritance explicit and
    deterministic without maintaining a second ACL tree.
    """
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
    membership = WorkspaceMembership.objects.filter(workspace=workspace, user=user).first()
    if not membership:
        return None
    return 'manage' if membership.role in {'owner', 'admin'} else 'edit'


def _workspace_admin_role(user, workspace):
    if not user or not getattr(user, 'is_authenticated', False) or workspace is None:
        return None
    if workspace.kind == Workspace.Kind.PERSONAL and workspace.owner_id == user.pk:
        return 'manage'
    membership = WorkspaceMembership.objects.filter(workspace=workspace, user=user).first()
    return 'manage' if membership and membership.role in {'owner', 'admin'} else None


def _project_role(user, project):
    if not user or not getattr(user, 'is_authenticated', False) or project is None:
        return None
    if project.owner_id == user.pk:
        return 'manage'
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
    """Keep project owners and workspace admins able to recover ACLs.

    A restricted folder can hide data from ordinary project members, but the
    project owner and Research workspace administrators must never lock
    themselves out of the object they are responsible for managing.
    """
    project = _project(obj)
    if project is not None and project.owner_id == getattr(user, 'pk', None):
        return 'manage'
    return _workspace_admin_role(user, _workspace(obj))


def direct_grant(user, obj):
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    now = timezone.now()
    grant = AccessGrant.objects.filter(
        content_type=content_type_for(obj),
        object_id=obj.pk,
        user=user,
    ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now)).first()
    return grant.role if grant else None


def policy_for(obj, *, create=False, created_by=None, default_visibility=None):
    ct = content_type_for(obj)
    policy = ObjectPolicy.objects.filter(content_type=ct, object_id=obj.pk).first()
    if policy or not create:
        return policy
    if default_visibility is None:
        default_visibility = ObjectPolicy.Visibility.PRIVATE if isinstance(obj, Workspace) and obj.kind == Workspace.Kind.PERSONAL else ObjectPolicy.Visibility.WORKSPACE
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
        # Backward compatible default for objects created before V2.
        parent = _parent_object(obj)
        if parent is not None and not isinstance(obj, ResearchProject):
            inherited = effective_role(user, parent, _seen)
            if inherited:
                roles.append(inherited)
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
        workspace_role = _workspace_role(user, workspace)
        if workspace_role:
            roles.append(workspace_role)
    elif policy.visibility == ObjectPolicy.Visibility.LINK:
        # A link token must be validated separately. Logged-in membership still applies.
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
