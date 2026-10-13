"""Project task schedules as human-editable canonical Markdown, not shadow DB rows.

Each plan is an ACL-managed KnowledgeResource under the Research project,
synchronized and conflict-checked by the existing Nextcloud canonical layer.
"""
import json
import re
from datetime import timedelta

from django.db import transaction
from django.http import JsonResponse
from django.utils.dateparse import parse_date
from django.views.decorators.http import require_http_methods

from .models import KnowledgeResource, ResearchProject
from .operating_models import OperatingTask
from .platform_access import can_edit, can_view, policy_for, INHERIT_VISIBILITY

HEADER = '| Start date | End date | Estimated minutes |'
DIVIDER = '| --- | --- | ---: |'
PATTERN = re.compile(r'^\\| (\\d{4}-\\d{2}-\\d{2}) \\| (\\d{4}-\\d{2}-\\d{2}) \\| (\\d+) \\|$')


def _parse(item):
    lines = item.body.splitlines()
    if len(lines) != 5 or not lines[0].startswith('# Schedule for task #') or lines[1] or lines[2:4] != [HEADER, DIVIDER]:
        raise ValueError('invalid_schedule_markdown')
    m = PATTERN.fullmatch(lines[4])
    if not m:
        raise ValueError('invalid_schedule_markdown')
    start, end = parse_date(m[1]), parse_date(m[2])
    estimate = int(m[3])
    if not start or not end or end < start or (end - start) > timedelta(days=366) or not 0 <= estimate <= 525600:
        raise ValueError('invalid_schedule_interval')
    if item.body.splitlines()[0] != f'# Schedule for task #{item.metadata.get("task_id")}':
        raise ValueError('schedule_task_identity_mismatch')
    return {'start_date': start.isoformat(), 'end_date': end.isoformat(),
            'estimated_minutes': estimate, 'schedule_note_id': item.pk}


def _error(code, status=400):
    return JsonResponse({'ok': False, 'error': code}, status=status)


@require_http_methods(['GET', 'POST'])
def project_task_schedules(request, project_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project = ResearchProject.objects.filter(pk=project_id, archived=False).first()
    if not project or not can_view(request.user, project):
        return _error('not_found', 404)
    visible = {
        t.pk: t for t in OperatingTask.objects.filter(project=project)
        if can_view(request.user, t)
    }
    if request.method == 'GET':
        result = []
        for note in KnowledgeResource.objects.filter(
                project=project, kind=KnowledgeResource.Kind.NOTE,
                metadata__pm_type='task_schedule_v1').order_by('pk'):
            tid = (note.metadata or {}).get('task_id')
            if tid not in visible or not can_view(request.user, note):
                continue
            try:
                plan = _parse(note)
            except ValueError as exc:
                return _error(str(exc), 409)
            result.append({'task_id': tid, **plan})
        return JsonResponse({'ok': True, 'schedules': result})

    if not can_edit(request.user, project):
        return _error('project_edit_required', 403)
    try:
        data = json.loads(request.body or '{}')
    except (ValueError, UnicodeDecodeError):
        return _error('invalid_payload')
    if not isinstance(data, dict) or set(data) != {'task_id', 'start_date', 'end_date', 'estimated_minutes'}:
        return _error('invalid_schedule_fields')
    try:
        task_id, minutes = int(data['task_id']), int(data['estimated_minutes'])
        start, end = parse_date(str(data['start_date'])), parse_date(str(data['end_date']))
    except (ValueError, TypeError):
        return _error('invalid_schedule_fields')
    if not start or not end or end < start or (end - start).days > 366 or not 0 <= minutes <= 525600:
        return _error('invalid_schedule_interval')
    task = visible.get(task_id)
    if not task or not can_edit(request.user, task):
        return _error('task_edit_required', 403)
    with transaction.atomic():
        task = OperatingTask.objects.select_for_update().get(pk=task.pk)
        notes = list(KnowledgeResource.objects.select_for_update().filter(
            project=project, kind=KnowledgeResource.Kind.NOTE,
            metadata__pm_type='task_schedule_v1', metadata__task_id=task.pk,
        ))
        if len(notes) > 1:
            return _error('duplicate_task_schedule_requires_review', 409)
        if notes and not can_edit(request.user, notes[0]):
            return _error('schedule_edit_required', 403)
        note = notes[0] if notes else KnowledgeResource(
            workspace=project.workspace, project=project, owner=request.user,
            kind=KnowledgeResource.Kind.NOTE,
            title=f'Schedule · task #{task.pk}',
            description='Canonical human-editable Markdown project task schedule.',
            metadata={'pm_type': 'task_schedule_v1', 'task_id': task.pk},
        )
        note.body = (f'# Schedule for task #{task.pk}\\n\\n{HEADER}\\n{DIVIDER}\\n'
                     f'| {start.isoformat()} | {end.isoformat()} | {minutes} |\\n')
        note.save()
        if not notes:
            policy_for(note, create=True, created_by=request.user,
                       default_visibility=INHERIT_VISIBILITY)
        plan = _parse(note)
    return JsonResponse({'ok': True, 'task_id': task_id, **plan})
