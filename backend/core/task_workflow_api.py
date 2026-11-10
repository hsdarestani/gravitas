import json

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import operating_api as base
from .operating_models import OperatingTask, OperatingTaskWorkflow, WorkflowState, WorkStatus
from .platform_access import can_comment, can_edit, can_view
from .task_consolidation import canonical_id
from .task_workflows import (
    MAX_ITEMS, MAX_TEXT, TEMPLATES, WorkflowRequestError, complete_task, finalize, steps_for, update_part,
)


def workflow_error(error):
    return JsonResponse({'ok': False, 'error': error.code}, status=getattr(error, 'status', 409))


@require_http_methods(['GET'])
def workflow_templates(request):
    return JsonResponse({
        'ok': True,
        'templates': [
            {'id': key, 'label': item['label'], 'steps': item['steps'], 'parts': list(item['parts'])}
            for key, item in TEMPLATES.items()
        ],
    })


def _serialize(task, workflow, steps, user, edit, comment):
    return JsonResponse({
        'ok': True,
        'workflow': {
            'template': TEMPLATES[workflow.template]['label'],
            'revision': workflow.revision,
            'steps': [
                {'id': step.pk, 'title': step.title, 'status': step.status, 'can_edit': edit and can_edit(user, step)}
                if can_view(user, step) else {'title': 'Restricted step', 'status': step.status, 'can_edit': False}
                for step in steps
            ],
            'parts': workflow.parts,
            'steps_done': all(step.status == WorkStatus.DONE for step in steps),
            'status': task.status,
            'final_approval': workflow.final_approval,
            'can_edit': edit,
            'can_comment': comment,
            'viewer_id': user.pk,
            'max_items': MAX_ITEMS,
            'max_text': MAX_TEXT,
        },
    })


@require_http_methods(['GET', 'POST'])
@transaction.atomic
def task_workflow(request, task_id, project_id=None):
    write = request.method == 'POST'
    queryset = OperatingTask.objects.select_related('workspace', 'project')
    if write:
        queryset = queryset.select_for_update(of=('self',))
    if project_id is not None:
        queryset = queryset.filter(project_id=project_id, project__archived=False)
    else:
        from .task_board_api import _readonly_task_workspace
        workspace = _readonly_task_workspace(request)
        if not workspace:
            return workflow_error(WorkflowRequestError('core_workspace_required', 403))
        queryset = queryset.filter(workspace=workspace)

    task = queryset.exclude(workflow_state=WorkflowState.NONE).filter(pk=task_id).first()
    user = request.user
    if not task or not can_view(user, task) or (project_id is not None and not can_view(user, task.project)):
        return workflow_error(WorkflowRequestError('task_not_found', 404))
    edit = can_edit(user, task) and (
        can_edit(user, task.project) if project_id is not None else base._editable(request, task.workspace)
    )
    comment = can_comment(user, task)
    workflow = OperatingTaskWorkflow.objects.get(task=task)
    steps = list(steps_for(task))
    if not write:
        return _serialize(task, workflow, steps, user, edit, comment)

    try:
        payload = json.loads(request.body)
    except (TypeError, ValueError, UnicodeDecodeError):
        payload = None
    if not isinstance(payload, dict):
        return workflow_error(WorkflowRequestError('invalid_payload'))
    try:
        _apply(task, workflow, steps, user, edit, comment, payload)
    except WorkflowRequestError as error:
        return workflow_error(error)
    workflow.revision += 1
    workflow.save(update_fields=['revision', 'parts', 'final_approval'])
    return _serialize(task, workflow, steps, user, edit, comment)


def _apply(task, workflow, steps, user, edit, comment, payload):
    action = payload.get('action')
    if action not in ('complete_step', 'save', 'submit', 'comment', 'request_changes', 'approve', 'finalize'):
        raise WorkflowRequestError('workflow_invalid_action')
    if not (comment if action == 'comment' else edit):
        raise WorkflowRequestError('permission_denied', 403)
    if type(payload.get('revision')) is not int or payload['revision'] != workflow.revision:
        raise WorkflowRequestError('workflow_changed', 409)
    if task.status == WorkStatus.ARCHIVED or workflow.final_approval:
        raise WorkflowRequestError('workflow_closed', 409)
    if canonical_id(task.pk) != task.pk:
        raise WorkflowRequestError('task_consolidated_read_only', 409)

    if action == 'complete_step':
        step_id = payload.get('step')
        step = next((item for item in steps if type(step_id) is int and item.pk == step_id), None)
        if not step or not can_edit(user, step):
            raise WorkflowRequestError('permission_denied', 403)
        if canonical_id(step.pk) != step.pk:
            raise WorkflowRequestError('task_consolidated_read_only', 409)
        if step.status != WorkStatus.DONE:
            complete_task(step)
        return

    if any(step.status != WorkStatus.DONE for step in steps):
        raise WorkflowRequestError('workflow_finish_steps', 409)
    if action == 'finalize':
        finalize(task, workflow, user)
    else:
        update_part(workflow, payload, user, can_edit=edit, can_comment=comment)
