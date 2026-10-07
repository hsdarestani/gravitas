from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import operating_api as base
from .operating_models import Initiative, OperatingTask


@require_http_methods(['POST'])
def reorder_tasks(request):
    if (auth := base._auth(request)):
        return auth
    payload = base._body(request)
    workspace = base._workspace(request, payload)
    if not workspace:
        return base._error('workspace_not_found', 404)
    if not base._editable(request, workspace):
        return base._error('permission_denied', 403)

    initiative = Initiative.objects.filter(
        pk=payload.get('initiative_id'), workspace=workspace
    ).first()
    if not initiative:
        return base._error('initiative_not_found', 404)

    raw_ids = payload.get('task_ids')
    if not isinstance(raw_ids, list):
        return base._error('task_ids_required')
    try:
        task_ids = [int(value) for value in raw_ids]
    except (TypeError, ValueError):
        return base._error('invalid_task_order')
    if len(task_ids) != len(set(task_ids)):
        return base._error('duplicate_task_in_order')

    existing_ids = list(
        OperatingTask.objects.filter(workspace=workspace, initiative=initiative)
        .values_list('id', flat=True)
    )
    if set(task_ids) != set(existing_ids):
        return base._error(
            'task_order_must_include_all_initiative_tasks',
            409,
            expected_count=len(existing_ids),
        )

    with transaction.atomic():
        previous_id = None
        for task_id in task_ids:
            OperatingTask.objects.filter(
                pk=task_id, workspace=workspace, initiative=initiative
            ).update(dependency_id=previous_id)
            previous_id = task_id

    return JsonResponse({'ok': True, 'initiative_id': initiative.pk, 'task_ids': task_ids})
