"""Versioned Markdown work logs attached to the existing Research/Core task.

There is one canonical KnowledgeResource note per (task, actor). The native
Nextcloud .md file is the source of truth for time entries and active timer
state; the database row is the projection. No separate clock database exists.
"""
import json
import math
import re
from datetime import datetime, timedelta, timezone as dt_timezone

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime, parse_date
from django.views.decorators.http import require_http_methods

from .models import KnowledgeResource, ResearchProject
from .operating_models import OperatingTask
from .platform_access import can_view, can_edit, can_manage, policy_for, INHERIT_VISIBILITY


ENTRY = re.compile(
    r'^\| (?P<start>\d{4}-\d{2}-\d{2}T[^ |]+) \| '
    r'(?P<end>\d{4}-\d{2}-\d{2}T[^ |]+) \| '
    r'(?P<minutes>\d+) \| (?P<note>[^|]*) \|$'
)
HEADER = '| Started (UTC) | Ended (UTC) | Minutes | Note |'
DIVIDER = '| --- | --- | ---: | --- |'
MAX_MINUTES = 12 * 60
MAX_ACTIVE_HOURS = 24


def _error(code, status=400):
    return JsonResponse({'ok': False, 'error': code}, status=status)


def _log_queryset(project, task):
    return (KnowledgeResource.objects.filter(
        project=project, kind=KnowledgeResource.Kind.NOTE,
        metadata__pm_type='task_time_log_v1', metadata__task_id=task.pk,
    ).select_related('owner').order_by('pk'))


def _parse(note):
    """Validate external Markdown edits before using any duration for reporting."""
    metadata = note.metadata or {}
    if not isinstance(metadata, dict) or metadata.get('pm_type') != 'task_time_log_v1':
        raise ValueError('invalid_work_log_metadata')
    if metadata.get('owner_id') != note.owner_id:
        raise ValueError('work_log_owner_mismatch')
    rows = note.body.splitlines()
    if len(rows) < 4 or rows[2:4] != [HEADER, DIVIDER]:
        raise ValueError('work_log_format_invalid')
    entries = []
    for line in rows[4:]:
        if not line.strip():
            continue
        match = ENTRY.fullmatch(line)
        if not match:
            raise ValueError('work_log_entry_invalid')
        start = parse_datetime(match['start'])
        end = parse_datetime(match['end'])
        minutes = int(match['minutes'])
        if not start or not end or timezone.is_naive(start) or timezone.is_naive(end) or end < start:
            raise ValueError('work_log_interval_invalid')
        if minutes < 1 or minutes > MAX_MINUTES:
            raise ValueError('work_log_duration_invalid')
        entries.append({
            'start': start.isoformat(), 'end': end.isoformat(),
            'minutes': minutes, 'note': match['note'].replace('&#124;', '|'),
            'owner_id': note.owner_id, 'log_id': note.pk,
        })
    return entries


def _new_log(project, task, actor):
    title = f'Work log · Task {task.pk} · {actor.get_username()}'[:240]
    note = KnowledgeResource.objects.create(
        workspace=project.workspace, project=project, owner=actor,
        kind=KnowledgeResource.Kind.NOTE, title=title,
        description=f'Human-editable, canonical Markdown work log for task #{task.pk}.',
        body=f'# Time log for task #{task.pk}\n\n{HEADER}\n{DIVIDER}\n',
        metadata={
            'pm_type': 'task_time_log_v1', 'task_id': task.pk,
            'owner_id': actor.pk, 'active_started_at': None,
        },
    )
    policy_for(note, create=True, created_by=actor,
               default_visibility=INHERIT_VISIBILITY)
    return note


def _stamp(value):
    return value.astimezone(dt_timezone.utc).isoformat(timespec='seconds')


def _append(note, start, end, minutes, comment):
    comment = re.sub(r'\s+', ' ', str(comment or '')).strip().replace('|', '&#124;')[:500]
    note.body += f'| {_stamp(start)} | {_stamp(end)} | {minutes} | {comment} |\n'


