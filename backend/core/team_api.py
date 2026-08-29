import json
from urllib.parse import quote

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from django.views.decorators.http import require_http_methods

from .models import ProjectMembership, WorkspaceMembership
from .platform_models import ResearcherProfile
from .platform_runtime_v3 import core_role, ensure_platform_workspaces
from .views import _send_system_email
from .workspace_api import provision_personal_workspace

User = get_user_model()
MANAGER_ROLES = {WorkspaceMembership.Role.OWNER, WorkspaceMembership.Role.ADMIN}
EDITABLE_ROLES = {WorkspaceMembership.Role.ADMIN, WorkspaceMembership.Role.MEMBER}


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _admin_context(request):
    if not request.user.is_authenticated:
        return None, _error('authentication_required', 401)
    spaces = ensure_platform_workspaces(request.user)
    core = spaces['core']
    role = core_role(request.user, core)
    if not request.user.is_superuser and role not in MANAGER_ROLES:
        return None, _error('core_admin_required', 403)
    return {'core': core, 'research': spaces['research'], 'role': role}, None


def _iso(value):
    return value.isoformat() if value else None


def _display_name(user):
    full = user.get_full_name().strip()
    return full or user.first_name or user.email or user.username


def _nextcloud(user):
    identity = getattr(user, 'gravitas_nextcloud', None)
    return {
        'provisioned': bool(identity),
        'username': identity.username if identity else '',
    }


def _research_projects_count(user, research):
    member_count = ProjectMembership.objects.filter(user=user, project__workspace=research).values('project_id').distinct().count()
    owned_ids = user.gravitas_projects_owned.filter(workspace=research).values_list('id', flat=True)
    if not owned_ids:
        return member_count
    all_ids = set(ProjectMembership.objects.filter(user=user, project__workspace=research).values_list('project_id', flat=True))
    all_ids.update(owned_ids)
    return len(all_ids)


def _member_json(membership, research):
    user = membership.user
    profile = getattr(user, 'gravitas_researcher_profile', None)
    return {
        'id': user.pk,
        'name': _display_name(user),
        'email': user.email,
        'role': membership.role,
        'is_active': user.is_active,
        'is_staff': user.is_staff,
        'is_superuser': user.is_superuser,
        'date_joined': _iso(user.date_joined),
        'last_login': _iso(user.last_login),
        'membership_created_at': _iso(membership.created_at),
        'nextcloud': _nextcloud(user),
        'researcher': bool(profile),
        'research_headline': profile.headline if profile else '',
        'research_projects': _research_projects_count(user, research),
    }


def _researcher_json(user, research):
    profile = getattr(user, 'gravitas_researcher_profile', None)
    return {
        'id': user.pk,
        'name': _display_name(user),
        'email': user.email,
        'is_active': user.is_active,
        'headline': profile.headline if profile else '',
        'institution': profile.institution if profile else '',
        'is_public': profile.is_public if profile else False,
        'research_projects': _research_projects_count(user, research),
        'nextcloud': _nextcloud(user),
    }


def _target_user(user_id):
    try:
        return User.objects.get(pk=user_id)
    except (User.DoesNotExist, TypeError, ValueError):
        return None


def _manager_count(core):
    return WorkspaceMembership.objects.filter(workspace=core, role__in=MANAGER_ROLES, user__is_active=True).count()


def _protect_manager_change(request, core, membership, *, removing=False, new_role=None, deactivating=False):
    if not membership:
        return None
    if membership.user_id == request.user.pk and (removing or deactivating or (new_role and new_role not in MANAGER_ROLES)):
        return _error('cannot_remove_your_own_admin_access', 400)
    if membership.role in MANAGER_ROLES:
        loses_manager = removing or deactivating or (new_role and new_role not in MANAGER_ROLES)
        if loses_manager and _manager_count(core) <= 1:
            return _error('at_least_one_core_admin_required', 409)
    return None


