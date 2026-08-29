import json

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import operating_api as operating_base
from .operating_models import OperatingTask, Priority, WorkStatus
from .platform_access import can_edit, can_manage, can_view, effective_role, policy_for
from .platform_models import ObjectPolicy


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400):
    return JsonResponse({'ok': False, 'error': code}, status=status)


def _task_json(task, user):
    item = operating_base._task_json(task)
    item.update({
        'work_package_id': task.work_package_id,
        'work_package_title': task.work_package.title if task.work_package else None,
        'project_id': task.project_id,
        'project_title': task.project.title if task.project else None,
        'permissions': {
            'role': effective_role(user, task),
            'can_view': can_view(user, task),
            'can_edit': can_edit(user, task),
            'can_manage': can_manage(user, task),
        },
    })
    policy = policy_for(task)
    item['visibility'] = policy.visibility if policy else ObjectPolicy.Visibility.WORKSPACE
    return item


@require_http_methods(['GET', 'PATCH'])
def shared_task_detail(request, task_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)

    task = OperatingTask.objects.select_related(
        'workspace',
        'owner',
        'initiative__process',
        'initiative__key_result__objective',
        'milestone',
        'work_package',
        'cycle',
        'project',
        'meeting',
    ).filter(pk=task_id).first()
    if not task or not can_view(request.user, task):
        return _error('not_found', 404)

    if request.method == 'GET':
        return JsonResponse({'ok': True, 'task': _task_json(task, request.user)})

    if not can_edit(request.user, task):
        return _error('permission_denied', 403)

    payload = _body(request)
    if 'title' in payload:
        title = str(payload['title']).strip()[:240]
        if not title:
            return _error('title_required')
        task.title = title
    if 'description' in payload:
        task.description = str(payload['description']).strip()
    if 'definition_of_done' in payload:
        value = str(payload['definition_of_done']).strip()
        if not value:
            return _error('definition_of_done_required')
        task.definition_of_done = value
    if 'priority' in payload:
        if payload['priority'] not in Priority.values:
            return _error('invalid_priority')
        task.priority = payload['priority']
    if 'status' in payload:
        if payload['status'] not in WorkStatus.values:
            return _error('invalid_status')
        task.status = payload['status']
        if task.status == WorkStatus.DONE and not task.completed_at:
            task.completed_at = operating_base.timezone.now()
        elif task.status != WorkStatus.DONE:
            task.completed_at = None
    if 'blocked_reason' in payload:
        task.blocked_reason = str(payload['blocked_reason']).strip()
    if 'due_date' in payload:
        task.due_date = operating_base._date(payload['due_date'])
        if not task.due_date and not task.cycle_id:
            return _error('task_requires_cycle_or_due_date')
        if task.meeting_id and not task.due_date:
            return _error('meeting_action_requires_deadline')

    # Changing assignment/dependencies/initiative structure remains a manager action.
    if any(key in payload for key in ('owner_id', 'initiative_id', 'milestone_id', 'work_package_id', 'cycle_id', 'project_id', 'meeting_id', 'dependency_id')):
        if not can_manage(request.user, task):
            return _error('manage_permission_required', 403)
        return _error('use_operating_workspace_for_structure_changes', 409)

    task.save()
    return JsonResponse({'ok': True, 'task': _task_json(task, request.user)})
