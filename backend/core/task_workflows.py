"""Workflow templates and transitions over the existing Core/Research tasks.

Each task keeps its own checklist and iteration history. Editing the catalog
can never change the steps or the approval requirements of work in progress.
"""
import hashlib
import json
import uuid
from copy import deepcopy

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.validators import URLValidator
from django.db import transaction
from django.utils import timezone

from .operating_models import OperatingTask, OperatingTaskWorkflow, WorkflowState, WorkStatus

TEMPLATES = {
    'video': {
        'label': 'Video',
        'steps': ['Brief', 'Research', 'Script', 'Character and visuals', 'Edit', 'Scientific review'],
        'parts': {
            'Music': ['Music fits the scene and dialogue is clear', 'Music usage rights are confirmed'],
            'Character': ['Character matches the approved design', 'Appearance and movement are consistent'],
            'Content': ['Script and on-screen claims match the sources'],
            'Final cut': ['Timing, captions and export are ready to publish'],
        },
    },
    'development': {
        'label': 'Development',
        'steps': ['Scope', 'Build', 'Test', 'Prepare preview'],
        'parts': {
            'Functionality': ['Main flow and error cases work', 'Relevant tests pass'],
            'UI': ['Layout and controls work on desktop and mobile', 'Keyboard navigation works'],
        },
    },
    'essay': {
        'label': 'Essay',
        'steps': ['Outline', 'Research', 'Write draft', 'Edit'],
        'parts': {
            'Content': ['Argument is clear and the draft is complete'],
            'Sources': ['Claims are supported and references are accurate'],
            'Editorial': ['Language, structure and formatting are ready to publish'],
        },
    },
    'graphic_design': {'label': 'Graphic Design', 'steps': [], 'parts': {}},
}
MAX_ITEMS = 30
MAX_TEXT = 240
validate_url = URLValidator(schemes=['http', 'https'])


class WorkflowRequestError(Exception):
    def __init__(self, code, status=400):
        self.code = code
        self.status = status
        super().__init__(code)


def _labels(value, maximum=10):
    if not isinstance(value, list) or not 1 <= len(value) <= maximum:
        raise WorkflowRequestError('workflow_names_required')
    if any(not isinstance(item, str) or not item.strip() or len(item.strip()) > 80 for item in value):
        raise WorkflowRequestError('workflow_invalid_name')
    labels = [item.strip() for item in value]
    if len(set(label.casefold() for label in labels)) != len(labels):
        raise WorkflowRequestError('workflow_duplicate_name')
    return labels


def workflow_plan(payload, user, scope):
    config = payload.get('workflow')
    if config is None:
        return None
    if not isinstance(config, dict) or not isinstance(config.get('template'), str):
        raise WorkflowRequestError('workflow_invalid_template')
    kind = config['template']
    if kind not in TEMPLATES:
        raise WorkflowRequestError('workflow_invalid_template')
    status = payload.get('status', WorkStatus.ACTIVE)
    if payload.get('parent_id') or status not in WorkStatus.values or status in (WorkStatus.DONE, WorkStatus.ARCHIVED):
        raise WorkflowRequestError('workflow_open_task_required')
    template = TEMPLATES[kind]
    if kind == 'graphic_design':
        steps = _labels(config.get('steps'))
        parts = {name: ['Matches the agreed brief and is ready to deliver'] for name in _labels(config.get('parts'))}
    else:
        steps, parts = template['steps'], template['parts']
    creation_id = None
    if 'creation_id' in config:
        try:
            creation_id = uuid.uuid5(uuid.UUID(str(config['creation_id'])), str(user.pk))
        except (ValueError, TypeError, AttributeError):
            raise WorkflowRequestError('invalid_creation_request_id') from None
    fingerprint = hashlib.sha256(json.dumps([scope, payload], sort_keys=True).encode()).hexdigest()
    return {'template': kind, 'steps': steps, 'parts': parts, 'creation_id': creation_id, 'fingerprint': fingerprint}


