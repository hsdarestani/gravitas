"""Evidence-based execution metrics, using calendar time rather than labor time.

Unknown gaps remain explicit segments. Observations and forecasts are separate
from plans; updated_at and sync traffic never become human work evidence.
These functions have no database or network side effects.
"""
from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
from statistics import mean, median
from zoneinfo import ZoneInfo

DAY = 86400
ACTIVE = {'active', 'retest'}
WAITING = {'draft', 'ready', 'waiting', 'needs_review'}
TERMINAL = {'done', 'archived'}
DEFINITIONS = {
    'open': 'Tasks whose canonical status is neither done nor archived.',
    'active': 'Tasks in active or retest status; this does not imply continuous labor.',
    'completed': 'Tasks in done status, plus archived tasks with recorded completion.',
    'blocked': 'Tasks explicitly in blocked status.',
    'stalled': 'Open tasks with no recorded meaningful human activity for the configured business-day threshold. Unknown activity is excluded.',
    'cycle_seconds': 'Calendar elapsed time from first recorded active transition to completion. Open elapsed cycle time is reported separately.',
    'active_seconds': 'Sum of known active-state intervals; calendar time, not labor hours. Unknown history is excluded.',
    'blocked_seconds': 'Sum of known explicitly blocked intervals; unknown history is excluded.',
    'work_seconds': 'Union of recorded work intervals per person, summed across people. Concurrent work by different people is separate effort.',
    'waiting_seconds': 'Sum of known draft, ready, waiting or needs-review intervals.',
    'lead_seconds': 'Calendar time from creation to completion; open lead time is elapsed, not final.',
    'inactivity_seconds': 'Calendar time since the last recorded meaningful human event. Background sync and updated_at are excluded.',
    'schedule_variance_days': 'Local calendar completion date minus due date. Open overdue days are elapsed lateness, not a forecast.',
    'at_risk_milestones': 'Milestones with an overdue target or unfinished linked work that is blocked, stalled, overdue, or has an unresolved predecessor.',
}


