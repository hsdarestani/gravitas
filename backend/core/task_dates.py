"""Task lifecycle dates are facts, independent of schedules and deadlines.

All writers pass through the model hook. Recovery only uses recorded evidence;
an unknown start or deadline must never be manufactured from today's date.
Provenance distinguishes an observed transition from an earliest-known bound.
"""
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone as dt_timezone

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

DATE_FIELDS = ('created_at', 'started_at', 'completed_at')


def stamp(value):
    if isinstance(value, datetime):
        return timezone.make_aware(value, dt_timezone.utc) if timezone.is_naive(value) else value
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        result = parse_datetime(value)
    except (TypeError, ValueError):
        return None
    return stamp(result) if result else None


def dates_json(task):
    return {**{key: getattr(task, key).isoformat() if getattr(task, key) else None
               for key in DATE_FIELDS}, 'date_provenance': task.date_provenance}


def can_edit_dates(user, task):
    from .workspace_api import _can_manage_workspace
    if user.is_staff or user.is_superuser:
        return True
    cache = getattr(user, '_task_date_admin_workspaces', None)
    if cache is None:
        cache = user._task_date_admin_workspaces = {}
    if task.workspace_id not in cache:
        cache[task.workspace_id] = _can_manage_workspace(user, task.workspace)
    return cache[task.workspace_id]


def apply_date_patch(task, payload, user):
    """Validate admin corrections before any save. Return explicit field names."""
    fields = set(DATE_FIELDS) & set(payload)
    if not fields:
        return set()
    if not can_edit_dates(user, task):
        raise PermissionError('task_date_admin_required')
    values = {key: getattr(task, key) for key in DATE_FIELDS}
    for key in fields:
        value = payload[key]
        if value in (None, '') and key != 'created_at':
            values[key] = None
            continue
        try:
            parsed = parse_datetime(value) if isinstance(value, str) else None
        except (ValueError, TypeError):
            parsed = None
        if parsed is None or timezone.is_naive(parsed):
            raise ValueError('invalid_' + key)
        if parsed > timezone.now() + timedelta(minutes=5):
            raise ValueError('actual_task_date_in_future')
        values[key] = parsed
    if ((values['started_at'] and values['started_at'] < values['created_at']) or
            (values['completed_at'] and values['completed_at'] < (values['started_at'] or values['created_at']))):
        raise ValueError('invalid_task_date_order')
    provenance = dict(task.date_provenance or {})
    for key in fields:
        setattr(task, key, values[key])
        provenance[key] = {'source': 'admin', 'confidence': 'recorded', 'actor_id': user.pk,
                           'corrected_at': timezone.now().isoformat()}
    task.date_provenance = provenance
    task._explicit_date_fields = fields
    return fields


def track_dates(task, previous, update_fields=None):
    """Capture real transitions once, including partial saves and non-UI writers."""
    explicit = getattr(task, '_explicit_date_fields', set())
    changed = set(explicit)
    provenance = dict(task.date_provenance or {})
    now = timezone.now()
    status_written = update_fields is None or 'status' in update_fields
    transition = status_written and (previous is None or previous['status'] != task.status)
    imported_creation = previous is None and bool(task.source_key)
    if previous is None:
        provenance.setdefault('created_at', {'source': 'import' if imported_creation else 'observed',
                                            'confidence': 'earliest_known' if imported_creation else 'recorded'})
    if transition and not imported_creation:
        if task.status == 'active' and task.started_at is None and 'started_at' not in explicit:
            task.started_at = now
            changed.add('started_at')
        if task.status == 'done' and task.completed_at is None and 'completed_at' not in explicit:
            task.completed_at = now
            changed.add('completed_at')
        elif previous and previous['status'] == 'done' and task.status not in ('done', 'archived') and 'completed_at' not in explicit:
            task.completed_at = None
            changed.add('completed_at')
        elif previous and task.status == 'archived' and previous.get('completed_at') and 'completed_at' not in explicit:
            task.completed_at = previous['completed_at']
            changed.add('completed_at')
    # Existing writers may already set completed_at when they change status.
    if transition and not imported_creation and 'completed_at' not in explicit and task.status == 'done':
        changed.add('completed_at')
    for key in changed - explicit:
        if previous is None or previous.get(key) != getattr(task, key):
            provenance[key] = {'source': 'observed', 'confidence': 'recorded'}
    if (update_fields is None or 'due_date' in update_fields) and (
            previous is None and task.due_date or previous and previous['due_date'] != task.due_date):
        if provenance.get('due_date', {}).get('source') != 'admin':
            provenance['due_date'] = {'source': 'recorded', 'confidence': 'recorded'}
    if provenance != task.date_provenance:
        task.date_provenance = provenance
        changed.add('date_provenance')
    return changed


