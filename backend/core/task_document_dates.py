"""Recover day-level work estimates without changing recorded task events.

Imported reports describe when work happened, independently of when somebody
later checked Done. Estimates retain evidence, precision and the replaced value.
Meeting supplements are encrypted because the source repository is public.
"""
import base64
import hashlib
import hmac
import json
import zlib
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .task_date_inference import activity_window, day_stamp

LABEL = b'graviquest/task-meeting-date-plan/v1'
FIELDS = ('created_at', 'started_at', 'completed_at', 'due_date')


def iso(value):
    return value.isoformat() if hasattr(value, 'isoformat') else value


def instant(value):
    return datetime.fromisoformat(iso(value).replace('Z', '+00:00')) if value else None


def load_supplements(tasks, path=None):
    path = Path(path or Path(__file__).with_name('task_date_meeting_evidence.enc.json'))
    if not path.exists():
        return []
    envelope = json.loads(path.read_text())
    # Empty databases and unrelated installations never need the production key.
    if not any(hashlib.sha256(str(t.get('source_key') or '').encode()).hexdigest() == envelope['anchor'] for t in tasks):
        return []
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.exceptions import InvalidTag
    from django.conf import settings
    for secret in [settings.SECRET_KEY, *settings.SECRET_KEY_FALLBACKS]:
        key = hmac.new(secret.encode(), LABEL, hashlib.sha256).digest()
        try:
            raw = AESGCM(key).decrypt(base64.b64decode(envelope['nonce']), base64.b64decode(envelope['ciphertext']), LABEL)
        except InvalidTag:
            continue
        payload = json.loads(zlib.decompress(raw))
        if payload.get('schema') != 1:
            raise ValueError('Unsupported document date evidence schema')
        return payload['supplements']
    raise ValueError('Cannot decrypt this installation\'s document date evidence')


def propose_document_dates(tasks, supplements=(), *, today=None):
    """Pure, repeatable proposals. A date range alone never supplies a deadline."""
    today = today or datetime.now(timezone.utc).date()
    by_id = {t['id']: t for t in tasks}
    facts, children = defaultdict(list), defaultdict(list)
    for task in tasks:
        if task.get('parent_id') in by_id:
            children[task['parent_id']].append(task['id'])
        metadata = task.get('source_metadata') or {}
        records = [metadata, *metadata.get('records', [])]
        for record in records:
            window = activity_window(record.get('activity_date_raw'))
            if not window or window[1] > today:
                continue
            info = {'source': 'team_activity_inference', 'confidence': 'inferred', 'precision': 'day',
                    'source_reference': record.get('source_reference') or '',
                    'source_id': record.get('source_id') or '', 'tab_id': record.get('tab_id') or '',
                    'activity_date_raw': record['activity_date_raw'],
                    'activity_start': window[0].isoformat(), 'activity_end': window[1].isoformat(),
                    'rationale': 'Reported work window; activation hour and exact completion time are unknown.'}
            status = str(record.get('original_status') or '').lower()
            facts[task['id']].append({'created_at': window[0],
                **({'started_at': window[0]} if status not in ('planned', 'pending', 'waiting') else {}),
                **({'completed_at': window[1]} if str(record.get('original_status', '')).lower() == 'done' else {}), 'info': info})
    for supplement in supplements:
        task = by_id.get(supplement['task_id'])
        if task is None or task.get('source_key') != supplement.get('source_key'):
            continue
        if hashlib.sha256(task['title'].encode()).hexdigest() != supplement['title_sha256']:
            continue
        if supplement.get('expected_updated_at') and instant(task['updated_at']) != instant(supplement['expected_updated_at']):
            continue
        for fact in supplement['facts']:
            values = {key: date.fromisoformat(value) for key, value in fact.items() if key in FIELDS and value}
            if any(value > today for key, value in values.items() if key != 'due_date'):
                continue
            facts[task['id']].append({**values, 'info': {**fact['info'], 'confidence': 'inferred', 'precision': 'day'}})

    # Only actual parent tasks inherit child work windows, within their workspace.
    visited = set()
    def aggregate(task_id, visiting):
        if task_id in visited or task_id in visiting:
            return
        task = by_id[task_id]
        child_ids = [i for i in children[task_id] if by_id[i].get('workspace_id') == task.get('workspace_id')]
        for child_id in child_ids:
            aggregate(child_id, visiting | {task_id})
        child_facts = [f for i in child_ids for f in facts[i] if f.get('started_at')]
        if child_facts:
            start = min(f['started_at'] for f in child_facts)
            info = {'source': 'child_activity_inference', 'confidence': 'inferred', 'precision': 'day',
                    'child_task_ids': sorted(child_ids), 'activity_start': start.isoformat(),
                    'source_reference': next((f['info'].get('source_reference') for f in child_facts if f['info'].get('source_reference')), ''),
                    'rationale': 'Parent work started by the earliest reported activity of its subtasks.'}
            values = {'created_at': start, 'started_at': start, 'info': info}
            if all(by_id[i]['status'] in ('done', 'archived') and any(f.get('completed_at') for f in facts[i]) for i in child_ids):
                values['completed_at'] = max(f['completed_at'] for i in child_ids for f in facts[i] if f.get('completed_at'))
                info['activity_end'] = values['completed_at'].isoformat()
            facts[task_id].append(values)
        visited.add(task_id)
    for task in tasks:
        aggregate(task['id'], set())

    for task in tasks:
        # A finished task necessarily started, even if its activation was never
        # logged. Use the earliest documented existence as an explicit estimate,
        # retaining the entire uncertainty interval; never do this for backlog.
        if task['status'] not in ('done', 'archived') or task.get('started_at') or not task.get('completed_at'):
            continue
        if any(f.get('started_at') for f in facts[task['id']]):
            continue
        known = [instant(task['created_at']).date(), *[f['created_at'] for f in facts[task['id']] if f.get('created_at')]]
        start, end = min(known), instant(task['completed_at']).date()
        if start > end:
            continue
        info = {'source': 'completion_window_inference', 'confidence': 'inferred', 'precision': 'day',
                'start_lower_bound': start.isoformat(), 'start_upper_bound': end.isoformat(),
                'rationale': 'No activation was logged. Estimated at earliest documented existence; work could have begun at any time before the recorded completion.'}
        facts[task['id']].append({'created_at': start, 'started_at': start, 'info': info})

    proposals = []
    for task in tasks:
        original = task.get('date_provenance') or {}
        provenance, values = dict(original), {}
        historical = bool((task.get('source_metadata') or {}).get('migration_run_id'))
        for key in FIELDS:
            current, prior = task.get(key), original.get(key, {})
            if prior.get('source') in ('admin', 'observed', 'recorded'):
                continue
            # Native creation and real status transitions take precedence over estimates.
            import_birth = key == 'created_at' and historical and prior.get('source', '').split(':')[0] in ('canonical_revision', 'existing', 'import')
            if current and (key == 'due_date' or not historical or prior.get('confidence') == 'recorded') and not import_birth:
                continue
            if key == 'completed_at' and task['status'] not in ('done', 'archived'):
                continue
            choices = [f for f in facts[task['id']] if f.get(key)]
            if not choices:
                continue
            fact = (max if key == 'completed_at' else min)(choices, key=lambda f: f[key])
            value = fact[key].isoformat() if key == 'due_date' else day_stamp(fact[key]).isoformat()
            if current and (date.fromisoformat(current) if key == 'due_date' else instant(current).date()) <= fact[key]:
                continue
            values[key] = value
            provenance[key] = {**fact['info'], 'previous_value': iso(current)}
        created = instant(values.get('created_at', task.get('created_at')))
        started = instant(values.get('started_at', task.get('started_at')))
        completed = instant(values.get('completed_at', task.get('completed_at')))
        # Do not revise a recorded birth or activation just to fit an estimate.
        if started and created and started < created:
            if 'started_at' in values and provenance['started_at'].get('precision') == 'day' and started.date() == created.date():
                values['started_at'] = created.isoformat()
                started = created
            else:
                values.pop('started_at', None)
                provenance['started_at'] = original.get('started_at', {})
                started = instant(task.get('started_at'))
        if completed and ((started and completed < started) or (created and completed < created)):
            floor = max(value for value in (started, created) if value)
            if 'completed_at' in values and provenance['completed_at'].get('precision') == 'day' and completed.date() == floor.date():
                values['completed_at'] = floor.isoformat()
            else:
                values.pop('completed_at', None)
                provenance['completed_at'] = original.get('completed_at', {})
        for key in list(provenance):
            if not provenance[key]:
                del provenance[key]
        if values:
            proposals.append({'task_id': task['id'], 'values': values, 'date_provenance': provenance})
    return proposals