def replay_workflow_create(plan, user):
    if not plan or not plan['creation_id']:
        return None
    # Serialize the same user's retries across both task creators. The unique
    # key provides a second guard, and the fingerprint binds it to the scope.
    get_user_model().objects.select_for_update().get(pk=user.pk)
    existing = OperatingTaskWorkflow.objects.select_related('task').filter(creation_id=plan['creation_id']).first()
    if existing and existing.creation_fingerprint != plan['fingerprint']:
        raise WorkflowRequestError('creation_request_payload_mismatch', 409)
    return existing.task if existing else None


def _check_item(text, *, fix=False):
    return {'id': uuid.uuid4().hex, 'text': text, 'done': False, 'fix': fix}


def _draft(number, items, preview='', reference=''):
    return {
        'number': number, 'status': 'draft', 'items': items,
        'preview': preview, 'reference': reference, 'comments': [],
    }


def install_workflow(task, plan):
    """Call inside the transaction that creates the parent task."""
    from .canonical_projects import active, suppress
    from .canonical_task_outbox import queue_task_sync

    canonical = bool(task.project_id and active(task.project))
    task.workflow_state = WorkflowState.PENDING
    OperatingTask.objects.filter(pk=task.pk).update(workflow_state=task.workflow_state)
    OperatingTaskWorkflow.objects.create(
        task=task, template=plan['template'], creation_id=plan['creation_id'],
        creation_fingerprint=plan['fingerprint'],
        parts=[
            {'id': index, 'name': name, 'iterations': [_draft(1, [_check_item(text) for text in checklist])]}
            for index, (name, checklist) in enumerate(plan['parts'].items(), start=1)
        ],
    )
    # The new task and every child commit together. Native sync uses the same
    # durable queue as task edits, keeping DAV outside the workspace request.
    with suppress():
        for index, title in enumerate(plan['steps'], start=1):
            step = OperatingTask.objects.create(
                parent=task, workflow_position=index, workspace_id=task.workspace_id,
                project_id=task.project_id, initiative_id=task.initiative_id,
                milestone_id=task.milestone_id, work_package_id=task.work_package_id,
                cycle_id=task.cycle_id, owner_id=task.owner_id, priority=task.priority,
                title=title, definition_of_done=f'{title} is complete.', status=WorkStatus.DRAFT,
            )
            if canonical:
                queue_task_sync(step)
        if canonical:
            queue_task_sync(task)


def steps_for(task):
    return task.subtasks.filter(workflow_position__isnull=False).select_related('parent').order_by('workflow_position')


def _valid_link(value, field):
    if not isinstance(value, str) or len(value) > 1600:
        raise WorkflowRequestError(f'workflow_invalid_{field}')
    value = value.strip()
    if value:
        try:
            validate_url(value)
        except ValidationError:
            raise WorkflowRequestError(f'workflow_invalid_{field}') from None
    return value


def _save_draft(iteration, payload, submit, user):
    if iteration['status'] != 'draft':
        raise WorkflowRequestError('workflow_iteration_closed', 409)
    items = payload.get('items')
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS:
        raise WorkflowRequestError('workflow_checklist_required')
    original = {item['id']: item for item in iteration['items']}
    incoming = {}
    for item in items:
        if not isinstance(item, dict) or type(item.get('done')) is not bool:
            raise WorkflowRequestError('workflow_invalid_checklist')
        text, item_id = item.get('text'), item.get('id')
        if not isinstance(text, str) or not text.strip() or len(text.strip()) > MAX_TEXT:
            raise WorkflowRequestError('workflow_invalid_checklist')
        if item_id is None:
            item_id = uuid.uuid4().hex
        elif not isinstance(item_id, str) or item_id not in original or item_id in incoming:
            raise WorkflowRequestError('workflow_invalid_checklist')
        incoming[item_id] = {
            'id': item_id, 'text': text.strip(), 'done': item['done'],
            'fix': original.get(item_id, {}).get('fix', False),
        }
    for item in original.values():
        if item['fix'] and incoming.get(item['id'], {}).get('text') != item['text']:
            raise WorkflowRequestError('workflow_keep_requested_fixes')

    preview = _valid_link(payload.get('preview', ''), 'preview')
    reference = _valid_link(payload.get('reference', ''), 'reference')
    if submit and not preview:
        raise WorkflowRequestError('workflow_preview_required')
    if submit and not all(item['done'] for item in incoming.values()):
        raise WorkflowRequestError('workflow_finish_checklist')
    iteration.update(items=list(incoming.values()), preview=preview, reference=reference)
    if submit:
        iteration.update(status='in_review', submitted=_stamp(user))