def recover_task_dates(*, apps=None, using='default', apply=False):
    """Bounded-query, repeatable recovery, shared by migration and audit command.

    QuerySet.update deliberately avoids native HTTP/signal work inside the data
    migration. Dirty canonical projections are queued transactionally below.
    Never restore a deadline after an explicitly recorded clear.
    """
    if apps is None:
        from django.apps import apps
    Task = apps.get_model('core', 'OperatingTask')
    Activity = apps.get_model('core', 'ActivityEvent')
    Audit = apps.get_model('core', 'ProjectAuditEvent')
    File = apps.get_model('core', 'CanonicalFile')
    Revision = apps.get_model('core', 'CanonicalFileRevision')
    Note = apps.get_model('core', 'KnowledgeResource')
    tasks = list(Task.objects.using(using).all().order_by('pk'))
    evidence = defaultdict(list)
    for model, source in ((Activity, 'activity'), (Audit, 'project_audit')):
        for row in model.objects.using(using).filter(object_type__in=['operating_task', 'OperatingTask', 'task']).values(
                'pk', 'object_id', 'action', 'detail', 'created_at').iterator(chunk_size=1000):
            if not str(row['object_id']).isdecimal():
                continue
            evidence[int(row['object_id'])].append({**row, 'source': source})
    files = dict(File.objects.using(using).filter(object_type='OperatingTask').values_list('pk', 'object_id'))
    snapshots = defaultdict(list)
    for rev in Revision.objects.using(using).filter(file_id__in=files).values('pk', 'file_id', 'content', 'created_at').iterator(chunk_size=200):
        try:
            body = json.loads(rev['content'])
            if body.get('type') != 'OperatingTask' or body.get('id') != files[rev['file_id']]:
                continue
            snapshots[files[rev['file_id']]].append((rev['created_at'], body.get('fields', {}), 'canonical_revision:' + str(rev['pk'])))
        except (ValueError, TypeError, AttributeError):
            continue
    work = defaultdict(list)
    for note in Note.objects.using(using).filter(metadata__pm_type='task_time_log_v1').values('pk', 'metadata', 'body').iterator(chunk_size=200):
        metadata = note['metadata'] or {}
        task_id = metadata.get('task_id')
        if not str(task_id).isdecimal():
            continue
        dates = [metadata.get('active_started_at')]
        dates.extend(re.findall(r'^\| (\d{4}-\d{2}-\d{2}T[^ |]+) \|', note['body'] or '', re.M))
        work[int(task_id)].extend((value, 'work_log:' + str(note['pk'])) for value in dates if value)
    counts = Counter(total=len(tasks), changed=0)
    for task in tasks:
        provenance = dict(task.date_provenance or {})
        candidates = defaultdict(list)
        deadlines = []
        events = sorted(evidence[task.pk], key=lambda r: (r['created_at'], r['pk']))

        def add(key, value, source, confidence='recorded'):
            parsed = stamp(value)
            if parsed and parsed <= timezone.now() + timedelta(minutes=5):
                candidates[key].append((parsed, {'source': source, 'confidence': confidence}))

        for event_index, event in enumerate(events):
            at, detail = event['created_at'], event['detail'] or {}
            if not isinstance(detail, dict):
                continue
            ref = event['source'] + ':' + str(event['pk'])
            # Any event proves existence by that time, not the exact birth.
            add('created_at', at, ref, 'earliest_known')
            is_creation = event['action'] in ('task.created', 'task_created')
            if is_creation:
                add('created_at', at, ref, 'earliest_known' if task.source_key else 'recorded')
            changes = detail.get('changes') or {}
            if not isinstance(changes, dict):
                changes = {}
            status = detail.get('to_status') or detail.get('status')
            if isinstance(changes.get('status'), dict):
                status = changes['status'].get('to')
            # Earlier Research audit rows stored the old value only. The next
            # transition's old value (or the current state for the last one)
            # identifies the result of this recorded transition.
            if status is None and 'status' in (detail.get('fields') or []):
                status = task.status
                for later in events[event_index + 1:]:
                    later_detail = later['detail'] or {}
                    prior_status = (later_detail.get('previous') or {}).get('status')
                    if prior_status:
                        status = prior_status
                        break
                    later_change = (later_detail.get('changes') or {}).get('status')
                    if isinstance(later_change, dict) and later_change.get('from'):
                        status = later_change['from']
                        break
            if status == 'active':
                add('started_at', at, ref, 'earliest_known' if is_creation and task.source_key else 'recorded')
            if status == 'done':
                add('completed_at', at, ref, 'earliest_known' if is_creation and task.source_key else 'recorded')
            for key in DATE_FIELDS:
                value = changes.get(key, {})
                add(key, value.get('to') if isinstance(value, dict) else value, ref)
                if key in detail:
                    add(key, detail[key], ref)
            if 'due_date' in changes:
                change = changes['due_date']
                deadlines.append((at, change.get('to') if isinstance(change, dict) else change, ref))
            elif 'due_date' in detail:
                deadlines.append((at, detail['due_date'], ref))
            elif 'due_date' in (detail.get('fields') or []):
                # A latest legacy edit that cleared its due date is not
                # permission to resurrect an earlier deadline from a snapshot.
                value = task.due_date
                for later in events[event_index + 1:]:
                    previous = (later.get('detail') or {}).get('previous') or {}
                    if 'due_date' in previous:
                        value = previous['due_date']
                        break
                deadlines.append((at, value.isoformat() if hasattr(value, 'isoformat') else value, ref))
        for at, fields, ref in sorted(snapshots[task.pk], key=lambda r: r[0]):
            if not isinstance(fields, dict):
                continue
            add('created_at', at, ref, 'earliest_known')
            for key in DATE_FIELDS:
                add(key, fields.get(key), ref)
            if fields.get('status') == 'active':
                add('started_at', at, ref, 'earliest_known')
            # A done snapshot proves done by this point, not when it happened.
            if fields.get('status') == 'done':
                add('completed_at', at, ref, 'earliest_known')
            if 'due_date' in fields:
                deadlines.append((at, fields['due_date'], ref))
        metadata = task.source_metadata or {}
        if metadata.get('activity_date_raw'):
            raw = str(metadata['activity_date_raw']).strip()
            if re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw):
                add('created_at', raw + 'T00:00:00+00:00', 'source_activity_date', 'earliest_known')
        for data in [metadata] + [metadata[k] for k in ('github', 'source', 'original', 'task_dates') if isinstance(metadata.get(k), dict)]:
            for key in DATE_FIELDS:
                add(key, data.get(key), 'source_metadata')
            add('started_at', data.get('activated_at'), 'source_metadata')
            add('completed_at', data.get('closed_at'), 'source_metadata')
            if data.get('due_date'):
                deadlines.append((task.created_at, data['due_date'], 'source_metadata'))
        for at, ref in work[task.pk]:
            add('started_at', at, ref, 'earliest_known')
            add('created_at', at, ref, 'earliest_known')
        updates = {}
        for key in DATE_FIELDS:
            existing = getattr(task, key)
            if provenance.get(key, {}).get('source') in ('admin', 'observed'):
                continue
            options = candidates[key]
            if key == 'completed_at' and task.status not in ('done', 'archived'):
                continue
            if options:
                exact = [item for item in options if item[1]['confidence'] == 'recorded']
                choices = (exact or options) if key == 'completed_at' else options
                chosen = (max(choices, key=lambda x: x[0]) if key == 'completed_at' else
                          min(choices, key=lambda x: (x[0], x[1]['confidence'] != 'recorded')))
                value, info = chosen
                # Existing creation/completion may be the import timestamp.
                if key == 'created_at' and existing and value > existing:
                    continue
                if existing is None or (key == 'created_at' and value < existing) or (key == 'completed_at' and value < existing):
                    updates[key] = value
                    provenance[key] = info
                elif key not in provenance:
                    provenance[key] = {'source': 'existing', 'confidence': 'recorded'}
        # Starting work also proves the task existed; import times may be later.
        created = updates.get('created_at', task.created_at)
        started = updates.get('started_at', task.started_at)
        completed = updates.get('completed_at', task.completed_at)
        if started and started < created and provenance.get('created_at', {}).get('source') in ('admin', 'observed') and 'started_at' in updates:
            del updates['started_at']
            provenance.pop('started_at', None)
            started = task.started_at
        if started and started < created and provenance.get('created_at', {}).get('source') not in ('admin', 'observed'):
            updates['created_at'] = started
            provenance['created_at'] = {'source': 'start_evidence', 'confidence': 'earliest_known'}
        if completed and completed < updates.get('created_at', created) and provenance.get('created_at', {}).get('source') not in ('admin', 'observed'):
            updates['created_at'] = completed
            provenance['created_at'] = {'source': 'completion_evidence', 'confidence': 'earliest_known'}
        if started and completed and completed < started and 'started_at' in updates:
            del updates['started_at']
            provenance.pop('started_at', None)
        if task.due_date is None and deadlines and provenance.get('due_date', {}).get('source') not in ('admin', 'recorded'):
            _, value, ref = max(deadlines, key=lambda x: x[0])
            try:
                due = parse_date(str(value)) if value else None
            except (ValueError, TypeError):
                due = None
            if due:
                updates['due_date'] = due
                provenance['due_date'] = {'source': ref, 'confidence': 'recorded'}
        for key in (*DATE_FIELDS, 'due_date'):
            value = updates.get(key, getattr(task, key))
            if value is None:
                counts['missing_' + key] += 1
            elif key not in provenance:
                provenance[key] = {'source': 'existing', 'confidence': 'earliest_known' if key == 'created_at' and task.source_key else 'recorded'}
        if provenance != task.date_provenance:
            updates['date_provenance'] = provenance
        if updates:
            counts['changed'] += 1
            if apply:
                Task.objects.using(using).filter(pk=task.pk).update(**updates)
                if task.project_id:
                    Canonical = apps.get_model('core', 'CanonicalProject')
                    Outbox = apps.get_model('core', 'CanonicalTaskSyncOutbox')
                    if Canonical.objects.using(using).filter(project_id=task.project_id, enabled=True).exists():
                        from django.db.models import F
                        job, _ = Outbox.objects.using(using).get_or_create(project_id=task.project_id, task_id=task.pk,
                            defaults={'next_attempt_at': timezone.now()})
                        Outbox.objects.using(using).filter(pk=job.pk).update(generation=F('generation') + 1,
                            state='pending', attempts=0, next_attempt_at=timezone.now(), last_error='')
    return dict(counts)
