"""ACL-scoped analytics over committed task projections, without sync side effects.

One bulk read supplies Timeline, diagnostics, milestones and bottlenecks.
Canonical Markdown schedule/work-log adapters are reused. Unknown or invalid
source data is reported explicitly rather than replaced with invented values.
"""
import json
from collections import defaultdict
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from . import operating_api as base
from .execution_analytics import DEFINITIONS, annotate_graph, apply_forecasts, summarize, task_metrics
from .execution_models import ExecutionSettings
from .layer_models import ActivityEvent
from .models import KnowledgeResource, ResearchProject
from .operating_models import OperatingMilestone, OperatingTask, OperatingTaskConsolidation
from .platform_access import access_batch, access_flags, can_view
from .platform_models import ProjectAuditEvent
from .task_board_api import _error, _person, _readonly_task_workspace, _task_json
from .workspace_api import _can_manage_workspace


def configuration(workspace):
    row = ExecutionSettings.objects.filter(workspace=workspace).first()
    return {'timezone': row.timezone if row else 'UTC',
            'inactivity_business_days': row.inactivity_business_days if row else 3,
            'business_weekdays': (row.business_weekdays or [0, 1, 2, 3, 4]) if row else [0, 1, 2, 3, 4],
            'holidays': 'Not configured; business-day calculations use the selected weekdays.',
            'updated_at': row.updated_at.isoformat() if row else None}


@require_http_methods(['GET', 'PATCH'])
def execution_settings(request):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    workspace = _readonly_task_workspace(request)
    if not workspace:
        return _error('core_workspace_required', 403)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'config': configuration(workspace), 'can_manage': _can_manage_workspace(request.user, workspace)})
    if not _can_manage_workspace(request.user, workspace):
        return _error('permission_denied', 403)
    try:
        data = json.loads(request.body)
        if not isinstance(data, dict) or set(data) - {'timezone', 'inactivity_business_days', 'business_weekdays', 'expected_updated_at'}:
            raise ValueError()
        current = configuration(workspace)
        zone = data.get('timezone', current['timezone'])
        ZoneInfo(zone)
        threshold = data.get('inactivity_business_days', current['inactivity_business_days'])
        weekdays = data.get('business_weekdays', current['business_weekdays'])
        if type(threshold) is not int or not 1 <= threshold <= 90 or not isinstance(weekdays, list) or not weekdays or len(set(weekdays)) != len(weekdays) or any(type(x) is not int or x not in range(7) for x in weekdays):
            raise ValueError()
    except (ValueError, TypeError, KeyError, ZoneInfoNotFoundError):
        return _error('invalid_execution_calendar')
    with transaction.atomic():
        # Lock the existing workspace even before the first configuration row.
        type(workspace).objects.select_for_update().get(pk=workspace.pk)
        current = configuration(workspace)
        if 'expected_updated_at' in data and data['expected_updated_at'] != current['updated_at']:
            return _error('execution_settings_changed_elsewhere', 409)
        row, _ = ExecutionSettings.objects.update_or_create(workspace=workspace, defaults={
            'timezone': zone, 'inactivity_business_days': threshold, 'business_weekdays': sorted(weekdays)})
        ActivityEvent.objects.create(layer='core', action='execution.calendar_changed', actor=request.user,
            object_type='workspace', object_id=str(workspace.pk), detail={'previous': current, 'current': configuration(workspace)})
    return JsonResponse({'ok': True, 'config': configuration(workspace)})


