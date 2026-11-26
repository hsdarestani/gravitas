import uuid

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .models import Workspace, WorkspaceMembership
from .operating_models import KeyResult, OperatingProcess, StrategicObjective
from .platform_models import WorkspaceProfile
from .platform_runtime_v3 import core_role
from .workspace_studio_api import _body, error, studio_access
from .workspace_studio_projects import _text


@require_http_methods(['PATCH'])
@studio_access
def studio_review_interval(request, workspace):
    if core_role(request.user, workspace) not in ('owner', 'admin'):
        return error('permission_denied', 403)
    days = (_body(request) or {}).get('days')
    if type(days) is not int or days not in (7, 14, 30):
        return error('invalid_review_interval', 400)
    WorkspaceProfile.objects.filter(workspace=workspace).update(studio_review_days=days)
    return JsonResponse({'ok': True})


@require_http_methods(['POST', 'PATCH'])
@studio_access
def studio_area(request, workspace, process_id=None):
    user = request.user
    admin = core_role(user, workspace) in ('owner', 'admin')
    data = _body(request) or {}
    action = data.get('action')
    Workspace.objects.select_for_update().get(pk=workspace.pk)
    areas = OperatingProcess.objects.filter(workspace=workspace, active=True)
    process = areas.filter(pk=process_id).select_for_update().first() if process_id is not None else None
    if process_id is not None and not process:
        return error('area_not_found', 404)
    if action == 'area':
        if not admin:
            return error('permission_denied', 403)
        title, owner_id = data.get('title'), data.get('owner_id')
        if not _text(title, 180, True) or (owner_id is not None and (
            type(owner_id) is not int or not WorkspaceMembership.objects.filter(
                workspace=workspace, user_id=owner_id, user__is_active=True,
            ).exists()
        )):
            return error('invalid_work_area', 400)
        if areas.filter(name__iexact=title.strip()).exclude(pk=process_id).exists():
            return error('area_name_exists', 409)
        if process is None:
            process = OperatingProcess(workspace=workspace, key='studio-'+uuid.uuid4().hex[:16])
        process.name, process.owner_id = title.strip(), owner_id
        process.save()
        return JsonResponse({'ok': True, 'id': process.pk}, status=201 if process_id is None else 200)
    if action != 'preset' or process is None:
        return error('invalid_work_area_action', 400)
    if not (admin or process.owner_id == user.pk):
        return error('permission_denied', 403)
    name, title = data.get('name'), data.get('title')
    checklists = {key: data.get(key) for key in ('checklist', 'dod')}
    if not _text(name, 60, True) or not _text(title, 80, True) or any(
        not isinstance(rows, list) or len(rows) > 60 or not all(_text(label, 500, True) for label in rows)
        for rows in checklists.values()
    ):
        return error('invalid_preset', 400)
    preset_id = data.get('preset_id')
    preset = next((row for row in process.studio_task_presets if row['id'] == preset_id), None)
    if preset_id and not preset:
        return error('preset_not_found', 404)
    if any(row is not preset and row['name'].casefold() == name.strip().casefold() for row in process.studio_task_presets):
        return error('preset_name_exists', 409)
    if preset is None:
        if len(process.studio_task_presets) >= 150:
            return error('preset_limit', 409)
        preset = {'id': str(uuid.uuid4())}
        process.studio_task_presets.append(preset)
    preset.update(name=name.strip(), title=title.strip(), **checklists)
    process.save(update_fields=['studio_task_presets', 'updated_at'])
    return JsonResponse({'ok': True, 'id': preset['id']})


@require_http_methods(['PATCH'])
@studio_access
def studio_okr_owner(request, workspace, item_type, item_id):
    if core_role(request.user, workspace) not in ('owner', 'admin'):
        return error('permission_denied', 403)
    if item_type == 'objective':
        rows = StrategicObjective.objects.filter(workspace=workspace)
    elif item_type == 'result':
        rows = KeyResult.objects.filter(objective__workspace=workspace)
    else:
        return error('okr_not_found', 404)
    row = rows.select_for_update().filter(pk=item_id).exclude(status='archived').first()
    if not row:
        return error('okr_not_found', 404)
    owner_id = (_body(request) or {}).get('owner_id')
    if type(owner_id) is not int or not WorkspaceMembership.objects.filter(
        workspace=workspace, user_id=owner_id, user__is_active=True,
    ).exists():
        return error('invalid_okr_owner', 400)
    row.owner_id = owner_id
    row.save(update_fields=['owner', 'updated_at'])
    return JsonResponse({'ok': True})


@require_http_methods(['POST'])
@studio_access
def studio_add_member(request, workspace):
    role = core_role(request.user, workspace)
    data = _body(request) or {}
    requested, email = data.get('role'), data.get('email')
    if role not in ('owner', 'admin') or (requested == 'admin' and role != 'owner' and not request.user.is_superuser):
        return error('permission_denied', 403)
    if requested not in ('member', 'admin') or not _text(email, 254, True):
        return error('invalid_member', 400)
    lookup = email.strip()
    users = list(get_user_model().objects.select_for_update().filter(
        Q(email__iexact=lookup) | Q(username__iexact=lookup), is_active=True, is_superuser=False,
    )[:2])
    if len(users) != 1:
        return error('existing_account_required', 400)
    user = users[0]
    if WorkspaceMembership.objects.filter(workspace=workspace, user=user).exists():
        return error('already_core_member', 409)
    WorkspaceMembership.objects.create(workspace=workspace, user=user, role=requested)
    return JsonResponse({'ok': True, 'id': user.pk}, status=201)
