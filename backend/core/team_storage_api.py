import json

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Sum
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import cloud
from .models import KnowledgeResource, StoragePlan, WorkspaceMembership
from .platform_runtime_v3 import core_role, ensure_platform_workspaces

User = get_user_model()
MANAGER_ROLES = {WorkspaceMembership.Role.OWNER, WorkspaceMembership.Role.ADMIN}
MIN_QUOTA_BYTES = 100 * 1024 ** 2
MAX_QUOTA_BYTES = 2 * 1024 ** 4


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


def _plan(user):
    plan, _ = StoragePlan.objects.get_or_create(
        user=user,
        defaults={'tier': 'free', 'quota_bytes': settings.GRAVITAS_DEFAULT_QUOTA_BYTES},
    )
    return plan


def _storage_json(user, used=None):
    plan = _plan(user)
    if used is None:
        used = KnowledgeResource.objects.filter(owner=user).aggregate(total=Sum('file_size'))['total'] or 0
    used = int(used or 0)
    quota = max(int(plan.quota_bytes or settings.GRAVITAS_DEFAULT_QUOTA_BYTES), 1)
    identity = getattr(user, 'gravitas_nextcloud', None)
    percentage = round(min((used / quota) * 100, 100), 2)
    return {
        'user_id': user.pk,
        'tier': plan.tier,
        'used_bytes': used,
        'quota_bytes': quota,
        'remaining_bytes': max(quota - used, 0),
        'percentage': percentage,
        'state': 'full' if percentage >= 100 else ('near_limit' if percentage >= 85 else 'ok'),
        'nextcloud': {
            'provisioned': bool(identity),
            'username': identity.username if identity else '',
        },
    }


def _visible_users(ctx):
    # Team & Access intentionally includes self-registered accounts waiting for
    # access as well as Core/Research users, so storage administration mirrors
    # the same admin surface. Superusers are kept out of the pending-account
    # management surface unless the viewer is a superuser.
    qs = User.objects.exclude(email='').select_related('gravitas_storage_plan', 'gravitas_nextcloud')
    if not ctx.get('viewer_is_superuser'):
        qs = qs.exclude(is_superuser=True)
    return qs.order_by('-date_joined')[:500]


@require_http_methods(['GET'])
def team_storage(request):
    ctx, denied = _admin_context(request)
    if denied:
        return denied
    ctx['viewer_is_superuser'] = request.user.is_superuser
    users = list(_visible_users(ctx))
    ids = [user.pk for user in users]
    used_rows = (
        KnowledgeResource.objects.filter(owner_id__in=ids)
        .values('owner_id')
        .annotate(total=Sum('file_size'))
    )
    used_by_user = {row['owner_id']: int(row['total'] or 0) for row in used_rows}
    return JsonResponse({
        'ok': True,
        'default_quota_bytes': int(settings.GRAVITAS_DEFAULT_QUOTA_BYTES),
        'max_upload_bytes': int(settings.GRAVITAS_MAX_UPLOAD_BYTES),
        'users': [_storage_json(user, used_by_user.get(user.pk, 0)) for user in users],
    })


@require_http_methods(['PATCH'])
def team_storage_user(request, user_id):
    ctx, denied = _admin_context(request)
    if denied:
        return denied
    try:
        user = User.objects.select_related('gravitas_nextcloud').get(pk=user_id)
    except User.DoesNotExist:
        return _error('user_not_found', 404)
    if user.is_superuser and not request.user.is_superuser:
        return _error('superuser_requires_superuser', 403)

    payload = _body(request)
    try:
        quota_bytes = int(payload.get('quota_bytes'))
    except (TypeError, ValueError):
        return _error('invalid_quota', 400)
    if quota_bytes < MIN_QUOTA_BYTES or quota_bytes > MAX_QUOTA_BYTES:
        return _error(
            'quota_out_of_range',
            400,
            min_quota_bytes=MIN_QUOTA_BYTES,
            max_quota_bytes=MAX_QUOTA_BYTES,
        )

    used = KnowledgeResource.objects.filter(owner=user).aggregate(total=Sum('file_size'))['total'] or 0
    used = int(used or 0)
    if quota_bytes < used:
        return _error('quota_below_usage', 409, used_bytes=used)

    plan = _plan(user)
    identity = getattr(user, 'gravitas_nextcloud', None)
    if identity:
        try:
            cloud.set_quota(identity, quota_bytes)
        except cloud.CloudError:
            return _error('cloud_unavailable', 503)

    with transaction.atomic():
        plan.quota_bytes = quota_bytes
        plan.save(update_fields=['quota_bytes', 'updated_at'])

    return JsonResponse({'ok': True, 'storage': _storage_json(user, used)})
