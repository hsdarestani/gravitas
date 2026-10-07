import json

from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_http_methods

from .layer_access import record_activity
from .layer_models import ActivityEvent
from .models import ResearchProject
from .operating_models import OperatingMilestone
from .platform_access import can_edit, can_manage, can_view
from .platform_models import ProjectAuditEvent
from .research_models import ProjectDiscussionMessage, ResearchExperiment


MAX_ROWS = 250


def _payload(request):
    try:
        data = json.loads(request.body.decode('utf-8') or '{}')
    except (TypeError, ValueError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _error(code, status=400):
    return JsonResponse({'ok': False, 'error': code}, status=status)


def _project(request, project_id, minimum='view'):
    if not request.user.is_authenticated:
        return None
    project = ResearchProject.objects.select_related('owner').filter(pk=project_id, archived=False).first()
    checker = {'view': can_view, 'edit': can_edit, 'manage': can_manage}[minimum]
    return project if project and checker(request.user, project) else None


def _person(user):
    return user.get_full_name() or user.get_username() or user.email


def _iso(value):
    return value.isoformat() if value else None


def _audit(project, actor, action, obj, **detail):
    ProjectAuditEvent.objects.create(
        project=project,
        actor=actor,
        action=action,
        object_type=obj.__class__.__name__,
        object_id=str(obj.pk),
        detail=detail,
    )
    record_activity(
        layer=ActivityEvent.Layer.RESEARCH,
        action=action,
        actor=actor,
        subject_user=getattr(obj, 'owner', None) or getattr(obj, 'author', None),
        object_type=obj.__class__.__name__,
        object_id=obj.pk,
        detail={'project_id': project.pk, **detail},
    )


def _experiment_json(item, user):
    return {
        'id': item.pk,
        'project_id': item.project_id,
        'title': item.title,
        'hypothesis': item.hypothesis,
        'protocol': item.protocol,
        'status': item.status,
        'owner': {'id': item.owner_id, 'name': _person(item.owner), 'email': item.owner.email},
        'started_at': _iso(item.started_at),
        'completed_at': _iso(item.completed_at),
        'result_summary': item.result_summary,
        'metadata': item.metadata,
        'can_edit': can_edit(user, item.project),
        'created_at': _iso(item.created_at),
        'updated_at': _iso(item.updated_at),
    }


def _message_json(item, user):
    return {
        'id': item.pk,
        'project_id': item.project_id,
        'parent_id': item.parent_id,
        'author': {'id': item.author_id, 'name': _person(item.author), 'email': item.author.email},
        'body': item.body,
        'resolved': item.resolved,
        'can_edit': item.author_id == user.pk or can_manage(user, item.project),
        'created_at': _iso(item.created_at),
        'updated_at': _iso(item.updated_at),
    }


def _parse_timestamp(value, code):
    if value in (None, ''):
        return None
    if not isinstance(value, str):
        raise ValueError(code)
    parsed = parse_datetime(value)
    if parsed is None:
        raise ValueError(code)
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


@require_http_methods(['GET'])
def project_milestones(request, project_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project = _project(request, project_id, 'view')
    if not project:
        return _error('not_found', 404)
    items = OperatingMilestone.objects.filter(project=project).select_related('owner', 'initiative', 'cycle').order_by('due_date', 'id')[:MAX_ROWS]
    return JsonResponse({
        'ok': True,
        'milestones': [{
            'id': item.pk,
            'title': item.title,
            'owner': _person(item.owner),
            'due_date': item.due_date.isoformat() if item.due_date else None,
            'definition_of_done': item.definition_of_done,
            'health': item.health,
            'status': item.status,
            'initiative': item.initiative.title if item.initiative_id else '',
            'cycle': item.cycle.name if item.cycle_id else '',
            'updated_at': _iso(item.updated_at),
        } for item in items],
    })


@require_http_methods(['GET', 'POST'])
def project_experiments(request, project_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project = _project(request, project_id, 'view' if request.method == 'GET' else 'edit')
    if not project:
        return _error('not_found' if request.method == 'GET' else 'permission_denied', 404 if request.method == 'GET' else 403)

    if request.method == 'GET':
        items = project.experiments.select_related('owner')[:MAX_ROWS]
        return JsonResponse({'ok': True, 'experiments': [_experiment_json(item, request.user) for item in items]})

    data = _payload(request)
    if data is None:
        return _error('invalid_json')
    title = str(data.get('title') or '').strip()
    if not title:
        return _error('title_required')
    status = str(data.get('status') or ResearchExperiment.Status.PLANNED)
    if status not in ResearchExperiment.Status.values:
        return _error('invalid_status')
    try:
        started_at = _parse_timestamp(data.get('started_at'), 'invalid_started_at')
        completed_at = _parse_timestamp(data.get('completed_at'), 'invalid_completed_at')
    except ValueError as exc:
        return _error(str(exc))
    metadata = data.get('metadata') or {}
    if not isinstance(metadata, dict):
        return _error('invalid_metadata')
    item = ResearchExperiment.objects.create(
        project=project,
        owner=request.user,
        title=title,
        hypothesis=str(data.get('hypothesis') or ''),
        protocol=str(data.get('protocol') or ''),
        status=status,
        started_at=started_at,
        completed_at=completed_at,
        result_summary=str(data.get('result_summary') or ''),
        metadata=metadata,
    )
    _audit(project, request.user, 'experiment.created', item, status=item.status, title=item.title)
    return JsonResponse({'ok': True, 'experiment': _experiment_json(item, request.user)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def project_experiment_detail(request, project_id, experiment_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project = _project(request, project_id, 'edit')
    if not project:
        return _error('permission_denied', 403)
    item = ResearchExperiment.objects.select_related('owner').filter(pk=experiment_id, project=project).first()
    if not item:
        return _error('experiment_not_found', 404)
    if request.method == 'DELETE':
        item_id = item.pk
        title = item.title
        item.delete()
        ProjectAuditEvent.objects.create(
            project=project,
            actor=request.user,
            action='experiment.deleted',
            object_type='ResearchExperiment',
            object_id=str(item_id),
            detail={'title': title},
        )
        return JsonResponse({'ok': True})

    data = _payload(request)
    if data is None:
        return _error('invalid_json')
    changed = []
    for field in ('title', 'hypothesis', 'protocol', 'result_summary'):
        if field in data:
            value = str(data[field] or '').strip() if field == 'title' else str(data[field] or '')
            if field == 'title' and not value:
                return _error('title_required')
            setattr(item, field, value)
            changed.append(field)
    if 'status' in data:
        status = str(data['status'])
        if status not in ResearchExperiment.Status.values:
            return _error('invalid_status')
        item.status = status
        changed.append('status')
    try:
        for field, code in (('started_at', 'invalid_started_at'), ('completed_at', 'invalid_completed_at')):
            if field in data:
                setattr(item, field, _parse_timestamp(data.get(field), code))
                changed.append(field)
    except ValueError as exc:
        return _error(str(exc))
    if 'metadata' in data:
        if not isinstance(data['metadata'], dict):
            return _error('invalid_metadata')
        item.metadata = data['metadata']
        changed.append('metadata')
    item.save()
    _audit(project, request.user, 'experiment.updated', item, status=item.status, fields=changed)
    return JsonResponse({'ok': True, 'experiment': _experiment_json(item, request.user)})


@require_http_methods(['GET', 'POST'])
def project_discussions(request, project_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project = _project(request, project_id, 'view')
    if not project:
        return _error('not_found', 404)
    if request.method == 'GET':
        items = project.discussion_messages.select_related('author', 'parent')[:MAX_ROWS]
        return JsonResponse({'ok': True, 'messages': [_message_json(item, request.user) for item in items]})
    if not can_edit(request.user, project):
        return _error('permission_denied', 403)
    data = _payload(request)
    if data is None:
        return _error('invalid_json')
    body = str(data.get('body') or '').strip()
    if not body:
        return _error('body_required')
    if len(body) > 10000:
        return _error('body_too_long')
    parent = None
    if data.get('parent_id') not in (None, ''):
        try:
            parent = ProjectDiscussionMessage.objects.get(pk=int(data['parent_id']), project=project)
        except (ProjectDiscussionMessage.DoesNotExist, TypeError, ValueError):
            return _error('invalid_parent')
    item = ProjectDiscussionMessage.objects.create(project=project, author=request.user, parent=parent, body=body)
    _audit(project, request.user, 'discussion.posted', item, parent_id=item.parent_id)
    return JsonResponse({'ok': True, 'message': _message_json(item, request.user)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def project_discussion_detail(request, project_id, message_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project = _project(request, project_id, 'view')
    if not project:
        return _error('not_found', 404)
    item = ProjectDiscussionMessage.objects.select_related('author').filter(pk=message_id, project=project).first()
    if not item:
        return _error('message_not_found', 404)
    if item.author_id != request.user.pk and not can_manage(request.user, project):
        return _error('permission_denied', 403)
    if request.method == 'DELETE':
        item_id = item.pk
        item.delete()
        ProjectAuditEvent.objects.create(
            project=project,
            actor=request.user,
            action='discussion.deleted',
            object_type='ProjectDiscussionMessage',
            object_id=str(item_id),
            detail={},
        )
        return JsonResponse({'ok': True})
    data = _payload(request)
    if data is None:
        return _error('invalid_json')
    changed = []
    if 'body' in data:
        body = str(data['body'] or '').strip()
        if not body:
            return _error('body_required')
        if len(body) > 10000:
            return _error('body_too_long')
        item.body = body
        changed.append('body')
    if 'resolved' in data:
        item.resolved = bool(data['resolved'])
        changed.append('resolved')
    item.save()
    _audit(project, request.user, 'discussion.updated', item, fields=changed, resolved=item.resolved)
    return JsonResponse({'ok': True, 'message': _message_json(item, request.user)})