@require_http_methods(['POST'])
def execution_schedule(request):
    """Unassigned Core work uses the same canonical Markdown plan format."""
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    workspace = _readonly_task_workspace(request)
    if not workspace:
        return _error('core_workspace_required', 403)
    from .platform_access import can_edit, policy_for, INHERIT_VISIBILITY
    from .project_schedule_api import HEADER, DIVIDER, _parse
    from django.utils.dateparse import parse_date
    try:
        data = json.loads(request.body)
        if not isinstance(data, dict) or set(data) - {'task_id', 'start_date', 'end_date', 'estimated_minutes', 'expected_updated_at'}:
            raise ValueError()
        tid, minutes = data['task_id'], data['estimated_minutes']
        start, end = parse_date(data['start_date']), parse_date(data['end_date'])
        if type(tid) is not int or type(minutes) is not int or not 0 <= minutes <= 525600 or not start or not end or not 0 <= (end - start).days <= 366:
            raise ValueError()
    except (KeyError, ValueError, TypeError):
        return _error('invalid_schedule_interval')
    with transaction.atomic():
        task = OperatingTask.objects.select_for_update().filter(pk=tid, workspace=workspace, project__isnull=True).first()
        if task is None or not can_edit(request.user, task) or not base._editable(request, workspace):
            return _error('task_edit_required', 403)
        notes = list(KnowledgeResource.objects.select_for_update().filter(workspace=workspace, project__isnull=True,
            metadata__pm_type='task_schedule_v1', metadata__task_id=tid).order_by('pk'))
        if len(notes) > 1:
            return _error('duplicate_task_schedule_requires_review', 409)
        note = notes[0] if notes else KnowledgeResource(workspace=workspace, owner=request.user, kind='note',
            title=f'Schedule · task #{tid}', metadata={'pm_type': 'task_schedule_v1', 'task_id': tid})
        if notes and not can_edit(request.user, note):
            return _error('schedule_edit_required', 403)
        revision = note.updated_at.isoformat() if notes else None
        if 'expected_updated_at' in data and data['expected_updated_at'] != revision:
            return _error('schedule_changed_elsewhere', 409)
        before = note.body
        note.body = f'# Schedule for task #{tid}\n\n{HEADER}\n{DIVIDER}\n| {start} | {end} | {minutes} |\n'
        note.save()
        if not notes:
            policy_for(note, create=True, created_by=request.user, default_visibility=INHERIT_VISIBILITY)
        ActivityEvent.objects.create(layer='core', action='task.schedule_changed', actor=request.user,
            object_type='operating_task', object_id=str(tid), detail={'source': 'human', 'changes': {'schedule': {'from': before, 'to': note.body}}})
    return JsonResponse({'ok': True, 'schedule': {**_parse(note), 'updated_at': note.updated_at.isoformat()}})


