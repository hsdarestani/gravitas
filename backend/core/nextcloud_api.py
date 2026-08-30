import json
import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from . import cloud, nextcloud_bridge
from .models import Collection, KnowledgeResource, ProjectMembership, ResearchProject
from .platform_access import (
    INHERIT_VISIBILITY,
    VALID_VISIBILITIES,
    can_edit,
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

logger = logging.getLogger(__name__)

NEXTCLOUD_APPS = [
    {'id': 'files', 'name': 'Files', 'category': 'storage', 'core': True},
    {'id': 'groupfolders', 'name': 'Team Folders', 'category': 'collaboration', 'core': True},
    {'id': 'calendar', 'name': 'Calendar', 'category': 'planning', 'core': True},
    {'id': 'contacts', 'name': 'Contacts', 'category': 'people', 'core': True},
    {'id': 'tasks', 'name': 'Tasks', 'category': 'planning', 'core': True},
    {'id': 'deck', 'name': 'Deck', 'category': 'planning', 'core': True},
    {'id': 'notes', 'name': 'Notes', 'category': 'knowledge', 'core': True},
    {'id': 'collectives', 'name': 'Collectives', 'category': 'knowledge', 'core': True},
    {'id': 'tables', 'name': 'Tables', 'category': 'data', 'core': True},
    {'id': 'forms', 'name': 'Forms', 'category': 'data', 'core': True},
    {'id': 'spreed', 'name': 'Talk', 'category': 'communication', 'core': True},
]


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _auth(request):
    return _error('authentication_required', 401) if not request.user.is_authenticated else None


def _project_for_user(request, project_id, minimum='view'):
    project = ResearchProject.objects.select_related('workspace', 'owner').filter(pk=project_id, archived=False).first()
    checker = {'view': can_view, 'edit': can_edit, 'manage': can_manage}[minimum]
    return project if project and checker(request.user, project) else None


def _collection_json(item, user):
    policy = policy_for(item)
    return {
        'id': item.pk,
        'project_id': item.project_id,
        'parent_id': item.parent_id,
        'name': item.name,
        'visibility': policy.visibility if policy else INHERIT_VISIBILITY,
        'inherited_from': inherited_from(item),
        'permissions': {
            'role': effective_role(user, item),
            'can_view': can_view(user, item),
            'can_edit': can_edit(user, item),
            'can_manage': can_manage(user, item),
        },
        'native_url': nextcloud_bridge.native_url_for(item) if item.project_id else None,
    }


def _project_from_object(obj):
    if isinstance(obj, ResearchProject):
        return obj
    return getattr(obj, 'project', None) or getattr(obj, 'research_project', None)


def _sync_acl(obj):
    try:
        return nextcloud_bridge.sync_object_acl(obj)
    except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
        logger.exception('Nextcloud ACL sync failed for %s:%s', obj.__class__.__name__, obj.pk)
        raise


def _project_member(project, user):
    return bool(project and (project.owner_id == user.pk or ProjectMembership.objects.filter(project=project, user=user).exists()))


@require_http_methods(['GET'])
def nextcloud_status(request):
    if response := _auth(request):
        return response
    projects = ResearchProject.objects.filter(archived=False).select_related('owner')
    visible = [project for project in projects if can_view(request.user, project)]
    identity = getattr(request.user, 'gravitas_nextcloud', None)
    return JsonResponse({
        'ok': True,
        'nextcloud': {
            'url': cloud.native_files_url().split('/index.php/')[0] + '/',
            'files_url': cloud.native_files_url(),
            'identity_ready': bool(identity),
            'username': identity.username if identity else None,
            'client_server': cloud.native_files_url().split('/index.php/')[0],
            'apps': NEXTCLOUD_APPS,
        },
        'projects': [{
            'id': project.pk,
            'title': project.title,
            'mount_point': cloud.project_mountpoint(project),
            'native_url': cloud.native_files_url(cloud.project_mountpoint(project)),
            'can_manage': can_manage(request.user, project),
        } for project in visible[:200]],
    })


@require_http_methods(['POST'])
def nextcloud_client_credentials(request):
    if response := _auth(request):
        return response
    try:
        credentials = nextcloud_bridge.create_native_client_credentials(request.user)
    except cloud.CloudError:
        logger.exception('Could not create Nextcloud app password for user %s', request.user.pk)
        return _error('nextcloud_client_connection_failed', 503)
    return JsonResponse({'ok': True, 'credentials': credentials})


@require_http_methods(['POST'])
def project_nextcloud_sync(request, project_id):
    if response := _auth(request):
        return response
    project = _project_for_user(request, project_id, 'view')
    if not project:
        return _error('not_found', 404)
    try:
        team = nextcloud_bridge.ensure_project_space(project)
        # Reconcile every folder/resource ACL so native clients and Gravitas
        # converge even after an interrupted deployment or membership update.
        for folder in project.collections.select_related('parent'):
            if can_view(request.user, folder) or can_manage(request.user, project):
                nextcloud_bridge.sync_collection_acl(folder)
        for resource in project.resources.select_related('collection'):
            if resource.storage_path:
                nextcloud_bridge.sync_resource_acl(resource)
    except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
        logger.exception('Could not reconcile Nextcloud project %s', project.pk)
        return _error('cloud_sync_failed', 503)
    return JsonResponse({'ok': True, 'team_folder': team})


@require_http_methods(['GET', 'POST'])
def project_folders(request, project_id):
    if response := _auth(request):
        return response
    project = _project_for_user(request, project_id, 'view')
    if not project:
        return _error('not_found', 404)
    if request.method == 'GET':
        folders = project.collections.select_related('parent', 'workspace').order_by('parent_id', 'name')
        visible = [folder for folder in folders if can_view(request.user, folder)]
        return JsonResponse({
            'ok': True,
            'native_url': cloud.native_files_url(cloud.project_mountpoint(project)),
            'items': [_collection_json(folder, request.user) for folder in visible],
        })
    if not can_edit(request.user, project):
        return _error('permission_denied', 403)
    data = _body(request)
    name = cloud.safe_filename(data.get('name'))
    parent = None
    if data.get('parent_id'):
        parent = project.collections.filter(pk=data['parent_id']).first()
        if not parent or not can_view(request.user, parent):
            return _error('invalid_parent')
    if project.collections.filter(parent=parent, name__iexact=name).exists():
        return _error('folder_exists', 409)
    visibility = str(data.get('visibility') or INHERIT_VISIBILITY).strip()
    if visibility not in VALID_VISIBILITIES:
        return _error('invalid_visibility')
    with transaction.atomic():
        folder = Collection.objects.create(
            workspace=project.workspace,
            project=project,
            parent=parent,
            name=name,
            created_by=request.user,
        )
        policy = policy_for(folder, create=True, created_by=request.user, default_visibility=visibility)
        policy.visibility = visibility
        policy.allow_download = data.get('allow_download') is not False
        policy.allow_reshare = bool(data.get('allow_reshare'))
        policy.save()
    try:
        nextcloud_bridge.sync_collection_acl(folder)
    except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
        folder.delete()
        return _error('cloud_sync_failed', 503)
    _audit(project, request.user, 'folder_created', folder, visibility=visibility)
    return JsonResponse({'ok': True, 'item': _collection_json(folder, request.user)}, status=201)


@require_http_methods(['GET'])
def project_folder_detail(request, project_id, collection_id):
    if response := _auth(request):
        return response
    project = _project_for_user(request, project_id, 'view')
    folder = project.collections.select_related('parent', 'workspace').filter(pk=collection_id).first() if project else None
    if not folder or not can_view(request.user, folder):
        return _error('not_found', 404)
    return JsonResponse({'ok': True, 'item': _collection_json(folder, request.user)})


@require_http_methods(['GET', 'POST', 'DELETE'])
def sharing_v4(request):
    if response := _auth(request):
        return response
    target_type = request.GET.get('type') if request.method == 'GET' else None
    object_id = request.GET.get('id') if request.method == 'GET' else None
    data = _body(request) if request.method != 'GET' else {}
    target_type = target_type or data.get('type')
    object_id = object_id or data.get('id')
    obj = resolve_target(target_type, object_id)
    if not obj or not can_view(request.user, obj):
        return _error('not_found', 404)
    ct = content_type_for(obj)
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
            'permissions': {'role': effective_role(request.user, obj), 'can_manage': can_manage(request.user, obj)},
        }
        if can_manage(request.user, obj):
            result['grants'] = [{
                'id': grant.pk,
                'user_id': grant.user_id,
                'name': grant.user.get_full_name() or grant.user.first_name or grant.user.email,
                'email': grant.user.email,
                'role': grant.role,
                'expires_at': grant.expires_at.isoformat() if grant.expires_at else None,
            } for grant in AccessGrant.objects.filter(content_type=ct, object_id=obj.pk).select_related('user')]
            result['links'] = [{
                'id': link.pk,
                'token': str(link.token),
                'role': link.role,
                'allow_download': link.allow_download,
                'active': link.active,
                'expires_at': link.expires_at.isoformat() if link.expires_at else None,
                'url': f'/shared/{link.token}',
            } for link in ShareLink.objects.filter(content_type=ct, object_id=obj.pk)]
        project = _project_from_object(obj)
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
        if visibility in {'link', 'public'} and not link_allowed_for_project(obj):
            return _error('secure_data_room_blocks_public_sharing', 409)
        policy = policy_for(obj, create=True, created_by=request.user)
        policy.visibility = visibility
        if 'allow_download' in data:
            policy.allow_download = bool(data['allow_download'])
        if 'allow_reshare' in data:
            policy.allow_reshare = bool(data['allow_reshare'])
        policy.save()
        try:
            _sync_acl(obj)
        except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
            return _error('cloud_acl_sync_failed', 503)
        _audit(_project_from_object(obj), request.user, 'sharing_policy_updated', obj, visibility=visibility)
        return JsonResponse({'ok': True})

    if action == 'grant':
        email = str(data.get('email', '')).strip().lower()
        role = str(data.get('role', 'view')).strip()
        user = get_user_model().objects.filter(email__iexact=email).first()
        if not user:
            return _error('user_not_found', 404)
        project = _project_from_object(obj)
        if project and not isinstance(obj, ResearchProject) and not _project_member(project, user):
            return _error('project_membership_required', 409)
        try:
            expires_at = _parse_datetime(data.get('expires_at'))
            grant = grant_role(obj, user, role, granted_by=request.user, expires_at=expires_at)
        except ValueError as exc:
            return _error(str(exc))
        if isinstance(obj, ResearchProject):
            project_role = {'manage': 'owner', 'edit': 'editor', 'comment': 'viewer', 'view': 'viewer'}[role]
            ProjectMembership.objects.update_or_create(project=obj, user=user, defaults={'role': project_role})
            try:
                nextcloud_bridge.add_project_user(obj, user)
            except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
                AccessGrant.objects.filter(pk=grant.pk).delete()
                ProjectMembership.objects.filter(project=obj, user=user).exclude(user=obj.owner).delete()
                return _error('cloud_membership_sync_failed', 503)
        else:
            try:
                _sync_acl(obj)
            except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
                AccessGrant.objects.filter(pk=grant.pk).delete()
                return _error('cloud_acl_sync_failed', 503)
        _audit(project, request.user, 'access_granted', obj, user_id=user.pk, role=role)
        return JsonResponse({'ok': True, 'grant': {'id': grant.pk, 'user_id': user.pk, 'email': user.email, 'role': grant.role}}, status=201)

    if action == 'link':
        if not link_allowed_for_project(obj):
            return _error('secure_data_room_blocks_public_sharing', 409)
        role = str(data.get('role', 'view'))
        if role not in {'view', 'comment'}:
            return _error('invalid_link_role')
        try:
            expires_at = _parse_datetime(data.get('expires_at'))
        except ValueError as exc:
            return _error(str(exc))
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
        _audit(_project_from_object(obj), request.user, 'share_link_created', obj, link_id=link.pk)
        return JsonResponse({'ok': True, 'link': {'id': link.pk, 'token': str(link.token), 'url': f'/shared/{link.token}'}}, status=201)

    if action == 'revoke':
        grant = None
        if data.get('grant_id'):
            grant = AccessGrant.objects.filter(pk=data['grant_id'], content_type=ct, object_id=obj.pk).select_related('user').first()
            if grant:
                grant.delete()
        if data.get('link_id'):
            ShareLink.objects.filter(pk=data['link_id'], content_type=ct, object_id=obj.pk).update(active=False)
        if isinstance(obj, ResearchProject) and grant and grant.user_id != obj.owner_id:
            ProjectMembership.objects.filter(project=obj, user=grant.user).delete()
            try:
                nextcloud_bridge.remove_project_user(obj, grant.user)
            except cloud.CloudError:
                logger.exception('Could not remove user %s from Nextcloud project group', grant.user_id)
                return _error('cloud_membership_sync_failed', 503)
        elif not isinstance(obj, ResearchProject):
            try:
                _sync_acl(obj)
            except (cloud.CloudError, nextcloud_bridge.NextcloudBridgeError):
                return _error('cloud_acl_sync_failed', 503)
        return JsonResponse({'ok': True})

    return _error('invalid_action')
