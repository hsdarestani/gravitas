from django.db import transaction
from django.http import JsonResponse
from django.utils.dateparse import parse_date
from django.views.decorators.http import require_http_methods

from .operating_models import Health, OperatingMilestone, WorkStatus
from .platform_access import can_edit, can_view
from .research_project_tools import _audit, _error, _payload, _project
from .research_task_api import _execution_initiative


MAX_ROWS = 250


def _milestone_json(item, user):
    return {
        'id': item.pk,
        'project_id': item.project_id,
        'title': item.title,
        'owner': item.owner.get_full_name() or item.owner.get_username() or item.owner.email,
        'owner_id': item.owner_id,
        'due_date': item.due_date.isoformat() if item.due_date else None,
        'definition_of_done': item.definition_of_done,
        'health': item.health,
        'status': item.status,
        'initiative': item.initiative.title if item.initiative_id else '',
        'cycle': item.cycle.name if item.cycle_id else '',
        'can_edit': can_edit(user, item.project),
        'updated_at': item.updated_at.isoformat(),
    }


def _date_value(value):
    if value in (None, ''):
        return None
    parsed = parse_date(str(value))
    if parsed is None:
        raise ValueError('invalid_due_date')
    return parsed


@require_http_methods(['GET', 'POST'])
def project_milestones(request, project_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project = _project(request, project_id, 'edit' if request.method == 'POST' else 'view')
    if not project:
        return _error('permission_denied' if request.method == 'POST' else 'not_found', 403 if request.method == 'POST' else 404)

    if request.method == 'GET':
        items = OperatingMilestone.objects.filter(project=project).select_related(
            'owner', 'initiative', 'cycle'
        ).order_by('due_date', 'id')[:MAX_ROWS]
        visible = [item for item in items if can_view(request.user, item)]
        return JsonResponse({'ok': True, 'milestones': [_milestone_json(item, request.user) for item in visible]})

    data = _payload(request)
    if data is None:
        return _error('invalid_json')
    title = str(data.get('title') or '').strip()[:220]
    if not title:
        return _error('title_required')
    status = str(data.get('status') or WorkStatus.ACTIVE).strip().lower()
    health = str(data.get('health') or Health.GREEN).strip().lower()
    if status not in WorkStatus.values:
        return _error('invalid_status')
    if health not in Health.values:
        return _error('invalid_health')
    try:
        due_date = _date_value(data.get('due_date'))
    except ValueError as exc:
        return _error(str(exc))

    with transaction.atomic():
        core, initiative = _execution_initiative(project, request.user)
        item = OperatingMilestone.objects.create(
            workspace=core,
            initiative=initiative,
            project=project,
            owner=request.user,
            title=title,
            due_date=due_date,
            definition_of_done=str(data.get('definition_of_done') or '').strip(),
            health=health,
            status=status,
        )
        _audit(project, request.user, 'milestone.created', item, title=item.title, status=item.status)
    return JsonResponse({'ok': True, 'milestone': _milestone_json(item, request.user)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def project_milestone_detail(request, project_id, milestone_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project = _project(request, project_id, 'edit')
    if not project:
        return _error('permission_denied', 403)
    item = OperatingMilestone.objects.select_related('owner', 'initiative', 'cycle').filter(
        pk=milestone_id,
        project=project,
    ).first()
    if not item:
        return _error('milestone_not_found', 404)

    if request.method == 'DELETE':
        if item.tasks.exists() or item.work_packages.exists():
            return _error('milestone_not_empty', 409)
        item_id = item.pk
        title = item.title
        item.delete()
        from .platform_models import ProjectAuditEvent
        ProjectAuditEvent.objects.create(
            project=project,
            actor=request.user,
            action='milestone.deleted',
            object_type='OperatingMilestone',
            object_id=str(item_id),
            detail={'title': title},
        )
        return JsonResponse({'ok': True})

    data = _payload(request)
    if data is None:
        return _error('invalid_json')
    changed = []
    if 'title' in data:
        title = str(data.get('title') or '').strip()[:220]
        if not title:
            return _error('title_required')
        item.title = title
        changed.append('title')
    if 'definition_of_done' in data:
        item.definition_of_done = str(data.get('definition_of_done') or '').strip()
        changed.append('definition_of_done')
    if 'status' in data:
        status = str(data.get('status') or '').strip().lower()
        if status not in WorkStatus.values:
            return _error('invalid_status')
        item.status = status
        changed.append('status')
    if 'health' in data:
        health = str(data.get('health') or '').strip().lower()
        if health not in Health.values:
            return _error('invalid_health')
        item.health = health
        changed.append('health')
    if 'due_date' in data:
        try:
            item.due_date = _date_value(data.get('due_date'))
        except ValueError as exc:
            return _error(str(exc))
        changed.append('due_date')
    item.save()
    _audit(project, request.user, 'milestone.updated', item, title=item.title, status=item.status, fields=changed)
    return JsonResponse({'ok': True, 'milestone': _milestone_json(item, request.user)})
