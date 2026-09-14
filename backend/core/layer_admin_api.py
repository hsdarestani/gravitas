import json

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_http_methods

from .layer_access import effective_modules, module_access, record_activity, set_module_grant
from .layer_models import ActivityEvent, CommunityProfile, ModuleGrant
from .lms_models import Course, CourseEnrollment
from .models import Comment, ContentItem, ResearchProject, WorkspaceMembership
from .platform_runtime_v3 import core_role, ensure_platform_workspaces


MAX_USERS = 250
MAX_EVENTS = 250


def _payload(request):
    try:
        return json.loads(request.body.decode('utf-8') or '{}')
    except (TypeError, ValueError, UnicodeDecodeError):
        return None


def _core_admin(request):
    if not request.user.is_authenticated:
        return False
    if request.user.is_superuser:
        return True
    spaces = ensure_platform_workspaces(request.user)
    return core_role(request.user, spaces['core']) in {'owner', 'admin'}


def _deny(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    return JsonResponse({'ok': False, 'error': 'core_admin_required'}, status=403)


def _iso(value):
    return value.isoformat() if value else None


def _profile(user):
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


def _core_membership(user):
    spaces = ensure_platform_workspaces(user)
    return WorkspaceMembership.objects.filter(workspace=spaces['core'], user=user).first()


def _module_json(user, module, resolved=None):
    resolved = resolved or effective_modules(user)
    grant = ModuleGrant.objects.filter(user=user, module=module).first()
    data = dict(resolved[module])
    data.update({
        'explicit': grant is not None,
        'configured_enabled': grant.enabled if grant else None,
        'source': grant.source if grant else None,
        'starts_at': _iso(grant.starts_at) if grant else None,
        'expires_at': _iso(grant.expires_at) if grant else None,
    })
    if module == ModuleGrant.Module.CORE:
        membership = _core_membership(user)
        data['workspace_role'] = membership.role if membership else None
    return data


def _user_json(user, *, include_modules=True):
    profile = _profile(user)
    data = {
        'id': user.pk,
        'email': user.email,
        'username': user.get_username(),
        'name': user.get_full_name() or user.get_username() or user.email,
        'account_active': user.is_active,
        'community_role': profile.role,
        'community_status': profile.status,
        'date_joined': _iso(getattr(user, 'date_joined', None)),
        'last_login': _iso(getattr(user, 'last_login', None)),
    }
    if include_modules:
        resolved = effective_modules(user)
        data['modules'] = {
            module: _module_json(user, module, resolved)
            for module in ModuleGrant.Module.values
        }
    return data


@require_http_methods(['GET'])
def platform_admin_overview(request):
    if not _core_admin(request):
        return _deny(request)
    User = get_user_model()
    by_role = {
        role: CommunityProfile.objects.filter(role=role).count()
        for role in CommunityProfile.Role.values
    }
    grants = {
        module: {
            'configured': ModuleGrant.objects.filter(module=module).count(),
            'enabled': ModuleGrant.objects.filter(module=module, enabled=True).count(),
        }
        for module in ModuleGrant.Module.values
    }
    return JsonResponse({
        'ok': True,
        'users': {
            'total': User.objects.count(),
            'active_accounts': User.objects.filter(is_active=True).count(),
            'suspended_profiles': CommunityProfile.objects.filter(status=CommunityProfile.Status.SUSPENDED).count(),
            'by_role': by_role,
        },
        'layers': grants,
        'shell': {
            'content_total': ContentItem.objects.count(),
            'content_draft': ContentItem.objects.filter(status=ContentItem.Status.DRAFT).count(),
            'content_published': ContentItem.objects.filter(status=ContentItem.Status.PUBLISHED).count(),
            'comments_pending': Comment.objects.filter(status=Comment.Status.PENDING).count(),
            'comments_published': Comment.objects.filter(status=Comment.Status.PUBLISHED).count(),
        },
        'lms': {
            'courses_total': Course.objects.count(),
            'courses_published': Course.objects.filter(status=Course.Status.PUBLISHED).count(),
            'active_enrollments': CourseEnrollment.objects.filter(status=CourseEnrollment.Status.ACTIVE).count(),
            'completed_enrollments': CourseEnrollment.objects.filter(status=CourseEnrollment.Status.COMPLETED).count(),
        },
        'research': {
            'projects_total': ResearchProject.objects.filter(archived=False).count(),
        },
        'activity_events': ActivityEvent.objects.count(),
    })


@require_http_methods(['GET'])
def platform_admin_users(request):
    if not _core_admin(request):
        return _deny(request)
    User = get_user_model()
    qs = User.objects.all().order_by('-date_joined', '-id')
    query = str(request.GET.get('q') or '').strip()
    if query:
        qs = qs.filter(
            Q(email__icontains=query)
            | Q(username__icontains=query)
            | Q(first_name__icontains=query)
            | Q(last_name__icontains=query)
        )
    role = str(request.GET.get('role') or '').strip()
    if role in CommunityProfile.Role.values:
        qs = qs.filter(gravitas_community_profile__role=role)
    try:
        limit = max(1, min(MAX_USERS, int(request.GET.get('limit') or 100)))
    except (TypeError, ValueError):
        limit = 100
    users = list(qs[:limit])
    return JsonResponse({
        'ok': True,
        'users': [_user_json(user) for user in users],
        'returned': len(users),
        'limit': limit,
    })


def _parse_optional_datetime(value):
    if value in (None, ''):
        return None
    parsed = parse_datetime(str(value))
    if parsed is None:
        raise ValueError('invalid_datetime')
    return parsed


def _apply_core_access(actor, target, config):
    spaces = ensure_platform_workspaces(actor)
    core = spaces['core']
    enabled = bool(config.get('enabled', True))
    existing = WorkspaceMembership.objects.filter(workspace=core, user=target).first()

    if not enabled:
        if target.pk == actor.pk:
            raise ValueError('cannot_remove_own_core_access')
        if existing and existing.role in {WorkspaceMembership.Role.OWNER, WorkspaceMembership.Role.ADMIN}:
            remaining = WorkspaceMembership.objects.filter(
                workspace=core,
                role__in=[WorkspaceMembership.Role.OWNER, WorkspaceMembership.Role.ADMIN],
            ).exclude(user=target).count()
            if remaining == 0:
                raise ValueError('cannot_remove_last_core_admin')
        if existing:
            existing.delete()
        return set_module_grant(
            target,
            ModuleGrant.Module.CORE,
            enabled=False,
            access_level=ModuleGrant.AccessLevel.MANAGE if config.get('access_level') == 'manage' else ModuleGrant.AccessLevel.EDIT,
            source=ModuleGrant.Source.TEAM,
            granted_by=actor,
            metadata={'workspace_id': core.pk, 'membership': 'revoked'},
        )

    requested = str(config.get('workspace_role') or '').strip().lower()
    level = str(config.get('access_level') or ModuleGrant.AccessLevel.EDIT)
    if level not in ModuleGrant.AccessLevel.values:
        raise ValueError('invalid_access_level')
    if existing and existing.role == WorkspaceMembership.Role.OWNER:
        role = WorkspaceMembership.Role.OWNER
    elif requested == WorkspaceMembership.Role.ADMIN or level == ModuleGrant.AccessLevel.MANAGE:
        role = WorkspaceMembership.Role.ADMIN
    else:
        role = WorkspaceMembership.Role.MEMBER
    WorkspaceMembership.objects.update_or_create(
        workspace=core,
        user=target,
        defaults={'role': role},
    )
    return set_module_grant(
        target,
        ModuleGrant.Module.CORE,
        enabled=True,
        access_level=ModuleGrant.AccessLevel.MANAGE if role in {WorkspaceMembership.Role.OWNER, WorkspaceMembership.Role.ADMIN} else ModuleGrant.AccessLevel.EDIT,
        source=ModuleGrant.Source.TEAM,
        granted_by=actor,
        metadata={'workspace_id': core.pk, 'membership_role': role},
    )


@require_http_methods(['GET', 'PATCH'])
def platform_admin_user_detail(request, user_id):
    if not _core_admin(request):
        return _deny(request)
    User = get_user_model()
    try:
        target = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'user_not_found'}, status=404)

    if request.method == 'GET':
        recent = ActivityEvent.objects.filter(subject_user=target)[:50]
        return JsonResponse({
            'ok': True,
            'user': _user_json(target),
            'activity': [_activity_json(event) for event in recent],
        })

    data = _payload(request)
    if data is None:
        return JsonResponse({'ok': False, 'error': 'invalid_json'}, status=400)
    profile = _profile(target)
    changes = {}

    try:
        with transaction.atomic():
            if 'community_role' in data:
                value = str(data['community_role'])
                if value not in CommunityProfile.Role.values:
                    raise ValueError('invalid_community_role')
                if profile.role != value:
                    changes['community_role'] = {'from': profile.role, 'to': value}
                    profile.role = value
            if 'community_status' in data:
                value = str(data['community_status'])
                if value not in CommunityProfile.Status.values:
                    raise ValueError('invalid_community_status')
                if target.pk == request.user.pk and value == CommunityProfile.Status.SUSPENDED:
                    raise ValueError('cannot_suspend_self')
                if profile.status != value:
                    changes['community_status'] = {'from': profile.status, 'to': value}
                    profile.status = value
            profile.save()

            if 'account_active' in data:
                active = bool(data['account_active'])
                if target.pk == request.user.pk and not active:
                    raise ValueError('cannot_deactivate_self')
                if target.is_active != active:
                    changes['account_active'] = {'from': target.is_active, 'to': active}
                    target.is_active = active
                    target.save(update_fields=['is_active'])

            modules = data.get('modules')
            if modules is not None:
                if not isinstance(modules, dict):
                    raise ValueError('invalid_modules')
                for module, raw_config in modules.items():
                    if module not in ModuleGrant.Module.values:
                        raise ValueError('invalid_module')
                    config = raw_config if isinstance(raw_config, dict) else {'enabled': bool(raw_config)}
                    enabled = bool(config.get('enabled', True))
                    if module == ModuleGrant.Module.DASHBOARD:
                        if not enabled:
                            raise ValueError('dashboard_is_account_baseline')
                        continue
                    if module == ModuleGrant.Module.CORE:
                        grant = _apply_core_access(request.user, target, config)
                    else:
                        level = str(config.get('access_level') or ModuleGrant.AccessLevel.PARTICIPATE)
                        if level not in ModuleGrant.AccessLevel.values:
                            raise ValueError('invalid_access_level')
                        grant = set_module_grant(
                            target,
                            module,
                            enabled=enabled,
                            access_level=level,
                            source=ModuleGrant.Source.ADMIN,
                            granted_by=request.user,
                            starts_at=_parse_optional_datetime(config.get('starts_at')),
                            expires_at=_parse_optional_datetime(config.get('expires_at')),
                            metadata={'admin_user_id': request.user.pk},
                        )
                    changes.setdefault('modules', {})[module] = {
                        'enabled': grant.enabled,
                        'access_level': grant.access_level,
                    }
    except ValueError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=409 if str(exc).startswith('cannot_') else 400)

    if changes:
        record_activity(
            layer=ActivityEvent.Layer.CORE,
            action='user.access_updated',
            actor=request.user,
            subject_user=target,
            object_type='user',
            object_id=target.pk,
            detail=changes,
        )
    return JsonResponse({'ok': True, 'user': _user_json(target), 'changes': changes})