def recover_document_dates(*, apps=None, using='default', apply=False, supplements=None):
    if apps is None:
        from django.apps import apps
    from django.db.models import F
    from django.utils import timezone as django_timezone
    Task = apps.get_model('core', 'OperatingTask')
    qs = Task.objects.using(using).order_by('pk')
    if apply:
        qs = qs.select_for_update()
    tasks = list(qs.values('id', 'workspace_id', 'project_id', 'parent_id', 'title', 'status', 'updated_at',
        'source_key', 'source_metadata', 'date_provenance', *FIELDS))
    for task in tasks:
        for key in (*FIELDS, 'updated_at'):
            task[key] = iso(task[key])
    if supplements is None:
        supplements = load_supplements(tasks)
    proposals = propose_document_dates(tasks, supplements)
    counts = Counter(total=len(tasks), changed=len(proposals))
    by_id = {t['id']: t for t in tasks}
    for proposal in proposals:
        task = by_id[proposal['task_id']]
        values = proposal['values']
        for key in values:
            counts['recovered_' + key] += 1
        if apply:
            Task.objects.using(using).filter(pk=task['id']).update(**values, date_provenance=proposal['date_provenance'])
            Activity = apps.get_model('core', 'ActivityEvent')
            Activity.objects.using(using).create(layer='core', action='task.dates_inferred', object_type='operating_task',
                object_id=str(task['id']), detail={'fields': sorted(values), 'precision': 'day', 'source': 'document_date_recovery_v1',
                    'previous': {key: task[key] for key in values}, 'estimates': values})
            if task['project_id']:
                Canonical = apps.get_model('core', 'CanonicalProject')
                Outbox = apps.get_model('core', 'CanonicalTaskSyncOutbox')
                if Canonical.objects.using(using).filter(project_id=task['project_id'], enabled=True).exists():
                    job, _ = Outbox.objects.using(using).get_or_create(project_id=task['project_id'], task_id=task['id'],
                        defaults={'next_attempt_at': django_timezone.now()})
                    Outbox.objects.using(using).filter(pk=job.pk).update(generation=F('generation') + 1,
                        state='pending', attempts=0, next_attempt_at=django_timezone.now(), last_error='')
        task.update(values)
    for task in tasks:
        for key in FIELDS:
            if not task.get(key):
                counts['missing_' + key] += 1
    return dict(counts)
