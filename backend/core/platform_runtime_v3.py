import json
import logging

from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .layer_access import community_profile, module_access, module_access_level
from .layer_models import ModuleGrant
from .models import (
    Organization,
    OrganizationMembership,
    ResearchProject,
    Workspace,
    WorkspaceMembership,
)
from .operating_models import OperatingTask
from .platform_access import can_view
from .platform_models import ResearchRequest, WorkspaceProfile
from .workspace_api import provision_personal_workspace


logger = logging.getLogger(__name__)


def _canonical_workspace(purpose, organization=None):
    qs = Workspace.objects.filter(platform_profile__purpose=purpose).select_related('organization', 'platform_profile')
    if organization is not None:
        qs = qs.filter(organization=organization)
    return qs.order_by('id').first()


def _canonical_organization(user):
    core = _canonical_workspace(WorkspaceProfile.Purpose.CORE)
    if core and core.organization_id:
        return core.organization
    research = _canonical_workspace(WorkspaceProfile.Purpose.RESEARCH)
    if research and research.organization_id:
        return research.organization
    org = Organization.objects.filter(slug='gravitas').first() or Organization.objects.filter(name='Gravitas').order_by('id').first()
    if org:
        return org
    return Organization.objects.create(name='Gravitas', slug='gravitas', created_by=user)


@transaction.atomic
def ensure_platform_workspaces(user):
    """Return the shared Core/Research platform plus the user's private scope.

    Layer access is intentionally resolved elsewhere. Provisioning a shared
    Research workspace must never imply that this account is allowed to open
    Research; project participation or a module grant decides that.

    This helper may provision missing canonical rows, but it must not perform
    global membership cleanup on a read request. Legacy broad Research
    memberships are removed once by a data migration instead. Keeping that
    cleanup out of bootstrap prevents concurrent workspace loads from mutating
    shared authorization state or contending on the membership table.
    """
    personal = provision_personal_workspace(user)
    WorkspaceProfile.objects.get_or_create(
        workspace=personal,
        defaults={
            'purpose': WorkspaceProfile.Purpose.PERSONAL,
            'description': 'Private research, notes and files.',
            'nextcloud_root': 'Gravitas/My Files',
        },
    )

    org = _canonical_organization(user)
    core = _canonical_workspace(WorkspaceProfile.Purpose.CORE, org)
    created_core = False
    if not core:
        core = Workspace.objects.create(name='Gravitas Core', kind=Workspace.Kind.TEAM, organization=org)
        WorkspaceProfile.objects.create(
            workspace=core,
            purpose=WorkspaceProfile.Purpose.CORE,
            description='Internal Gravitas operations, projects, tasks and content.',
            is_default=True,
            nextcloud_root='Gravitas/Core',
        )
        created_core = True

    # Only the user who bootstraps a brand-new platform becomes an internal
    # member. Team/community role never grants Core on its own.
    if created_core:
        WorkspaceMembership.objects.get_or_create(
            workspace=core,
            user=user,
            defaults={'role': WorkspaceMembership.Role.ADMIN},
        )
        OrganizationMembership.objects.get_or_create(
            organization=org,
            user=user,
            defaults={'role': OrganizationMembership.Role.OWNER},
        )

    research = _canonical_workspace(WorkspaceProfile.Purpose.RESEARCH, org)
    if not research:
        research = Workspace.objects.create(name='Gravitas Research', kind=Workspace.Kind.TEAM, organization=org)
        WorkspaceProfile.objects.create(
            workspace=research,
            purpose=WorkspaceProfile.Purpose.RESEARCH,
            description='Scientific research, client projects and collaboration.',
            is_default=True,
            nextcloud_root='Gravitas/Research',
        )

    return {'personal': personal, 'core': core, 'research': research}


def core_access(user, core=None):
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if getattr(user, 'is_superuser', False):
        return True
    # module_access(CORE) requires the actual Core WorkspaceMembership. An
    # explicit disabled Core grant can suspend it, but a grant cannot create
    # membership and therefore cannot manufacture internal access.
    return module_access(user, ModuleGrant.Module.CORE)


def core_role(user, core=None):
    if getattr(user, 'is_superuser', False):
        return 'admin'
    if not core_access(user, core):
        return None
    core = core or ensure_platform_workspaces(user)['core']
    membership = WorkspaceMembership.objects.filter(workspace=core, user=user).first()
    return membership.role if membership else None


def install_runtime():
    """Install V3 workspace resolution before URL modules capture V2 helpers."""
    from . import platform_api
    from . import operating_api

    platform_api.ensure_dual_workspaces = ensure_platform_workspaces

    def operating_core_workspace(request, payload=None):
        if not request.user.is_authenticated:
            return None
        spaces = ensure_platform_workspaces(request.user)
        core = spaces['core']
        if not core_access(request.user, core):
            return None
        raw = (payload or {}).get('workspace_id') or request.GET.get('workspace_id')
        if raw:
            try:
                if int(raw) != core.pk:
                    return None
            except (TypeError, ValueError):
                return None
        return core

    operating_api._workspace = operating_core_workspace