def _activity_json(event):
    return {
        'id': event.pk,
        'layer': event.layer,
        'action': event.action,
        'actor': {
            'id': event.actor_id,
            'email': event.actor.email if event.actor_id and event.actor else '',
            'name': event.actor.get_full_name() if event.actor_id and event.actor else '',
        } if event.actor_id else None,
        'subject_user': {
            'id': event.subject_user_id,
            'email': event.subject_user.email if event.subject_user_id and event.subject_user else '',
            'name': event.subject_user.get_full_name() if event.subject_user_id and event.subject_user else '',
        } if event.subject_user_id else None,
        'object_type': event.object_type,
        'object_id': event.object_id,
        'detail': event.detail,
        'created_at': _iso(event.created_at),
    }


@require_http_methods(['GET'])
def platform_admin_activity(request):
    if not _core_admin(request):
        return _deny(request)
    qs = ActivityEvent.objects.select_related('actor', 'subject_user').all()
    layer = str(request.GET.get('layer') or '').strip()
    if layer:
        if layer not in ActivityEvent.Layer.values:
            return JsonResponse({'ok': False, 'error': 'invalid_layer'}, status=400)
        qs = qs.filter(layer=layer)
    user_id = request.GET.get('user_id')
    if user_id:
        try:
            user_id = int(user_id)
        except (TypeError, ValueError):
            return JsonResponse({'ok': False, 'error': 'invalid_user_id'}, status=400)
        qs = qs.filter(Q(subject_user_id=user_id) | Q(actor_id=user_id))
    action = str(request.GET.get('action') or '').strip()
    if action:
        qs = qs.filter(action=action)
    try:
        limit = max(1, min(MAX_EVENTS, int(request.GET.get('limit') or 100)))
    except (TypeError, ValueError):
        limit = 100
    events = list(qs[:limit])
    return JsonResponse({
        'ok': True,
        'events': [_activity_json(event) for event in events],
        'returned': len(events),
        'limit': limit,
    })
