from django.contrib.contenttypes.models import ContentType
from django.db.models import Q
from django.utils import timezone

from .layer_models import ActivityEvent, CommunityProfile, ModuleGrant
from .models import ProjectMembership, ResearchProject, WorkspaceMembership
from .platform_models import AccessGrant, WorkspaceProfile


ACCESS_LEVEL_RANK = {
    ModuleGrant.AccessLevel.VIEW: 10,
    ModuleGrant.AccessLevel.PARTICIPATE: 20,
    ModuleGrant.AccessLevel.EDIT: 30,
    ModuleGrant.AccessLevel.MANAGE: 40,
}


def community_profile(user):
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    profile, _ = CommunityProfile.objects.get_or_create(user=user)
    ModuleGrant.objects.get_or_create(
        user=user,
        module=ModuleGrant.Module.DASHBOARD,
        defaults={
            'enabled': True,
            'access_level': ModuleGrant.AccessLevel.PARTICIPATE,
            'source': ModuleGrant.Source.SYSTEM,
        },
    )
    return profile


def grant_is_effective(grant, at=None):
    if grant is None:
        return None
    return grant.is_effective(at or timezone.now())


def _grant(user, module):
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    return ModuleGrant.objects.filter(user=user, module=module).first()


def _core_workspace():
    return (
        WorkspaceProfile.objects.filter(purpose=WorkspaceProfile.Purpose.CORE)
        .select_related('workspace')
        .order_by('workspace_id')
        .first()
    )


def _core_membership(user):
    profile = _core_workspace()
    if profile is None:
        return None
    return WorkspaceMembership.objects.filter(workspace=profile.workspace, user=user).first()


def _research_participation(user):
    """Return whether the account has a real Research object relationship.

    This preserves access for existing project participants without recreating
    the old behaviour where every registered account saw Research by default.
    """
    if ResearchProject.objects.filter(owner=user, archived=False).exists():
        return True
    if ProjectMembership.objects.filter(user=user, project__archived=False).exists():
        return True

    # Direct project grants are also legitimate participation. Only project
    # grants count here; a shared note must not silently unlock an entire
    # workspace.
    project_ct = ContentType.objects.get_for_model(ResearchProject, for_concrete_model=False)
    now = timezone.now()
    return AccessGrant.objects.filter(
        user=user,
        content_type=project_ct,
    ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now)).exists()


def _lms_participation(user):
    # Lazy import keeps the entitlement layer independent from the LMS module
    # at import time and avoids a model-registration cycle in CoreConfig.ready.
    from .lms_models import CourseEnrollment

    return CourseEnrollment.objects.filter(
        user=user,
        status__in=[CourseEnrollment.Status.ACTIVE, CourseEnrollment.Status.COMPLETED, CourseEnrollment.Status.PAUSED],
    ).exists()


def module_access(user, module):
    """Resolve effective layer access.

    An explicit ModuleGrant wins for LMS/Research. This means an administrator
    can deliberately suspend one layer even if historical project/enrollment
    records still exist.

    Internal Core membership represents Layer 5 and therefore inherits the
    lower LMS and Research product layers when there is no explicit grant for
    that layer. This keeps the product hierarchy coherent: an internal team
    member cannot have the Core control plane while Learning disappears from
    navigation. Ordinary community accounts still need enrollment/project
    participation (or an explicit grant) for those layers.

    Core additionally requires Core WorkspaceMembership. A Core grant can
    explicitly disable a membership but can never create one by itself.
    """
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if getattr(user, 'is_superuser', False):
        return True

    profile = community_profile(user)
    if not profile or profile.status != CommunityProfile.Status.ACTIVE or not getattr(user, 'is_active', True):
        return False

    grant = _grant(user, module)

    if module == ModuleGrant.Module.DASHBOARD:
        # Registered, active accounts always own Layer 2. The grant is kept so
        # Layer 5 can report provenance, not so it can accidentally remove the
        # account home.
        return True

    if module == ModuleGrant.Module.CORE:
        membership = _core_membership(user)
        if not membership:
            return False
        if grant is not None:
            return bool(grant_is_effective(grant))
        return True

    if grant is not None:
        return bool(grant_is_effective(grant))

    # Layer 5 is the internal control plane for all lower product layers.
    # Preserve explicit per-layer suspensions above, but otherwise make Core
    # membership sufficient to open both Learning and Research.
    if module in {ModuleGrant.Module.LMS, ModuleGrant.Module.RESEARCH} and _core_membership(user):
        return True

    if module == ModuleGrant.Module.LMS:
        return _lms_participation(user)
    if module == ModuleGrant.Module.RESEARCH:
        return _research_participation(user)
    return False


def module_access_level(user, module):
    if not module_access(user, module):
        return None
    grant = _grant(user, module)
    if grant and grant.is_effective():
        return grant.access_level
    if module == ModuleGrant.Module.CORE:
        membership = _core_membership(user)
        if membership and membership.role in {'owner', 'admin'}:
            return ModuleGrant.AccessLevel.MANAGE
        return ModuleGrant.AccessLevel.EDIT
    return ModuleGrant.AccessLevel.PARTICIPATE


def effective_modules(user):
    return {
        module: {
            'enabled': module_access(user, module),
            'access_level': module_access_level(user, module),
        }
        for module in ModuleGrant.Module.values
    }


def set_module_grant(
    user,
    module,
    *,
    enabled=True,
    access_level=ModuleGrant.AccessLevel.PARTICIPATE,
    source=ModuleGrant.Source.ADMIN,
    granted_by=None,
    starts_at=None,
    expires_at=None,
    metadata=None,
):
    if module not in ModuleGrant.Module.values:
        raise ValueError('invalid_module')
    if access_level not in ModuleGrant.AccessLevel.values:
        raise ValueError('invalid_access_level')
    grant, _ = ModuleGrant.objects.update_or_create(
        user=user,
        module=module,
        defaults={
            'enabled': bool(enabled),
            'access_level': access_level,
            'source': source,
            'granted_by': granted_by,
            'starts_at': starts_at,
            'expires_at': expires_at,
            'metadata': metadata or {},
        },
    )
    return grant


def record_activity(
    *,
    layer,
    action,
    actor=None,
    subject_user=None,
    object_type='',
    object_id='',
    detail=None,
):
    if layer not in ActivityEvent.Layer.values:
        raise ValueError('invalid_layer')
    return ActivityEvent.objects.create(
        actor=actor if getattr(actor, 'pk', None) else None,
        subject_user=subject_user if getattr(subject_user, 'pk', None) else None,
        layer=layer,
        action=action,
        object_type=str(object_type or '')[:100],
        object_id=str(object_id or '')[:160],
        detail=detail or {},
    )