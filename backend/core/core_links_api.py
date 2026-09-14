import json

from django.contrib.contenttypes.models import ContentType
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .layer_access import record_activity
from .layer_models import ActivityEvent
from .lms_models import Course, Lesson
from .models import ContentItem, ResearchProject
from .operating_models import OperatingTask
from .platform_access import can_view, content_type_for
from .platform_models import ContentWorkItem, EntityLink
from .platform_runtime_v3 import core_access, core_role, ensure_platform_workspaces


TARGETS = {
    'research-project': ResearchProject,
    'course': Course,
    'lesson': Lesson,
    'public-content': ContentItem,
    'content-work': ContentWorkItem,
}


def _body(request):
    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, TypeError, UnicodeDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _deny(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    return JsonResponse({'ok': False, 'error': 'core_access_required'}, status=403)


def _context(request, task_id):
    if not request.user.is_authenticated:
        return None, None, None
    spaces = ensure_platform_workspaces(request.user)
    core = spaces['core']
    if not core_access(request.user, core):
        return core, None, None
    task = OperatingTask.objects.select_related('workspace', 'owner').filter(pk=task_id, workspace=core).first()
    return core, task, core_role(request.user, core)


def _target(kind, raw_id):
    model = TARGETS.get(str(kind or '').strip().lower())
    if model is None:
        return None
    try:
        return model.objects.get(pk=int(raw_id))
    except (model.DoesNotExist, TypeError, ValueError):
        return None


def _target_allowed(user, obj, admin, core):
    if isinstance(obj, ResearchProject):
        return admin or can_view(user, obj)
    if isinstance(obj, Course):
        return admin or obj.status == Course.Status.PUBLISHED
    if isinstance(obj, Lesson):
        return admin or (obj.published and obj.module.course.status == Course.Status.PUBLISHED)
    if isinstance(obj, ContentItem):
        return admin or obj.status == ContentItem.Status.PUBLISHED
    if isinstance(obj, ContentWorkItem):
        return obj.workspace_id == core.pk
    return False


def _type_name(obj):
    if isinstance(obj, ResearchProject):
        return 'research-project'
    if isinstance(obj, Course):
        return 'course'
    if isinstance(obj, Lesson):
        return 'lesson'
    if isinstance(obj, ContentItem):
        return 'public-content'
    if isinstance(obj, ContentWorkItem):
        return 'content-work'
    return obj.__class__.__name__.lower()


def _title(obj):
    return getattr(obj, 'title', None) or getattr(obj, 'name', None) or str(obj)


def _link_json(link, task):
    target = link.target_object if (
        link.source_content_type_id == content_type_for(task).pk and link.source_object_id == task.pk
    ) else link.source_object
    return {
        'id': link.pk,
        'relation': link.relation,
        'target_type': _type_name(target) if target is not None else 'missing',
        'target_id': getattr(target, 'pk', None),
        'title': _title(target) if target is not None else 'Deleted item',
        'created_at': link.created_at.isoformat(),
    }


def _links(task):
    ct = content_type_for(task)
    return EntityLink.objects.filter(
        source_content_type=ct,
        source_object_id=task.pk,
    ).select_related('source_content_type', 'target_content_type', 'created_by').order_by('id')


@require_http_methods(['GET', 'POST', 'DELETE'])
def task_cross_layer_links(request, task_id):
    core, task, role = _context(request, task_id)
    if not request.user.is_authenticated or core is None:
        return _deny(request)
    if not core_access(request.user, core):
        return _deny(request)
    if task is None:
        return JsonResponse({'ok': False, 'error': 'task_not_found'}, status=404)

    if request.method == 'GET':
        return JsonResponse({'ok': True, 'links': [_link_json(link, task) for link in _links(task)]})

    payload = _body(request)
    if payload is None:
        return JsonResponse({'ok': False, 'error': 'invalid_json'}, status=400)

    if request.method == 'DELETE':
        try:
            link_id = int(payload.get('link_id'))
        except (TypeError, ValueError):
            return JsonResponse({'ok': False, 'error': 'link_id_required'}, status=400)
        link = _links(task).filter(pk=link_id).first()
        if not link:
            return JsonResponse({'ok': False, 'error': 'link_not_found'}, status=404)
        snapshot = _link_json(link, task)
        link.delete()
        record_activity(
            layer=ActivityEvent.Layer.CORE,
            action='task.link_removed',
            actor=request.user,
            object_type='operating_task',
            object_id=task.pk,
            detail=snapshot,
        )
        return JsonResponse({'ok': True, 'removed': snapshot})

    kind = str(payload.get('target_type') or '').strip().lower()
    target = _target(kind, payload.get('target_id'))
    if target is None:
        return JsonResponse({'ok': False, 'error': 'target_not_found'}, status=404)

    admin = role in {'owner', 'admin'} or request.user.is_superuser
    if not _target_allowed(request.user, target, admin, core):
        return JsonResponse({'ok': False, 'error': 'target_not_accessible'}, status=403)

    relation = str(payload.get('relation') or 'related').strip()[:80] or 'related'
    task_ct = ContentType.objects.get_for_model(task, for_concrete_model=False)
    target_ct = ContentType.objects.get_for_model(target, for_concrete_model=False)
    link, created = EntityLink.objects.get_or_create(
        source_content_type=task_ct,
        source_object_id=task.pk,
        target_content_type=target_ct,
        target_object_id=target.pk,
        relation=relation,
        defaults={'created_by': request.user},
    )
    data = _link_json(link, task)
    if created:
        record_activity(
            layer=ActivityEvent.Layer.CORE,
            action='task.link_added',
            actor=request.user,
            object_type='operating_task',
            object_id=task.pk,
            detail=data,
        )
    return JsonResponse({'ok': True, 'link': data}, status=201 if created else 200)