@require_http_methods(['GET'])
def platform_bootstrap_v3(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)

    from .platform_api import _project_json, _workspace_json, _json_date

    spaces = ensure_platform_workspaces(request.user)
    core = spaces['core']
    research = spaces['research']
    profile = community_profile(request.user)

    has_dashboard = module_access(request.user, ModuleGrant.Module.DASHBOARD)
    has_lms = module_access(request.user, ModuleGrant.Module.LMS)
    has_research = module_access(request.user, ModuleGrant.Module.RESEARCH)
    has_core = core_access(request.user, core)

    task_qs = OperatingTask.objects.filter(workspace=core, owner=request.user).exclude(status__in=['done', 'archived']) if has_core else OperatingTask.objects.none()
    my_tasks = list(task_qs.select_related('initiative')[:8])

    # Bootstrap is the navigation/access contract for every workspace route.
    # Optional dashboard summaries must never make that contract unavailable.
    # Older accounts can contain legacy project/request rows that need repair;
    # log those rows for operators, but still return workspaces and layer
    # entitlements so the user can navigate to the dedicated Research APIs.
    bootstrap_warnings = []
    if has_research:
        try:
            research_qs = ResearchProject.objects.filter(workspace=research, archived=False).select_related('owner', 'workspace')
            visible_research = [item for item in research_qs if can_view(request.user, item)]
            my_research = [item for item in visible_research if item.owner_id == request.user.pk or item.memberships.filter(user=request.user).exists()][:8]
            visible_requests = [
                item for item in ResearchRequest.objects.filter(
                    Q(project__workspace=research) | Q(requested_by=request.user) | Q(assignee=request.user)
                ).select_related('project', 'assignee')[:100]
                if can_view(request.user, item)
            ]
        except Exception:
            logger.exception('Research bootstrap summary failed for user_id=%s', request.user.pk)
            visible_research = []
            my_research = []
            visible_requests = []
            bootstrap_warnings.append('research_summary_unavailable')
    else:
        visible_research = []
        my_research = []
        visible_requests = []

    access = {
        'dashboard': has_dashboard,
        'lms': has_lms,
        'research': has_research,
        'core': has_core,
        'core_role': core_role(request.user, core),
        'community_role': profile.role if profile else 'member',
        'community_status': profile.status if profile else 'active',
        'levels': {
            module: module_access_level(request.user, module)
            for module in ModuleGrant.Module.values
        },
    }

    return JsonResponse({
        'ok': True,
        'access': access,
        'layers': {
            '1': {'id': 'shell', 'name': 'Shell / Showcase', 'enabled': True},
            '2': {'id': 'dashboard', 'name': 'Member Dashboard', 'enabled': has_dashboard},
            '3': {'id': 'lms', 'name': 'LMS', 'enabled': has_lms},
            '4': {'id': 'research', 'name': 'Research Workspace', 'enabled': has_research},
            '5': {'id': 'core', 'name': 'Core Workspace', 'enabled': has_core},
        },
        'workspaces': {key: _workspace_json(value) for key, value in spaces.items()},
        'my_work': {
            'task_count': task_qs.count() if has_core else 0,
            'research_count': len(my_research),
            'tasks': [{
                'id': item.pk,
                'title': item.title,
                'status': item.status,
                'priority': item.priority,
                'due_date': _json_date(item.due_date),
                'initiative': item.initiative.title if item.initiative else '',
            } for item in my_tasks],
            'research': [_project_json(item, request.user) for item in my_research],
        },
        'counts': {
            'core_content': core.content_work_items.exclude(status='archived').count() if has_core else 0,
            'core_tasks': core.operating_tasks.exclude(status__in=['done', 'archived']).count() if has_core else 0,
            'research_projects': len(visible_research),
            'open_research_requests': sum(1 for item in visible_requests if item.status not in {'done', 'cancelled'}),
        },
        'warnings': bootstrap_warnings,
    })


def _core_denied():
    return JsonResponse({'ok': False, 'error': 'core_workspace_for_internal_team_only'}, status=403)


def _research_denied():
    return JsonResponse({'ok': False, 'error': 'research_access_required'}, status=403)


def platform_dashboard_v3(request):
    from .platform_dashboard_api import platform_dashboard
    purpose = request.GET.get('workspace', 'core').strip().lower()
    spaces = ensure_platform_workspaces(request.user) if request.user.is_authenticated else None
    if purpose == 'core' and (not spaces or not core_access(request.user, spaces['core'])):
        return _core_denied()
    if purpose == 'research':
        if not request.user.is_authenticated:
            return _research_denied()
        # Core owner/admin may inspect the Research dashboard as the Layer 5
        # control plane without receiving a Research participant entitlement.
        # Object/project ACLs remain final for any detail request.
        research_allowed = module_access(request.user, ModuleGrant.Module.RESEARCH)
        core_control_plane = bool(spaces and core_access(request.user, spaces['core']))
        if not research_allowed and not core_control_plane:
            return _research_denied()
    return platform_dashboard(request)


def content_work_items_v3(request):
    from .platform_api import content_work_items
    if not request.user.is_authenticated:
        return content_work_items(request)
    spaces = ensure_platform_workspaces(request.user)
    if not core_access(request.user, spaces['core']):
        return _core_denied()
    return content_work_items(request)


def content_work_detail_v3(request, item_id):
    from .platform_api import content_work_detail
    if not request.user.is_authenticated:
        return content_work_detail(request, item_id)
    spaces = ensure_platform_workspaces(request.user)
    if not core_access(request.user, spaces['core']):
        return _core_denied()
    return content_work_detail(request, item_id)