def _validate_identity(email, name=''):
    email = str(email or '').strip().lower()
    name = str(name or '').strip()[:150]
    try:
        validate_email(email)
    except ValidationError:
        return None, None, _error('invalid_email', 400)
    return email, name, None


def _send_password_setup(user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    link = f'{settings.PUBLIC_BASE_URL}/account.html?reset_uid={quote(uid)}&reset_token={quote(token)}#reset'
    text = (
        'Set or reset your Gravitas+ password\n\n'
        'Use the link below to choose a password for your account:\n'
        f'{link}\n\n'
        'If you did not expect this message, contact a Gravitas administrator.'
    )
    html = (
        '<h2>Set your Gravitas+ password</h2>'
        '<p>An administrator created or updated access for your Gravitas account.</p>'
        f'<p><a href="{link}">Choose a new password</a></p>'
        '<p>If you did not expect this message, contact a Gravitas administrator.</p>'
    )
    _send_system_email('Set your Gravitas+ password', user.email, text, html)


@require_http_methods(['GET', 'POST'])
def core_team(request):
    ctx, denied = _admin_context(request)
    if denied:
        return denied
    core, research = ctx['core'], ctx['research']

    if request.method == 'GET':
        memberships = list(
            WorkspaceMembership.objects.filter(workspace=core)
            .select_related('user')
            .order_by('role', 'user__first_name', 'user__email')
        )
        member_ids = [item.user_id for item in memberships]
        research_users = (
            User.objects.filter(
                Q(gravitas_researcher_profile__isnull=False)
                | Q(gravitas_project_memberships__project__workspace=research)
                | Q(gravitas_projects_owned__workspace=research)
            )
            .exclude(pk__in=member_ids)
            .distinct()
            .order_by('first_name', 'email')[:200]
        )
        return JsonResponse({
            'ok': True,
            'viewer': {
                'id': request.user.pk,
                'role': ctx['role'] or ('admin' if request.user.is_superuser else None),
                'is_superuser': request.user.is_superuser,
            },
            'counts': {
                'core_members': len(memberships),
                'core_admins': sum(1 for item in memberships if item.role in MANAGER_ROLES and item.user.is_active),
                'active_members': sum(1 for item in memberships if item.user.is_active),
                'external_researchers': research_users.count() if hasattr(research_users, 'count') else len(research_users),
            },
            'members': [_member_json(item, research) for item in memberships],
            'researchers': [_researcher_json(user, research) for user in research_users],
        })

    payload = _body(request)
    email, name, identity_error = _validate_identity(payload.get('email'), payload.get('name'))
    if identity_error:
        return identity_error
    role = str(payload.get('role') or WorkspaceMembership.Role.MEMBER).strip().lower()
    if role not in EDITABLE_ROLES:
        return _error('invalid_core_role', 400)
    password = str(payload.get('password') or '')
    send_setup = bool(payload.get('send_setup', not password))

    existing = User.objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).first()
    created_user = False
    email_sent = False
    with transaction.atomic():
        if existing:
            user = existing
            if name and user.first_name != name:
                user.first_name = name
                user.save(update_fields=['first_name'])
        else:
            user = User(username=email, email=email, first_name=name, is_active=True)
            if password:
                try:
                    validate_password(password, user=user)
                except ValidationError as exc:
                    return _error('password_invalid', 400, messages=list(exc.messages))
                user.set_password(password)
            else:
                user.set_unusable_password()
            user.save()
            provision_personal_workspace(user)
            created_user = True
        membership, _ = WorkspaceMembership.objects.update_or_create(
            workspace=core,
            user=user,
            defaults={'role': role},
        )

    if send_setup and user.email:
        try:
            _send_password_setup(user)
            email_sent = True
        except Exception:
            email_sent = False

    membership = WorkspaceMembership.objects.select_related('user').get(pk=membership.pk)
    return JsonResponse({
        'ok': True,
        'created_user': created_user,
        'email_sent': email_sent,
        'member': _member_json(membership, research),
    }, status=201 if created_user else 200)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def core_team_member(request, user_id):
    ctx, denied = _admin_context(request)
    if denied:
        return denied
    core, research = ctx['core'], ctx['research']
    user = _target_user(user_id)
    if not user:
        return _error('user_not_found', 404)
    membership = WorkspaceMembership.objects.filter(workspace=core, user=user).select_related('user').first()

    if request.method == 'GET':
        if not membership:
            return _error('core_membership_not_found', 404)
        return JsonResponse({'ok': True, 'member': _member_json(membership, research)})

    if user.is_superuser and not request.user.is_superuser:
        return _error('superuser_requires_superuser', 403)

    if request.method == 'DELETE':
        if not membership:
            return _error('core_membership_not_found', 404)
        protected = _protect_manager_change(request, core, membership, removing=True)
        if protected:
            return protected
        membership.delete()
        return JsonResponse({'ok': True, 'removed_from_core': True, 'user_id': user.pk})

    if not membership:
        return _error('core_membership_not_found', 404)
    payload = _body(request)
    new_role = str(payload.get('role', membership.role)).strip().lower()
    if new_role not in EDITABLE_ROLES and new_role != WorkspaceMembership.Role.OWNER:
        return _error('invalid_core_role', 400)
    if new_role == WorkspaceMembership.Role.OWNER and not request.user.is_superuser:
        return _error('owner_role_requires_superuser', 403)

    new_active = bool(payload.get('is_active', user.is_active))
    protected = _protect_manager_change(
        request,
        core,
        membership,
        new_role=new_role,
        deactivating=user.is_active and not new_active,
    )
    if protected:
        return protected

    name = str(payload.get('name', user.first_name or '')).strip()[:150]
    email = str(payload.get('email', user.email or '')).strip().lower()
    try:
        validate_email(email)
    except ValidationError:
        return _error('invalid_email', 400)
    duplicate = User.objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).exclude(pk=user.pk).exists()
    if duplicate:
        return _error('account_exists', 409)

    with transaction.atomic():
        old_email = (user.email or '').lower()
        user.first_name = name
        user.email = email
        if not user.username or user.username.lower() == old_email:
            user.username = email
        user.is_active = new_active
        user.save(update_fields=['first_name', 'email', 'username', 'is_active'])
        if membership.role != new_role:
            membership.role = new_role
            membership.save(update_fields=['role'])

    membership = WorkspaceMembership.objects.select_related('user').get(pk=membership.pk)
    return JsonResponse({'ok': True, 'member': _member_json(membership, research)})


@require_http_methods(['POST'])
def core_team_password_reset(request, user_id):
    ctx, denied = _admin_context(request)
    if denied:
        return denied
    user = _target_user(user_id)
    if not user:
        return _error('user_not_found', 404)
    if user.is_superuser and not request.user.is_superuser:
        return _error('superuser_requires_superuser', 403)

    payload = _body(request)
    mode = str(payload.get('mode') or 'email').strip().lower()
    if mode == 'email':
        if not user.email:
            return _error('email_required', 400)
        if not user.is_active:
            return _error('inactive_user_cannot_receive_reset', 409)
        try:
            _send_password_setup(user)
        except Exception:
            return _error('email_delivery_failed', 502)
        return JsonResponse({'ok': True, 'mode': 'email', 'sent': True})

    if mode == 'temporary':
        password = str(payload.get('password') or '')
        try:
            validate_password(password, user=user)
        except ValidationError as exc:
            return _error('password_invalid', 400, messages=list(exc.messages))
        user.set_password(password)
        user.save(update_fields=['password'])
        return JsonResponse({'ok': True, 'mode': 'temporary', 'updated': True})

    return _error('invalid_reset_mode', 400)
