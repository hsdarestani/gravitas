import json

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import cloud, nextcloud_bridge
from .models import ProjectMembership, ResearchProject
from .nextcloud_api import project_nextcloud_sync as base_project_nextcloud_sync
from .platform_access import ROLE_RANK, can_manage, can_view, content_type_for, grant_role
from .platform_api import _audit, ensure_dual_workspaces
from .platform_models import AccessGrant, ProjectApplication, ResearchRequest
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


def _workspace_id_is_valid(user, raw):
    if raw in (None, ''):
        return True
    spaces = ensure_dual_workspaces(user)
    return any(str(workspace.pk) == str(raw).strip() for workspace in spaces.values())


def _grant_project_editor(project, user, granted_by):
    """Ensure one Research collaborator can actually work in both systems.

    Gravitas project ACL and the native Nextcloud Team Folder are one access
    contract. Older call sites sometimes created only an AccessGrant, or only
    a ProjectMembership, which made the UI say someone had access while the
    data room still rejected them. Preserve stronger existing roles and make
    the native membership part of the same transaction boundary.
    """
    if user.pk == project.owner_id:
        nextcloud_bridge.add_project_user(project, user)
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

    nextcloud_bridge.add_project_user(project, user)


@require_http_methods(['GET', 'POST'])
def platform_resources_strict(request):
    """Reject an explicitly invalid workspace instead of falling back personal.

    The legacy resolver intentionally defaults a missing workspace to Personal.
    It also treated an *unknown supplied id* as if it were missing, which can
    silently put a Research/Core note in the user's private space. Missing and
    invalid are different states; only the former may default.
    """
    if response := _auth(request):
        return response
    if request.method == 'POST':
        data = _body(request)
        if not _workspace_id_is_valid(request.user, data.get('workspace_id')):
            return _error('workspace_not_found', 404)
    return base_platform_resources(request)


@require_http_methods(['POST'])
def platform_file_upload_strict(request):
    if response := _auth(request):
        return response
    if not _workspace_id_is_valid(request.user, request.POST.get('workspace_id')):
        return _error('workspace_not_found', 404)
    return base_platform_file_upload(request)


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


@require_http_methods(['GET', 'PATCH'])
def research_request_detail_synced(request, request_id):
    if response := _auth(request):
        return response
    item = ResearchRequest.objects.select_related('project', 'assignee', 'content_work_item').filter(pk=request_id).first()
    if not item or not can_view(request.user, item):
        return _error('not_found', 404)

    # Delegate reads to the canonical serializer in the existing API.
    if request.method == 'GET':
        from .platform_api import research_request_detail
        return research_request_detail(request, request_id)

    from .platform_access import can_edit
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

    from .platform_api import _request_json
    return JsonResponse({'ok': True, 'item': _request_json(item)})


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