def instant(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    try:
        result = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result
    except (ValueError, TypeError):
        return None


def iso(value):
    return value.isoformat() if value else None


def business_days(start, end, zone='UTC', weekdays=None):
    weekdays = set([0, 1, 2, 3, 4] if weekdays is None else weekdays)
    a, b = start.astimezone(ZoneInfo(zone)).date(), end.astimezone(ZoneInfo(zone)).date()
    days = max(0, (b - a).days)
    weeks, remainder = divmod(days, 7)
    return weeks * len(weekdays) + sum((a.weekday() + i + 1) % 7 in weekdays for i in range(remainder))


def normalize_event(event):
    detail = event.get('detail') or {}
    if not isinstance(detail, dict):
        detail = {}
    changes = detail.get('changes') or {}
    if not isinstance(changes, dict):
        changes = {}
    if not changes and isinstance(detail.get('previous'), dict):
        changes = {key: {'from': value, 'to': (detail.get('current') or {}).get(key)} for key, value in detail['previous'].items()
                   if key in (detail.get('current') or {})}
    action = event.get('action', '')
    if not changes and detail.get('to_status'):
        changes = {'status': {'from': detail.get('from_status'), 'to': detail['to_status']}}
    source = detail.get('source') or ('nextcloud' if any(x in action for x in ('sync', 'import', 'mirror')) else 'human' if event.get('actor_id') else 'system')
    human_actions = ('task.created', 'task.updated', 'task_created', 'task_updated',
                     'task.comment', 'task.checklist', 'task.daily_report', 'task.moved', 'task.lifecycle', 'task.work_log', 'task.schedule_changed')
    meaningful = (source == 'human' and bool(event.get('actor_id')) and action.startswith(human_actions)
                  and (action not in ('task.updated', 'task_updated', 'task.lifecycle') or bool(changes)))
    return {**event, 'detail': detail, 'changes': changes, 'source': source,
            'human': meaningful, 'at': instant(event.get('created_at'))}


def task_metrics(task, raw_events, now, config, work_entries=None, plan=None):
    created, started, completed = (instant(task.get(key)) for key in ('created_at', 'started_at', 'completed_at'))
    events = sorted([e for e in map(normalize_event, raw_events) if e['at'] and e['at'] <= now], key=lambda e: (e['at'], str(e.get('id', ''))))
    open_task = task['status'] not in TERMINAL
    transitions = []
    human = []
    for event in events:
        if event['human']:
            human.append(event['at'])
        change = event['changes'].get('status')
        if isinstance(change, dict) and change.get('to'):
            transitions.append((event['at'], change.get('from'), change['to'], event['source']))
        elif event['action'] in ('task.created', 'task_created') and event['detail'].get('status'):
            transitions.append((event['at'], None, event['detail']['status'], event['source']))
    # Identical audit records emitted by the model and the API are one state
    # transition. Out-of-order ingestion is sorted by the recorded timestamp.
    unique = []
    for transition in transitions:
        if unique and unique[-1][2] == transition[2]:
            continue
        unique.append(transition)
    transitions = unique
    if not open_task and not completed and task['status'] == 'done':
        completed = next((at for at, _, state, _ in reversed(transitions) if state == 'done'), None)
    provenance = task.get('date_provenance') or {}
    completion_estimated = provenance.get('completed_at', {}).get('confidence') in ('inferred', 'earliest_known')
    endpoint = completed if completed and not open_task and not completion_estimated else now if open_task else None
    if endpoint and created and endpoint < created:
        endpoint = None
    precise_start = started and provenance.get('started_at', {}).get('confidence') not in ('inferred', 'earliest_known')
    segments = []
    cursor = created
    state = 'unknown'
    reopen_count = 0
    last_state = None
    def segment(a, b, value, source):
        if a and b and b > a:
            kind = 'active' if value in ACTIVE else 'waiting' if value in WAITING else 'blocked' if value == 'blocked' else 'completed' if value == 'done' else 'unknown'
            segments.append({'start': iso(a), 'end': iso(b), 'state': kind, 'status': value,
                             'seconds': (b - a).total_seconds(), 'source': source})
    source = 'not_recorded'
    for at, before, after, origin in transitions:
        if created and at < created:
            continue
        if endpoint and at > endpoint:
            continue
        segment(cursor, at, state, source)
        if (last_state == 'done' or before == 'done') and after not in TERMINAL:
            reopen_count += 1
        last_state, state, cursor, source = after, after, at, origin
    # A current snapshot contradicting the last recorded state means the
    # boundary is missing. Do not project that obsolete state up to today.
    if transitions and state != task['status'] and open_task:
        state, source = 'unknown', 'missing_transition'
    segment(cursor, endpoint, state, source)
    durations = defaultdict(float)
    for part in segments:
        durations[part['state']] += part['seconds']
    known = sum(value for key, value in durations.items() if key != 'unknown')
    total = sum(durations.values())
    last_human = max(human) if human else None
    inactivity_end = endpoint or now
    inactivity = max(0, (inactivity_end - last_human).total_seconds()) if last_human else None
    business_age = business_days(last_human, inactivity_end, config['timezone'], config['business_weekdays']) if last_human else None
    zone = ZoneInfo(config['timezone'])
    today = now.astimezone(zone).date()
    due = instant(task.get('due_date'))
    actual_day = completed.astimezone(zone).date() if completed and not open_task else today
    variance = (actual_day - due.date()).days if due else None
    # Deduplicate/union overlapping recorded intervals per actor, preserving
    # effort from different actors. Clip only overlapping entries, not timers.
    work = None
    if work_entries is not None:
        by_owner = defaultdict(list)
        for entry in work_entries:
            a, b = instant(entry.get('start')), instant(entry.get('end'))
            if a and b and b > a:
                by_owner[entry.get('owner_id')].append((a, b))
        work = 0
        for intervals in by_owner.values():
            end = None
            for a, b in sorted(intervals):
                work += max(0, (b - max(a, end or a)).total_seconds())
                end = max(end or b, b)
    first_active = min([at for at, _, status, _ in transitions if status in ACTIVE] + ([started] if precise_start and started <= now else []), default=None)
    # Creating/queuing a task is human activity, but is not its first work
    # action. An explicitly active creation can establish both at once.
    def is_work_action(event):
        change = event['changes'].get('status')
        change = change if isinstance(change, dict) else {}
        if change.get('to') in ACTIVE:
            return True
        initial_status = event['action'] == 'task.lifecycle' and change.get('from') is None and change.get('to')
        return event['action'] not in ('task.created', 'task_created') and not event['detail'].get('initial_observation') and not initial_status
    first_action = min((e['at'] for e in events if e['human'] and is_work_action(e)), default=None)
    lifecycle_known = bool(transitions)
    finished = bool(not open_task and completed and not completion_estimated)
    return {
        'segments': segments,
        'lead_seconds': (completed - created).total_seconds() if finished and created and completed >= created else None,
        'elapsed_lead_seconds': max(0, (now - created).total_seconds()) if open_task and created else None,
        'cycle_seconds': (completed - first_active).total_seconds() if finished and first_active and completed >= first_active else None,
        'elapsed_cycle_seconds': max(0, (now - first_active).total_seconds()) if open_task and first_active else None,
        'active_seconds': durations['active'] if lifecycle_known else None,
        'waiting_seconds': durations['waiting'] if lifecycle_known else None,
        'blocked_seconds': durations['blocked'] if lifecycle_known else None,
        'unknown_seconds': durations['unknown'], 'work_seconds': work,
        'last_human_activity': iso(last_human), 'inactivity_seconds': inactivity,
        'inactivity_business_days': business_age,
        'stalled': bool(open_task and business_age is not None and business_age >= config['inactivity_business_days']),
        'overdue': bool(open_task and due and due.date() < today),
        'finished_late': bool(finished and variance is not None and variance > 0),
        'schedule_variance_days': variance,
        'first_active_at': iso(first_active), 'completed_at': iso(completed),
        'completion_estimated': completion_estimated,
        'lead_estimated': provenance.get('created_at', {}).get('confidence') in ('inferred', 'earliest_known'),
        'reopen_count': reopen_count,
        'time_to_first_action_seconds': max(0, (first_action - created).total_seconds()) if first_action and created else None,
        'planned_seconds': (instant(plan['end_date']) - instant(plan['start_date'])).total_seconds() if plan else None,
        'history_coverage': round(known / total, 3) if total else None,
        'history_quality': 'partial' if durations['unknown'] or not lifecycle_known else 'recorded_since_first_observation',
        'forecast': None, 'forecast_confidence': 'unavailable',
        'forecast_explanation': 'Insufficient historical data for a reliable forecast.',
        'events': [{key: value for key, value in e.items() if key not in ('at',)} for e in events[-200:]],
        'event_count': len(events),
    }


def annotate_graph(tasks, milestones, now, zone='UTC'):
    """Leaf-only rollups avoid counting a parent and its children twice."""
    by_id = {t['id']: t for t in tasks}
    complete = lambda task: task['status'] == 'done' or task['status'] == 'archived' and bool(task['execution']['completed_at'])
    children, downstream = defaultdict(list), defaultdict(list)
    for task in tasks:
        if task.get('parent_id') in by_id:
            children[task['parent_id']].append(task['id'])
        if task.get('dependency_id') in by_id:
            downstream[task['dependency_id']].append(task['id'])
    def descendants(root, edges):
        seen, pending = set(), list(edges[root])
        while pending:
            item = pending.pop()
            if item not in seen and item != root:
                seen.add(item)
                pending.extend(edges[item])
        return seen
    for task in tasks:
        analytics = task['execution']
        descendants_ids = descendants(task['id'], children)
        leaves = [by_id[pk] for pk in descendants_ids if not children[pk]]
        analytics['unresolved_dependencies'] = [task['dependency_id']] if task.get('dependency_id') in by_id and not complete(by_id[task['dependency_id']]) else []
        analytics['downstream_ids'] = sorted(descendants(task['id'], downstream))
        analytics['descendant_ids'] = sorted(descendants_ids)
        if leaves:
            weight = sum(t.get('execution_weight') or 1 for t in leaves)
            starts = [instant(t.get('started_at')) for t in leaves if t.get('started_at')]
            ends = [instant(t['execution'].get('completed_at')) for t in leaves if t['execution'].get('completed_at')]
            analytics['rollup'] = {
                'leaf_count': len(leaves), 'completed': sum(complete(t) for t in leaves),
                'active': sum(t['status'] in ACTIVE for t in leaves), 'blocked': sum(t['status'] == 'blocked' for t in leaves),
                'stalled': sum(t['execution']['stalled'] for t in leaves),
                'progress': sum((t.get('execution_weight') or 1) for t in leaves if complete(t)) / weight,
                'earliest_start': iso(min(starts)) if starts else None,
                'latest_completion': iso(max(ends)) if ends else None,
                'unfinished_ids': [t['id'] for t in leaves if not complete(t)],
            }
        else:
            analytics['rollup'] = None
    today = now.astimezone(ZoneInfo(zone)).date()
    milestone_results = []
    for milestone in milestones:
        linked = {t['id'] for t in tasks if t.get('milestone_id') == milestone['id']}
        for pk in list(linked):
            linked.update(descendants(pk, children))
        leaves = [by_id[pk] for pk in linked if not any(child in linked for child in children[pk])]
        unfinished = [t for t in leaves if not complete(t)]
        factors = []
        for task in unfinished:
            a = task['execution']
            reasons = [label for yes, label in ((task['status'] == 'blocked', 'explicitly blocked'),
                       (a['stalled'], 'inactive'), (a['overdue'], 'overdue'),
                       (bool(a['unresolved_dependencies']), 'unresolved predecessor')) if yes]
            if reasons:
                factors.append({'task_id': task['id'], 'reasons': reasons})
        target = instant(milestone.get('due_date'))
        completed = milestone['status'] == 'done'
        delayed = bool(not completed and target and target.date() < today)
        status = 'completed' if completed else 'delayed' if delayed else 'at_risk' if factors else 'on_track' if leaves else 'planned'
        total_weight = sum(t.get('execution_weight') or 1 for t in leaves)
        progress = sum(t.get('execution_weight') or 1 for t in leaves if complete(t)) / total_weight if total_weight else None
        milestone_results.append({**milestone, 'delivery_status': status, 'progress': progress,
                                  'weight_basis': 'Explicit task weight, otherwise 1 per leaf task; parents are excluded.',
                                  'task_ids': sorted(linked), 'critical_task_ids': [x['task_id'] for x in factors],
                                  'unfinished_ids': [t['id'] for t in unfinished], 'risk_factors': factors,
                                  'forecast': None, 'forecast_confidence': 'unavailable',
                                  'forecast_explanation': 'Insufficient historical data for a reliable forecast.',
                                  'completed_at': milestone.get('completed_at')})
    for task in tasks:
        a = task['execution']
        impacted = [m['id'] for m in milestone_results if task['id'] in m['task_ids'] or any(pk in m['task_ids'] for pk in a['downstream_ids'])]
        a['milestone_ids'] = impacted
        # Bounded, visible components; unavailable measurements contribute zero.
        components = {'blocked': min(1, (a['blocked_seconds'] or 0) / (7 * DAY)) * 25,
                      'inactivity': min(1, (a['inactivity_business_days'] or 0) / 10) * 20,
                      'deadline': (1 if a['overdue'] else .5 if task.get('due_date') and 0 <= (instant(task['due_date']).date() - today).days <= 7 else 0) * 20,
                      'downstream': min(1, len(a['downstream_ids']) / 10) * 15,
                      'milestones': (1 if impacted else 0) * 10,
                      'priority': {'p0': 10, 'p1': 7, 'p2': 3, 'p3': 0}.get(task['priority'], 0)}
        a['bottleneck_components'] = {key: round(value, 1) for key, value in components.items()}
        a['bottleneck_score'] = round(sum(components.values()), 1) if task['status'] not in TERMINAL else 0
        if task['status'] in TERMINAL:
            a['bottleneck_components'] = {key: 0 for key in components}
        a['diagnostics'] = []
        if a['stalled']:
            a['diagnostics'].append(f"No recorded human activity for {a['inactivity_business_days']} business days.")
        if task['status'] == 'blocked':
            a['diagnostics'].append('Explicitly blocked' + (': ' + task.get('blocked_reason', '') if task.get('blocked_reason') else '; no blocker reason recorded.'))
        if a['unresolved_dependencies']:
            a['diagnostics'].append('An unfinished predecessor is recorded; review it before scheduling dependent work.')
        if a['rollup'] and a['rollup']['unfinished_ids']:
            a['diagnostics'].append(f"{len(a['rollup']['unfinished_ids'])} leaf subtasks remain unfinished.")
        if a['history_quality'] == 'partial':
            a['diagnostics'].append('Historical state coverage is partial. Unknown gaps are excluded from state durations.')
    return milestone_results


def summarize(tasks, milestones):
    analytics = [t['execution'] for t in tasks]
    cycle = [a['cycle_seconds'] for a in analytics if a['cycle_seconds'] is not None]
    due_completed = [a for a in analytics if a['cycle_seconds'] is not None and a['schedule_variance_days'] is not None]
    projects = defaultdict(list)
    for task in tasks:
        projects[task.get('project_id')].append(task)
    return {'open': sum(t['status'] not in TERMINAL for t in tasks),
            'active': sum(t['status'] in ACTIVE for t in tasks),
            'completed': sum(t['status'] == 'done' or t['status'] == 'archived' and bool(t['execution']['completed_at']) for t in tasks),
            'blocked': sum(t['status'] == 'blocked' for t in tasks),
            'stalled': sum(a['stalled'] for a in analytics),
            'cycle_seconds': mean(cycle) if cycle else None,
            'median_cycle_seconds': median(cycle) if cycle else None,
            'cycle_sample_size': len(cycle),
            'blocked_seconds': sum(a['blocked_seconds'] or 0 for a in analytics) if any(a['blocked_seconds'] is not None for a in analytics) else None,
            'at_risk_milestones': sum(m['delivery_status'] in ('at_risk', 'delayed') for m in milestones),
            'on_time_rate': sum(a['schedule_variance_days'] <= 0 for a in due_completed) / len(due_completed) if due_completed else None,
            'projects': [{'id': pk, 'title': rows[0].get('project_title') or 'Unassigned',
                          'open': sum(t['status'] not in TERMINAL for t in rows),
                          'blocked': sum(t['status'] == 'blocked' for t in rows),
                          'stalled': sum(t['execution']['stalled'] for t in rows),
                          'median_cycle_seconds': median([t['execution']['cycle_seconds'] for t in rows if t['execution']['cycle_seconds'] is not None]) if any(t['execution']['cycle_seconds'] is not None for t in rows) else None}
                         for pk, rows in projects.items()]}


def apply_forecasts(tasks, milestones, now, zone='UTC'):
    """Small-cohort calendar forecasts only when recorded evidence supports it.

    Compare completed tasks in the same project and priority, requiring eight
    samples with at least 80% known state coverage. This is an empirical median
    with an interquartile range, not a promised date or a critical-path model.
    Already-aged work, blockage and unresolved predecessors remain unforecast.
    """
    cohorts = defaultdict(list)
    for task in tasks:
        a = task['execution']
        if a['cycle_seconds'] is not None and (a['history_coverage'] or 0) >= .8:
            cohorts[task.get('project_id'), task['priority']].append(a['cycle_seconds'])
    by_id = {t['id']: t for t in tasks}
    for task in tasks:
        a = task['execution']
        if task['status'] in TERMINAL or task['status'] == 'blocked' or a['unresolved_dependencies'] or a['rollup'] or not a['first_active_at']:
            continue
        samples = sorted(cohorts[task.get('project_id'), task['priority']])
        if len(samples) < 8:
            continue
        typical = median(samples)
        elapsed = (now - instant(a['first_active_at'])).total_seconds()
        if elapsed >= typical:
            a['forecast_explanation'] = 'This task has exceeded the comparable cohort median; remaining duration cannot be inferred.'
            continue
        low, high = samples[len(samples) // 4], samples[min(len(samples) - 1, 3 * len(samples) // 4)]
        a.update(forecast=iso(instant(a['first_active_at']) + timedelta(seconds=typical)),
                 forecast_range=[iso(max(now, instant(a['first_active_at']) + timedelta(seconds=low))),
                                 iso(instant(a['first_active_at']) + timedelta(seconds=high))],
                 forecast_confidence='limited', forecast_sample_size=len(samples),
                 forecast_explanation=f'Calendar-cycle median of {len(samples)} completed tasks in the same project and priority; range is the cohort interquartile range. Task size may differ.')
    for milestone in milestones:
        unfinished = [by_id[pk]['execution'] for pk in milestone['unfinished_ids']]
        if unfinished and all(a.get('forecast') for a in unfinished):
            milestone['forecast'] = max(a['forecast'] for a in unfinished)
            milestone['forecast_confidence'] = 'limited'
            milestone['forecast_explanation'] = 'Latest comparable-task forecast among unfinished linked leaves, assuming parallel work. This is not a calculated critical path.'
            target = instant(milestone.get('due_date'))
            if target and instant(milestone['forecast']).astimezone(ZoneInfo(zone)).date() > target.date() and milestone['delivery_status'] not in ('completed', 'delayed'):
                milestone['delivery_status'] = 'at_risk'
                milestone['risk_factors'].append({'task_id': max(milestone['unfinished_ids'], key=lambda pk: by_id[pk]['execution']['forecast']), 'reasons': ['limited-confidence historical forecast exceeds target']})