def _stamp(user):
    return {
        'by': {'id': user.pk, 'name': user.get_full_name() or user.get_username()},
        'at': timezone.now().isoformat(),
    }


def _comment(iteration, text, user):
    if not isinstance(text, str) or not text.strip() or len(text.strip()) > 4000:
        raise WorkflowRequestError('workflow_feedback_required')
    if len(iteration['comments']) >= 100:
        raise WorkflowRequestError('workflow_comment_limit')
    iteration['comments'].append({'text': text.strip(), **_stamp(user)})


def update_part(workflow, payload, user, *, can_edit, can_comment):
    part_id, number = payload.get('part'), payload.get('iteration')
    if type(part_id) is not int or type(number) is not int:
        raise WorkflowRequestError('workflow_iteration_required')
    part = next((item for item in workflow.parts if item['id'] == part_id), None)
    if part is None:
        raise WorkflowRequestError('workflow_part_not_found', 404)
    iteration = part['iterations'][-1]
    if iteration['number'] != number:
        raise WorkflowRequestError('workflow_iteration_closed', 409)
    action = payload['action']
    if action in ('save', 'submit'):
        _save_draft(iteration, payload, action == 'submit', user)
        return

    if iteration['status'] != 'in_review':
        raise WorkflowRequestError('workflow_iteration_closed', 409)
    if action == 'comment':
        if not can_comment:
            raise WorkflowRequestError('permission_denied', 403)
        _comment(iteration, payload.get('feedback'), user)
        return

    if not can_edit or iteration['submitted']['by']['id'] == user.pk:
        raise WorkflowRequestError('workflow_reviewer_required', 403)
    if action == 'request_changes':
        feedback = payload.get('feedback')
        fixes = [line.strip() for line in feedback.splitlines() if line.strip()] if isinstance(feedback, str) else []
        base_items = [deepcopy(item) for item in iteration['items'] if not item['fix']]
        if not fixes or len(fixes) + len(base_items) > MAX_ITEMS or any(len(line) > MAX_TEXT for line in fixes):
            raise WorkflowRequestError('workflow_fixes_required')
        _comment(iteration, feedback, user)
        iteration.update(status='changes_requested', reviewed=_stamp(user))
        part['iterations'].append(_draft(
            number + 1, base_items + [_check_item(line, fix=True) for line in fixes],
            iteration['preview'], iteration['reference'],
        ))
    else:
        if payload.get('feedback'):
            _comment(iteration, payload['feedback'], user)
        iteration.update(status='approved', reviewed=_stamp(user))


def complete_task(task, *, final=False):
    from .canonical_projects import _pending, active
    from .canonical_task_outbox import queue_task_sync

    canonical = bool(task.project_id and active(task.project))
    token = _pending.set([]) if canonical else None
    try:
        task.status = WorkStatus.DONE
        fields = ['status', 'updated_at']
        if final:
            task.workflow_state = WorkflowState.APPROVED
            fields.append('workflow_state')
        task.save(update_fields=fields, workflow_approval=final)
        if canonical:
            queue_task_sync(task)
    finally:
        if token is not None:
            _pending.reset(token)


def finalize(task, workflow, user):
    if any(part['iterations'][-1]['status'] != 'approved' for part in workflow.parts):
        raise WorkflowRequestError('workflow_approval_required', 409)
    complete_task(task, final=True)
    workflow.final_approval = _stamp(user)
