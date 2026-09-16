import json
import logging

from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from . import cloud, nextcloud_bridge
from .layer_access import module_access, object_product_layer
from .layer_models import ModuleGrant
from .models import ProjectMembership, ResearchProject
from .platform_access import (
    INHERIT_VISIBILITY,
    VALID_VISIBILITIES,
    can_manage,
    can_view,
    content_type_for,
    effective_role,
    grant_role,
    inherited_from,
    link_allowed_for_project,
    policy_for,
    resolve_target,
)
from .platform_api import _audit, _parse_datetime
from .platform_models import AccessGrant, ObjectPolicy, ShareLink
from .platform_runtime_v3 import core_access, ensure_platform_workspaces

logger = logging.getLogger(__name__)


def _body(request):
    try:
        data = json.loads(request.body.decode('utf-8') or '{}')
    except (TypeError, ValueError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _error(code, status=400):
    return JsonResponse({'ok': False, 'error': code}, status=status)


def _project_from_object(obj):
    if isinstance(obj, ResearchProject):
        return obj
    return getattr(obj, 'project', None) or getattr(obj, 'research_project', None)


def _workspace_from_object(obj):
    if hasattr(obj, 'workspace_id'):
        return getattr(obj, 'workspace', None)
    project = _project_from_object(obj)
    return getattr(project, 'workspace', None) if project else None


def _layer_error(user, obj):
    spaces = ensure_platform_workspaces(user)
    project = _project_from_object(obj)
    if project is not None:
        if not module_access(user, ModuleGrant.Module.RESEARCH) and not core_access(user, spaces['core']):
            return _error('research_access_required', 403)
        return None
    workspace = _workspace_from_object(obj)
    if workspace and workspace.pk == spaces['core'].pk and not core_access(user, spaces['core']):
        return _error('core_workspace_for_internal_team_only', 403)
    if workspace and workspace.pk == spaces['research'].pk:
        if not module_access(user, ModuleGrant.Module.RESEARCH) and not core_access(user, spaces['core']):
            return _error('research_access_required', 403)
    return None


def _sync_acl(obj):
    return nextcloud_bridge.sync_object_acl(obj)


def _native_add(project, user):
    try:
        return nextcloud_bridge.add_project_user(project, user)
    except ImproperlyConfigured:
        return None


def _native_remove(project, user):
    try:
        return nextcloud_bridge.remove_project_user(project, user)
    except ImproperlyConfigured:
        return None


def _sync_optional(obj):
    try:
        return _sync_acl(obj)
    except ImproperlyConfigured:
        return None


def _project_member(project, user):
    return bool(
        project
        and (
            project.owner_id == user.pk
            or ProjectMembership.objects.filter(project=project, user=user).exists()
        )
    )


def _grant_json(grant):
    return {
        'id': grant.pk,
        'user_id': grant.user_id,
        'name': grant.user.get_full_name() or grant.user.first_name or grant.user.email,
        'email': grant.user.email,
        'role': grant.role,
        'expires_at': grant.expires_at.isoformat() if grant.expires_at else None,
    }


def _link_json(link):
    return {
        'id': link.pk,
        'token': str(link.token),
        'role': link.role,
        'allow_download': link.allow_download,
        'active': link.active,
        'expires_at': link.expires_at.isoformat() if link.expires_at else None,
        'url': f'/shared/{link.token}',
    }


@require_http_methods(['GET', 'POST', 'DELETE'])
def sharing_v5(request):
    """One transaction boundary for Gravitas sharing and native collaboration.

    AccessGrant/ObjectPolicy/ProjectMembership and Nextcloud ACL/group state are
    one user-visible contract. The legacy endpoint mutated database rows before
    native sync and manually deleted rows on failure, which destroyed existing
    grants/memberships and could leave revocations half-applied. This endpoint
    lets database changes roll back when a configured native integration fails.
    """
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)

    data = _body(request) if request.method != 'GET' else {}
    target_type = request.GET.get('type') if request.method == 'GET' else data.get('type')
    object_id = request.GET.get('id') if request.method == 'GET' else data.get('id')
    obj = resolve_target(target_type, object_id)
    if not obj or not can_view(request.user, obj):
        return _error('not_found', 404)
    if error := _layer_error(request.user, obj):
        return error

    ct = content_type_for(obj)
    project = _project_from_object(obj)
    product_layer = object_product_layer(obj)

    if request.method == 'GET':
        policy = policy_for(obj, create=True, created_by=request.user)
        result = {
            'ok': True,
            'type': target_type,
            'id': obj.pk,
            'policy': {
                'visibility': policy.visibility,
                'allow_download': policy.allow_download,
                'allow_reshare': policy.allow_reshare,
                'inherited_from': inherited_from(obj),
            },
            'permissions': {
                'role': effective_role(request.user, obj),
                'can_manage': can_manage(request.user, obj),
            },
        }
        if can_manage(request.user, obj):
            now = timezone.now()
            grants = AccessGrant.objects.filter(
                content_type=ct,
                object_id=obj.pk,
            ).filter(
                Q(expires_at__isnull=True) | Q(expires_at__gt=now)
            ).select_related('user')
            result['grants'] = [_grant_json(grant) for grant in grants]
            result['links'] = [
                _link_json(link)
                for link in ShareLink.objects.filter(content_type=ct, object_id=obj.pk)
            ]
        if project:
            result['native_url'] = nextcloud_bridge.native_url_for(obj)
        return JsonResponse(result)

    if not can_manage(request.user, obj):
        return _error('permission_denied', 403)

    action = str(data.get('action', '')).strip()
    if request.method == 'DELETE':
        action = action or 'revoke'

    if action == 'policy':
        visibility = str(data.get('visibility', INHERIT_VISIBILITY)).strip()
        if visibility not in VALID_VISIBILITIES:
            return _error('invalid_visibility')
        if isinstance(obj, ResearchProject) and visibility == INHERIT_VISIBILITY:
            return _error('project_cannot_inherit')
        if product_layer == ModuleGrant.Module.CORE and visibility in {'link', 'public'}:
            # Layer 5 is an internal control plane. ObjectPolicy must never turn
            # a Core-only note/task/workspace into an unauthenticated surface.
            return _error('core_objects_cannot_be_public', 409)
        if visibility in {'link', 'public'} and not link_allowed_for_project(obj):
            return _error('secure_data_room_blocks_public_sharing', 409)
        try:
            with transaction.atomic():
                policy = policy_for(obj, create=True, created_by=request.user)
                policy.visibility = visibility
                if 'allow_download' in data:
                    policy.allow_download = bool(data['allow_download'])
                if 'allow_reshare' in data:
                    policy.allow_reshare = bool(data['allow_reshare'])
                policy.save()
                _sync_optional(obj)
        except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
            logger.exception('Could not synchronize sharing policy for %s:%s', obj.__class__.__name__, obj.pk)
            return _error('cloud_acl_sync_failed', 503)
        _audit(project, request.user, 'sharing_policy_updated', obj, visibility=visibility)
        return JsonResponse({'ok': True})

    if action == 'grant':
        email = str(data.get('email', '')).strip().lower()
        role = str(data.get('role', 'view')).strip()
        if role not in {'view', 'comment', 'edit', 'manage'}:
            return _error('invalid_role')
        user = get_user_model().objects.filter(email__iexact=email, is_active=True).first()
        if not user:
            return _error('user_not_found', 404)
        if product_layer == ModuleGrant.Module.CORE and not module_access(user, ModuleGrant.Module.CORE):
            # A direct ACL grant is not a substitute for internal Core team
            # membership. Otherwise can_view() could make a stale shared-service
            # endpoint appear to grant Layer 5 access without the control-plane
            # entitlement ever being enabled.
            return _error('core_membership_required', 409)
        try:
            expires_at = _parse_datetime(data.get('expires_at'))
        except ValueError as exc:
            return _error(str(exc))

        if isinstance(obj, ResearchProject) and expires_at is not None:
            # ProjectMembership and native Team Folder membership have no
            # expiry column/scheduler. Accepting a timestamp here would present
            # temporary access in the API while actually granting it forever.
            return _error('project_access_expiry_not_supported', 409)
        if project and not isinstance(obj, ResearchProject) and not _project_member(project, user):
            return _error('project_membership_required', 409)

        try:
            with transaction.atomic():
                grant = grant_role(obj, user, role, granted_by=request.user, expires_at=expires_at)
                if isinstance(obj, ResearchProject):
                    project_role = {
                        'manage': ProjectMembership.Role.OWNER,
                        'edit': ProjectMembership.Role.EDITOR,
                        'comment': ProjectMembership.Role.VIEWER,
                        'view': ProjectMembership.Role.VIEWER,
                    }[role]
                    if user.pk != obj.owner_id:
                        ProjectMembership.objects.update_or_create(
                            project=obj,
                            user=user,
                            defaults={'role': project_role},
                        )
                    _native_add(obj, user)
                else:
                    _sync_optional(obj)
        except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
            logger.exception('Could not synchronize access grant for %s:%s', obj.__class__.__name__, obj.pk)
            return _error('cloud_membership_sync_failed' if isinstance(obj, ResearchProject) else 'cloud_acl_sync_failed', 503)

        _audit(project, request.user, 'access_granted', obj, user_id=user.pk, role=role)
        return JsonResponse({
            'ok': True,
            'grant': {'id': grant.pk, 'user_id': user.pk, 'email': user.email, 'role': grant.role},
        }, status=201)

    if action == 'link':
        if product_layer == ModuleGrant.Module.CORE:
            return _error('core_objects_cannot_be_public', 409)
        if not link_allowed_for_project(obj):
            return _error('secure_data_room_blocks_public_sharing', 409)
        role = str(data.get('role', 'view')).strip()
        if role not in {'view', 'comment'}:
            return _error('invalid_link_role')
        try:
            expires_at = _parse_datetime(data.get('expires_at'))
        except ValueError as exc:
            return _error(str(exc))

        try:
            with transaction.atomic():
                link = ShareLink.objects.create(
                    content_type=ct,
                    object_id=obj.pk,
                    role=role,
                    allow_download=bool(data.get('allow_download')),
                    expires_at=expires_at,
                    created_by=request.user,
                )
                policy = policy_for(obj, create=True, created_by=request.user)
                if policy.visibility not in {ObjectPolicy.Visibility.PUBLIC, ObjectPolicy.Visibility.LINK}:
                    policy.visibility = ObjectPolicy.Visibility.LINK
                    policy.save(update_fields=['visibility', 'updated_at'])
                    # A restricted native object becoming LINK-visible must have
                    # its native ACL reconciled too; otherwise web and native
                    # clients disagree about project-member access.
                    _sync_optional(obj)
        except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
            logger.exception('Could not synchronize link policy for %s:%s', obj.__class__.__name__, obj.pk)
            return _error('cloud_acl_sync_failed', 503)

        _audit(project, request.user, 'share_link_created', obj, link_id=link.pk)
        return JsonResponse({'ok': True, 'link': {'id': link.pk, 'token': str(link.token), 'url': f'/shared/{link.token}'}}, status=201)

    if action == 'revoke':
        try:
            with transaction.atomic():
                grant = None
                if data.get('grant_id'):
                    grant = AccessGrant.objects.select_for_update().filter(
                        pk=data['grant_id'],
                        content_type=ct,
                        object_id=obj.pk,
                    ).select_related('user').first()
                    if grant:
                        user = grant.user
                        grant.delete()
                        if isinstance(obj, ResearchProject) and user.pk != obj.owner_id:
                            ProjectMembership.objects.filter(project=obj, user=user).delete()
                            _native_remove(obj, user)
                        elif not isinstance(obj, ResearchProject):
                            _sync_optional(obj)
                if data.get('link_id'):
                    ShareLink.objects.filter(
                        pk=data['link_id'],
                        content_type=ct,
                        object_id=obj.pk,
                    ).update(active=False)
        except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
            logger.exception('Could not synchronize access revocation for %s:%s', obj.__class__.__name__, obj.pk)
            return _error('cloud_membership_sync_failed' if isinstance(obj, ResearchProject) else 'cloud_acl_sync_failed', 503)
        return JsonResponse({'ok': True})

    return _error('invalid_action')
