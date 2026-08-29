import json

from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

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
    """Return the one shared Core and Research platform, plus the user's private scope.

    V2 originally provisioned a new organization/Core/Research trio for every user.
    V3 makes Core an explicit internal-team membership and keeps Research as the
    shared collaboration context. Private notes/files remain a scope, not a third
    workspace in navigation.
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

    # Only the user who bootstraps a brand-new platform becomes an internal member.
    # Existing/new researchers are never auto-enrolled into Core.
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

    # Research deliberately has no broad WorkspaceMembership. Project/object ACLs
    # decide what each researcher sees. The signal also removes legacy memberships.
    WorkspaceMembership.objects.filter(workspace=research).delete()
    return {'personal': personal, 'core': core, 'research': research}


def core_access(user, core=None):
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if getattr(user, 'is_superuser', False):
        return True
    core = core or ensure_platform_workspaces(user)['core']
    return WorkspaceMembership.objects.filter(workspace=core, user=user).exists()


def core_role(user, core=None):
    if getattr(user, 'is_superuser', False):
        return 'admin'
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
    has_core = core_access(request.user, core)

    task_qs = OperatingTask.objects.filter(workspace=core, owner=request.user).exclude(status__in=['done', 'archived']) if has_core else OperatingTask.objects.none()
    my_tasks = list(task_qs.select_related('initiative')[:8])

    research_qs = ResearchProject.objects.filter(workspace=research, archived=False).select_related('owner', 'workspace')
    visible_research = [item for item in research_qs if can_view(request.user, item)]
    my_research = [item for item in visible_research if item.owner_id == request.user.pk or item.memberships.filter(user=request.user).exists()][:8]

    visible_requests = [
        item for item in ResearchRequest.objects.filter(
            Q(project__workspace=research) | Q(requested_by=request.user) | Q(assignee=request.user)
        ).select_related('project', 'assignee')[:100]
        if can_view(request.user, item)
    ]

    return JsonResponse({
        'ok': True,
        'access': {
            'core': has_core,
            'core_role': core_role(request.user, core),
            'research': True,
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
    })


def _core_denied():
    return JsonResponse({'ok': False, 'error': 'core_workspace_for_internal_team_only'}, status=403)


def platform_dashboard_v3(request):
    from .platform_dashboard_api import platform_dashboard
    purpose = request.GET.get('workspace', 'core').strip().lower()
    spaces = ensure_platform_workspaces(request.user) if request.user.is_authenticated else None
    if purpose == 'core' and (not spaces or not core_access(request.user, spaces['core'])):
        return _core_denied()
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