@require_http_methods(['GET'])
def execution_dashboard(request, project_id=None):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project = None
    if project_id is not None:
        project = ResearchProject.objects.select_related('workspace').filter(pk=project_id, archived=False).first()
        if not project or not can_view(request.user, project):
            return _error('not_found', 404)
        queryset = OperatingTask.objects.filter(project=project)
    else:
        workspace = _readonly_task_workspace(request)
        if not workspace:
            return _error('core_workspace_required', 403)
        queryset = OperatingTask.objects.filter(workspace=workspace)
    models = list(queryset.exclude(pk__in=OperatingTaskConsolidation.objects.values('source_id')).select_related(
        'workspace', 'owner', 'initiative__process', 'initiative__key_result__objective',
        'milestone', 'work_package', 'cycle', 'project__workspace', 'meeting', 'dependency').order_by('board_order', 'pk'))
    with access_batch(request.user, models):
        visible = [(obj, access_flags(request.user, obj)) for obj in models if can_view(request.user, obj)]
    if project:
        # Project tasks still belong to the existing Core execution workspace.
        workspace = models[0].workspace if models else None
        if workspace is None:
            from .platform_runtime_v3 import _canonical_workspace
            workspace = _canonical_workspace('core')
    config = configuration(workspace) if workspace else {'timezone': 'UTC', 'business_weekdays': [0, 1, 2, 3, 4], 'inactivity_business_days': 3, 'updated_at': None}
    now = timezone.now()
    visible_ids = {obj.pk for obj, _ in visible}
    id_strings = [str(pk) for pk in visible_ids]
    events = defaultdict(list)
    for model, origin in ((ActivityEvent, 'activity'), (ProjectAuditEvent, 'project_audit')):
        rows = model.objects.filter(object_type__in=('operating_task', 'OperatingTask', 'task'), object_id__in=id_strings)
        if model is ActivityEvent:
            rows = rows.filter(layer='core')
        else:
            rows = rows.filter(project_id__in={obj.project_id for obj, _ in visible if obj.project_id})
        for event in rows.order_by('created_at', 'pk').values('id', 'object_id', 'action', 'detail', 'actor_id', 'created_at').iterator(chunk_size=2000):
            event['id'] = f"{origin}:{event['id']}"
            event['created_at'] = event['created_at'].isoformat()
            # Raw private report bodies are never included in this endpoint.
            detail = event['detail'] if isinstance(event['detail'], dict) else {}
            detail = {key: detail[key] for key in ('changes', 'status', 'from_status', 'to_status', 'source', 'meaningful_human', 'initial_observation', 'observed_at', 'title', 'blocked_reason') if key in detail}
            changes = detail.get('changes')
            if isinstance(changes, dict):
                changes = dict(changes)
                for key in ('parent_id', 'dependency_id'):
                    change = changes.get(key)
                    if isinstance(change, dict) and any(value is not None and value not in visible_ids for value in change.values()):
                        changes.pop(key, None)
                detail['changes'] = changes
            event['detail'] = detail
            events[int(event['object_id'])].append(event)
    plans, logs, source_issues = {}, {}, defaultdict(list)
    if visible_ids:
        notes = list(KnowledgeResource.objects.filter(metadata__pm_type__in=['task_schedule_v1', 'task_time_log_v1'],
            metadata__task_id__in=list(visible_ids)).select_related('workspace', 'project__workspace', 'collection', 'owner').order_by('pk'))
        from .project_schedule_api import _parse as parse_schedule
        from .project_time_log import _parse as parse_work
        with access_batch(request.user, notes):
            for note in notes:
                tid = note.metadata.get('task_id')
                if tid not in visible_ids or not can_view(request.user, note):
                    continue
                try:
                    if note.metadata['pm_type'] == 'task_schedule_v1':
                        if tid in plans:
                            plans[tid] = None
                            source_issues[tid].append('Duplicate schedules require review; planned dates unavailable.')
                        else:
                            plans[tid] = {**parse_schedule(note), 'updated_at': note.updated_at.isoformat()}
                    else:
                        entries = parse_work(note)
                        if tid not in logs:
                            logs[tid] = []
                        if logs[tid] is not None:
                            logs[tid].extend(entries)
                        for entry in entries:
                            events[tid].append({'id': f"work:{note.pk}:{entry['end']}", 'created_at': entry['end'],
                                'actor_id': note.owner_id, 'action': 'task.work_log', 'detail': {'source': 'human'}})
                except (ValueError, TypeError, KeyError):
                    source_issues[tid].append('Invalid canonical schedule or work log; affected metrics unavailable.')
                    if note.metadata['pm_type'] == 'task_time_log_v1':
                        logs[tid] = None
    task_rows = []
    for obj, flags in visible:
        task = {**_task_json(obj), **flags, 'execution_weight': obj.execution_weight}
        for field in ('parent_id', 'dependency_id'):
            if task[field] not in visible_ids:
                task[field] = None
                if field == 'dependency_id':
                    task['dependency_title'] = ''
        plan = plans.get(obj.pk)
        task['execution'] = task_metrics(task, events[obj.pk], now, config, logs.get(obj.pk), plan)
        task['execution']['source_issues'] = source_issues[obj.pk]
        task['execution']['plan'] = plan
        # The bulk response stays bounded per task. Selected-task reads expose
        # the last 200 authorized events without a per-row request waterfall.
        if str(obj.pk) != request.GET.get('task_id'):
            task['execution']['events'] = task['execution']['events'][-12:]
        task_rows.append(task)
    milestone_qs = OperatingMilestone.objects.filter(project=project) if project else OperatingMilestone.objects.filter(workspace=workspace)
    milestone_models = list(milestone_qs.select_related('workspace', 'owner', 'project__workspace', 'initiative__key_result'))
    milestone_rows = []
    with access_batch(request.user, milestone_models):
        for item in milestone_models:
            if not can_view(request.user, item):
                continue
            milestone_rows.append({'id': item.pk, 'title': item.title, 'project_id': item.project_id,
                'due_date': item.due_date.isoformat() if item.due_date else None, 'status': item.status,
                'description': item.definition_of_done, 'owner': _person(item.owner), 'updated_at': item.updated_at.isoformat(),
                'key_result_id': item.initiative.key_result_id, **access_flags(request.user, item)})
    milestone_ids = {m['id'] for m in milestone_rows}
    completion_events = ActivityEvent.objects.filter(object_type='operating_milestone',
        object_id__in=[str(pk) for pk in milestone_ids], action='milestone.lifecycle').order_by('created_at', 'pk')
    completed_dates = {}
    for event in completion_events:
        change = (event.detail or {}).get('changes', {}).get('status', {})
        if change.get('to') == 'done':
            completed_dates[int(event.object_id)] = event.created_at.isoformat()
        elif change.get('to') and change['to'] != 'archived':
            completed_dates.pop(int(event.object_id), None)
    for milestone in milestone_rows:
        milestone['completed_at'] = completed_dates.get(milestone['id'])
    for task in task_rows:
        if task['milestone_id'] not in milestone_ids:
            task['milestone_id'], task['milestone_title'] = None, ''
    milestones = annotate_graph(task_rows, milestone_rows, now, config['timezone'])
    apply_forecasts(task_rows, milestones, now, config['timezone'])
    response = JsonResponse({'ok': True, 'as_of': now.isoformat(), 'source': 'committed_database_snapshot',
        'workspace_id': workspace.pk if workspace else None, 'project_id': project_id,
        'config': config, 'definitions': DEFINITIONS, 'tasks': task_rows, 'milestones': milestones,
        'summary': summarize(task_rows, milestones),
        'can_manage': _can_manage_workspace(request.user, workspace) if workspace else False,
        'history_notice': 'Only recorded state intervals are counted. Unknown history and missing human activity remain unavailable. Active-state time is not labor time.',
        'progress_scope': 'Authorized linked leaf tasks only; explicit weights take precedence over the default weight of 1.'})
    response['Cache-Control'] = 'private, no-store'
    return response