def _session_data(request, task, project):
    rows, totals = [], {}
    active = None
    for note in _log_queryset(project, task):
        if not can_view(request.user, note):
            continue
        if (note.metadata or {}).get('task_id') != task.pk:
            raise ValueError('work_log_task_mismatch')
        parsed = _parse(note)
        rows += parsed
        totals[note.owner_id] = totals.get(note.owner_id, 0) + sum(e['minutes'] for e in parsed)
        if note.owner_id == request.user.pk:
            active = (note.metadata or {}).get('active_started_at')
    rows.sort(key=lambda x: x['start'], reverse=True)
    return {'entries': rows[:250], 'entry_count': len(rows),
            'total_minutes': sum(totals.values()), 'owner_minutes': totals,
            'my_active_started_at': active}


@require_http_methods(['GET', 'POST'])
def project_task_time(request, project_id, task_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project = ResearchProject.objects.filter(pk=project_id, archived=False).first()
    task = (OperatingTask.objects.select_related('owner').filter(
        pk=task_id, project_id=project_id).first())
    if not project or not task or not can_view(request.user, project) or not can_view(request.user, task):
        return _error('not_found', 404)
    if request.method == 'GET':
        try:
            return JsonResponse({'ok': True, **_session_data(request, task, project)})
        except ValueError as exc:
            return _error(str(exc), 409)

    if not can_edit(request.user, task):
        return _error('task_edit_required', 403)
    try:
        payload = json.loads(request.body or '{}')
    except (ValueError, UnicodeDecodeError):
        return _error('invalid_payload')
    if not isinstance(payload, dict) or payload.get('action') not in {'start', 'stop', 'discard', 'log'}:
        return _error('invalid_action')
    action = payload['action']
    with transaction.atomic():
        # Serialise changes across tabs/devices, including first-log creation.
        task = OperatingTask.objects.select_for_update().get(pk=task.pk)
        matches = list(_log_queryset(project, task).filter(owner=request.user).select_for_update())
        if len(matches) > 1:
            return _error('duplicate_work_log_requires_review', 409)
        log = matches[0] if matches else None
        if log and not can_edit(request.user, log):
            return _error('work_log_edit_required', 403)
        if log:
            try:
                _parse(log)
            except ValueError as exc:
                return _error(str(exc), 409)
        if action == 'stop' and not log:
            return _error('no_active_timer', 409)
        if not log and action == 'discard':
            return _error('no_active_timer', 409)
        if log is None:
            log = _new_log(project, task, request.user)
        meta = dict(log.metadata)
        active = meta.get('active_started_at')
        now = timezone.now()

        if action == 'start':
            if active:
                return _error('timer_already_running', 409)
            meta['active_started_at'] = _stamp(now)
        elif action == 'discard':
            if not active:
                return _error('no_active_timer', 409)
            meta['active_started_at'] = None
        elif action == 'stop':
            if not active:
                return _error('no_active_timer', 409)
            started = parse_datetime(str(active))
            if not started or timezone.is_naive(started) or started > now:
                return _error('invalid_active_timer', 409)
            elapsed = now - started
            if elapsed > timedelta(hours=MAX_ACTIVE_HOURS):
                return _error('timer_exceeds_one_day_discard_or_log', 409)
            minutes = max(1, math.ceil(elapsed.total_seconds() / 60))
            if minutes > MAX_MINUTES:
                return _error('timer_exceeds_twelve_hours_discard_or_log', 409)
            _append(log, started, now, minutes, payload.get('note'))
            meta['active_started_at'] = None
        else:
            if active:
                return _error('stop_active_timer_first', 409)
            try:
                minutes = int(payload.get('minutes'))
            except (TypeError, ValueError):
                return _error('invalid_minutes')
            if minutes < 1 or minutes > MAX_MINUTES:
                return _error('invalid_minutes')
            stamp = parse_date(str(payload.get('date') or ''))
            if not stamp or stamp > timezone.localdate():
                return _error('invalid_work_date')
            start = datetime.combine(stamp, datetime.min.time(), tzinfo=dt_timezone.utc)
            end = start + timedelta(minutes=minutes)
            _append(log, start, end, minutes, payload.get('note'))
        log.metadata = meta
        log.save(update_fields=['metadata', 'body', 'updated_at'])
    return JsonResponse({'ok': True, **_session_data(request, task, project)})
