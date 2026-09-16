import json

from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import cloud, nextcloud_bridge
from .layer_access import module_access
from .layer_guards import require_research_or_core
from .layer_models import ModuleGrant
from .models import ProjectMembership, ResearchProject
from .platform_runtime_v3 import (
    core_access,
    ensure_platform_workspaces,
    install_runtime,
    platform_dashboard_v3 as base_platform_dashboard,
)

# This module is imported by the root URLconf before core.urls. Install the
# canonical five-layer runtime here first so modules imported below never
# capture the legacy ensure_dual_workspaces helper, which provisions per-user
# Core/Research workspaces and memberships.
install_runtime()

from .nextcloud_api import project_nextcloud_sync as base_project_nextcloud_sync
from .platform_access import (
    ROLE_RANK,
    can_edit,
    can_manage,
    can_view,
    content_type_for,
    grant_role,
    resolve_target,
)
from .platform_api import (
    _audit,
    _request_json,
    entity_links as base_entity_links,
    platform_project_detail as base_platform_project_detail,
)
from .platform_models import AccessGrant, EntityLink, ProjectApplication, ResearchRequest
from .platform_resources_api import (
    platform_file_upload as base_platform_file_upload,
    platform_resources as base_platform_resources,
)


def _body(request):
    try:
        data = json.loads(request.body.decode('utf-8') or '{}')
    except (TypeError, ValueError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _auth(request):
    return _error('authentication_required', 401) if not request.user.is_authenticated else None


def _workspace_context(user, raw):
    spaces = ensure_platform_workspaces(user)
    if raw in (None, ''):
        return spaces, None
    raw = str(raw).strip()
    key = next((name for name, workspace in spaces.items() if str(workspace.pk) == raw), None)
    return spaces, key


def _workspace_write_error(user, raw, *, project_id=None):
    """Validate an explicit write target without widening shared-service access."""
    spaces, key = _workspace_context(user, raw)
    if raw not in (None, '') and key is None:
        return _error('workspace_not_found', 404)

    if project_id not in (None, ''):
        if not module_access(user, ModuleGrant.Module.RESEARCH) and not core_access(user, spaces['core']):
            return _error('research_access_required', 403)

    if key == 'core' and not core_access(user, spaces['core']):
        return _error('core_workspace_for_internal_team_only', 403)
    if key == 'research':
        if not module_access(user, ModuleGrant.Module.RESEARCH) and not core_access(user, spaces['core']):
            return _error('research_access_required', 403)
    return None


def _add_native_project_user(project, user):
    """Mirror membership when Nextcloud is enabled; local-only installs stay usable.

    Test/development deployments intentionally leave the Nextcloud service
    credentials empty. That is a disabled integration, not a failed sync. Once
    credentials exist, transport/API failures still propagate and the caller's
    database transaction is rolled back.
    """
    try:
        nextcloud_bridge.add_project_user(project, user)
    except ImproperlyConfigured:
        return False
    return True


def _grant_project_editor(project, user, granted_by):
    """Ensure one Research collaborator can actually work in both systems."""
    if user.pk == project.owner_id:
        _add_native_project_user(project, user)
        return

    membership = ProjectMembership.objects.filter(project=project, user=user).first()
    if membership is None:
        ProjectMembership.objects.create(
            project=project,
            user=user,
            role=ProjectMembership.Role.EDITOR,
        )
    elif membership.role == ProjectMembership.Role.VIEWER:
        membership.role = ProjectMembership.Role.EDITOR
        membership.save(update_fields=['role'])

    ct = content_type_for(project)
    grant = AccessGrant.objects.filter(content_type=ct, object_id=project.pk, user=user).first()
    if not grant or ROLE_RANK.get(grant.role, 0) < ROLE_RANK['edit']:
        grant_role(project, user, 'edit', granted_by=granted_by)

    _add_native_project_user(project, user)


@require_http_methods(['GET'])
def platform_dashboard_acl_safe(request):
    """Keep Research dashboard summaries inside the same object ACL boundary."""
    purpose = request.GET.get('workspace', 'core').strip().lower()
    if purpose not in {'core', 'research'}:
        return _error('invalid_workspace')

    response = base_platform_dashboard(request)
    if response.status_code != 200 or purpose != 'research':
        return response

    data = json.loads(response.content.decode('utf-8'))
    spaces = ensure_platform_workspaces(request.user)
    qs = ResearchRequest.objects.filter(project__workspace=spaces['research']).select_related(
        'project', 'assignee', 'content_work_item'
    )
    visible = [item for item in qs if can_view(request.user, item)]
    data['research_requests'] = [_request_json(item) for item in visible[:12]]
    data.setdefault('counts', {})['research_requests'] = sum(
        1 for item in visible if item.status not in {'done', 'cancelled'}
    )
    return JsonResponse(data)


@require_research_or_core
@require_http_methods(['GET', 'PATCH', 'DELETE'])
def platform_project_detail_acl_safe(request, project_id):
    """Do not expose names of project folders the caller cannot view."""
    response = base_platform_project_detail(request, project_id)
    if request.method != 'GET' or response.status_code != 200:
        return response

    project = ResearchProject.objects.filter(pk=project_id, archived=False).first()
    if not project:
        return response
    data = json.loads(response.content.decode('utf-8'))
    data['folders'] = [
        {'id': item.pk, 'name': item.name, 'parent_id': item.parent_id}
        for item in project.collections.select_related('parent')
        if can_view(request.user, item)
    ]
    return JsonResponse(data)


@require_http_methods(['GET', 'POST'])
def platform_resources_strict(request):
    """Reject invalid selectors and product-layer write boundary bypasses."""
    if response := _auth(request):
        return response
    if request.method == 'GET':
        selector = request.GET.get('workspace', '').strip().lower()
        if selector and selector not in ensure_platform_workspaces(request.user):
            return _error('invalid_workspace')
    else:
        data = _body(request)
        if error := _workspace_write_error(
            request.user,
            data.get('workspace_id'),
            project_id=data.get('project_id'),
        ):
            return error
    return base_platform_resources(request)


@require_http_methods(['POST'])
def platform_file_upload_strict(request):
    if response := _auth(request):
        return response
    if error := _workspace_write_error(
        request.user,
        request.POST.get('workspace_id'),
        project_id=request.POST.get('project_id'),
    ):
        return error
    return base_platform_file_upload(request)


@require_http_methods(['GET', 'POST', 'DELETE'])
def entity_links_safe(request):
    """Delete GenericForeignKey links only when the exact pair matches."""
    if request.method != 'DELETE':
        return base_entity_links(request)
    if response := _auth(request):
        return response

    data = _body(request)
    source = resolve_target(data.get('source_type'), data.get('source_id'))
    target = resolve_target(data.get('target_type'), data.get('target_id'))
    if not source or not target or not can_edit(request.user, source) or not can_view(request.user, target):
        return _error('permission_denied', 403)

    source_ct = content_type_for(source)
    target_ct = content_type_for(target)
    pair = Q(
        source_content_type=source_ct,
        source_object_id=source.pk,
        target_content_type=target_ct,
        target_object_id=target.pk,
    ) | Q(
        source_content_type=target_ct,
        source_object_id=target.pk,
        target_content_type=source_ct,
        target_object_id=source.pk,
    )
    link = EntityLink.objects.filter(pk=data.get('link_id')).filter(pair).first()
    if not link:
        return _error('link_not_found', 404)
    link.delete()
    return JsonResponse({'ok': True})


@require_research_or_core
@require_http_methods(['POST'])
def project_nextcloud_sync_manage(request, project_id):
    """ACL reconciliation is a management mutation, not a read operation."""
    if response := _auth(request):
        return response
    project = ResearchProject.objects.select_related('owner').filter(pk=project_id, archived=False).first()
    if not project or not can_view(request.user, project):
        return _error('not_found', 404)
    if not can_manage(request.user, project):
        return _error('permission_denied', 403)
    return base_project_nextcloud_sync(request, project_id)


@require_research_or_core
@require_http_methods(['GET', 'PATCH'])
def research_request_detail_synced(request, request_id):
    if response := _auth(request):
        return response
    item = ResearchRequest.objects.select_related('project', 'assignee', 'content_work_item').filter(pk=request_id).first()
    if not item or not can_view(request.user, item):
        return _error('not_found', 404)

    if request.method == 'GET':
        from .platform_api import research_request_detail
        return research_request_detail(request, request_id)

    if not can_edit(request.user, item):
        return _error('permission_denied', 403)

    data = _body(request)
    assignee = item.assignee
    if 'assignee_id' in data:
        if data['assignee_id']:
            from django.contrib.auth import get_user_model
            assignee = get_user_model().objects.filter(pk=data['assignee_id'], is_active=True).first()
            if not assignee:
                return _error('assignee_not_found', 404)
        else:
            assignee = None

    from .platform_api import _parse_date
    due_date = item.due_date
    try:
        if 'due_date' in data:
            due_date = _parse_date(data['due_date'])
    except ValueError as exc:
        return _error(str(exc))

    try:
        with transaction.atomic():
            if assignee and item.project:
                _grant_project_editor(item.project, assignee, request.user)

            if 'status' in data and data['status'] in ResearchRequest.Status.values:
                item.status = data['status']
            if 'brief' in data:
                item.brief = str(data['brief']).strip()
            if 'output_summary' in data:
                item.output_summary = str(data['output_summary']).strip()
            if 'priority' in data:
                item.priority = str(data['priority'])[:8]
            if 'assignee_id' in data:
                item.assignee = assignee
            if 'due_date' in data:
                item.due_date = due_date

            item.save()
            _audit(item.project, request.user, 'research_request_updated', item, status=item.status)
    except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
        return _error('cloud_membership_sync_failed', 503)

    return JsonResponse({'ok': True, 'item': _request_json(item)})


@require_research_or_core
@require_http_methods(['PATCH'])
def project_application_detail_synced(request, project_id, application_id):
    if response := _auth(request):
        return response
    project = ResearchProject.objects.filter(pk=project_id, archived=False).first()
    if not project or not can_manage(request.user, project):
        return _error('permission_denied', 403)
    application = ProjectApplication.objects.select_related('applicant_user').filter(
        pk=application_id,
        project=project,
    ).first()
    if not application:
        return _error('not_found', 404)

    data = _body(request)
    status = str(data.get('status', '')).strip()
    if status not in ProjectApplication.Status.values:
        return _error('invalid_status')

    try:
        with transaction.atomic():
            application.status = status
            application.save(update_fields=['status', 'updated_at'])
            if status == ProjectApplication.Status.ACCEPTED and application.applicant_user:
                _grant_project_editor(project, application.applicant_user, request.user)
            _audit(project, request.user, 'application_updated', application, status=status)
    except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
        return _error('cloud_membership_sync_failed', 503)

    return JsonResponse({'ok': True, 'application': {'id': application.pk, 'status': application.status}})
