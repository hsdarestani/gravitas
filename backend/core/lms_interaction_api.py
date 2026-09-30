import json
import logging

from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_http_methods

from . import cloud
from .lms_models import (
    Course,
    CourseEnrollment,
    LearningInteraction,
    Lesson,
    PulsarAccessGrant,
)
from .models import KnowledgeResource, ResearchProject
from .nextcloud_notes import reconcile_notes
from .platform_access import can_edit, can_view
from .workspace_api import provision_personal_workspace


logger = logging.getLogger(__name__)

MARKDOWN_MIME_TYPES = {
    'text/markdown',
    'text/x-markdown',
    'text/plain',
}
MAX_PROJECT_CONTEXT_CHARS = 18000
MAX_RESOURCE_CHARS = 6000
MAX_CONTEXT_RESOURCES = 8


def _body(request):
    try:
        data = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _course(course_id):
    return Course.objects.filter(pk=course_id).first()


def _enrollment(user, course):
    if not user or not user.is_authenticated:
        return None
    return CourseEnrollment.objects.filter(
        user=user,
        course=course,
        status__in=[
            CourseEnrollment.Status.ACTIVE,
            CourseEnrollment.Status.PAUSED,
            CourseEnrollment.Status.COMPLETED,
        ],
    ).first()


def _interaction_json(item):
    first_line = (item.body or item.quote or item.get_kind_display()).strip().splitlines()[0][:180]
    return {
        'id': item.pk,
        'course_id': item.enrollment.course_id,
        'lesson_id': item.lesson_id,
        'kind': item.kind,
        'label': first_line or item.get_kind_display(),
        'section_key': item.section_key,
        'quote': item.quote,
        'body': item.body,
        'anchor': item.anchor if isinstance(item.anchor, dict) else {},
        'due_at': item.due_at.isoformat() if item.due_at else None,
        'completed': item.completed,
        'nextcloud_resource_id': item.nextcloud_resource_id,
        'created_at': item.created_at.isoformat(),
        'updated_at': item.updated_at.isoformat(),
    }


def _parse_due(value):
    if value in (None, ''):
        return None
    parsed = parse_datetime(str(value))
    if not parsed:
        raise ValueError('invalid_due_at')
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _note_payload(item):
    course = item.enrollment.course
    lesson_title = item.lesson.title if item.lesson_id else 'Course'
    title = f'{course.title} · {lesson_title} · {item.get_kind_display()}'[:240]
    parts = []
    if item.quote:
        quoted = '\n'.join(f'> {line}' for line in item.quote.splitlines())
        parts.append(quoted)
    if item.body:
        parts.append(item.body)
    parts.append(f'Gravitas course: /workspace/learning/courses/{course.pk}')
    return title, '\n\n'.join(value for value in parts if value).strip()


def _sync_learning_note(user, item):
    if item.kind not in {LearningInteraction.Kind.NOTE, LearningInteraction.Kind.HIGHLIGHT}:
        return None

    workspace = provision_personal_workspace(user)
    title, content = _note_payload(item)
    metadata = {
        'ws_space': 'kms',
        'ws_kind': 'note',
        'ws_parent': None,
        'ws_bookmarked': item.kind == LearningInteraction.Kind.HIGHLIGHT,
        'ws_blocks': [{'id': f'lms-{item.pk}', 'type': 'p', 'text': content}],
        'lms': {
            'interaction_id': item.pk,
            'course_id': item.enrollment.course_id,
            'lesson_id': item.lesson_id,
            'section_key': item.section_key,
            'kind': item.kind,
            'anchor': item.anchor if isinstance(item.anchor, dict) else {},
        },
    }

    resource = item.nextcloud_resource
    if resource and resource.owner_id == user.pk and resource.kind == KnowledgeResource.Kind.NOTE:
        resource.title = title
        resource.body = content
        merged = dict(resource.metadata or {})
        merged.update(metadata)
        resource.metadata = merged
        resource.save(update_fields=['title', 'body', 'metadata', 'updated_at'])
    else:
        resource = KnowledgeResource.objects.create(
            workspace=workspace,
            owner=user,
            kind=KnowledgeResource.Kind.NOTE,
            title=title,
            body=content,
            metadata=metadata,
        )
        item.nextcloud_resource = resource
        item.save(update_fields=['nextcloud_resource', 'updated_at'])

    if getattr(user, 'gravitas_nextcloud', None):
        try:
            reconcile_notes(user)
        except Exception:
            logger.exception('Learning note %s could not be mirrored to Nextcloud immediately', item.pk)
    return resource


@require_http_methods(['GET', 'POST'])
def course_interactions(request, course_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    course = _course(course_id)
    if not course:
        return _error('course_not_found', 404)
    enrollment = _enrollment(request.user, course)
    if not enrollment:
        return _error('course_enrollment_required', 403)

    if request.method == 'GET':
        rows = enrollment.interactions.select_related('lesson', 'nextcloud_resource').filter(user=request.user)
        lesson_id = request.GET.get('lesson_id')
        kind = str(request.GET.get('kind') or '').strip()
        if lesson_id:
            rows = rows.filter(lesson_id=lesson_id)
        if kind:
            if kind not in LearningInteraction.Kind.values:
                return _error('invalid_interaction_kind')
            rows = rows.filter(kind=kind)
        return JsonResponse({'ok': True, 'interactions': [_interaction_json(item) for item in rows[:500]]})

    data = _body(request)
    kind = str(data.get('kind') or LearningInteraction.Kind.NOTE).strip()
    if kind not in LearningInteraction.Kind.values:
        return _error('invalid_interaction_kind')
    lesson = None
    if data.get('lesson_id'):
        lesson = Lesson.objects.filter(pk=data['lesson_id'], module__course=course).first()
        if not lesson:
            return _error('lesson_not_found', 404)
    body = str(data.get('body') or '').strip()[:24000]
    quote = str(data.get('quote') or '').strip()[:12000]
    if kind == LearningInteraction.Kind.NOTE and not body:
        return _error('note_body_required')
    if kind == LearningInteraction.Kind.HIGHLIGHT and not quote:
        return _error('highlight_quote_required')
    try:
        due_at = _parse_due(data.get('due_at'))
    except ValueError as exc:
        return _error(str(exc))

    item = LearningInteraction.objects.create(
        user=request.user,
        enrollment=enrollment,
        lesson=lesson,
        kind=kind,
        section_key=str(data.get('section_key') or '')[:240],
        quote=quote,
        body=body,
        anchor=data.get('anchor') if isinstance(data.get('anchor'), dict) else {},
        due_at=due_at,
        completed=bool(data.get('completed')),
    )
    _sync_learning_note(request.user, item)
    return JsonResponse({'ok': True, 'interaction': _interaction_json(item)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def course_interaction_detail(request, course_id, interaction_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    course = _course(course_id)
    enrollment = _enrollment(request.user, course) if course else None
    item = (
        LearningInteraction.objects
        .select_related('lesson', 'nextcloud_resource', 'enrollment__course')
        .filter(pk=interaction_id, enrollment=enrollment, user=request.user)
        .first()
        if enrollment else None
    )
    if not item:
        return _error('interaction_not_found', 404)

    if request.method == 'DELETE':
        resource = item.nextcloud_resource
        item.delete()
        if resource and resource.owner_id == request.user.pk:
            resource.delete()
            if getattr(request.user, 'gravitas_nextcloud', None):
                try:
                    reconcile_notes(request.user)
                except Exception:
                    logger.exception('Could not reconcile Nextcloud after deleting learning interaction')
        return JsonResponse({'ok': True})

    data = _body(request)
    if 'body' in data:
        item.body = str(data.get('body') or '').strip()[:24000]
    if 'quote' in data:
        item.quote = str(data.get('quote') or '').strip()[:12000]
    if 'section_key' in data:
        item.section_key = str(data.get('section_key') or '')[:240]
    if 'anchor' in data:
        item.anchor = data.get('anchor') if isinstance(data.get('anchor'), dict) else {}
    if 'completed' in data:
        item.completed = bool(data.get('completed'))
    if 'due_at' in data:
        try:
            item.due_at = _parse_due(data.get('due_at'))
        except ValueError as exc:
            return _error(str(exc))
    item.save()
    _sync_learning_note(request.user, item)
    return JsonResponse({'ok': True, 'interaction': _interaction_json(item)})


@require_http_methods(['GET'])
def course_learning_plan(request, course_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    course = _course(course_id)
    if not course:
        return _error('course_not_found', 404)
    enrollment = _enrollment(request.user, course)
    if not enrollment:
        return _error('course_enrollment_required', 403)

    progress = {
        row.lesson_id: row
        for row in enrollment.lesson_progress.select_related('lesson').all()
    }
    lessons = list(
        Lesson.objects
        .filter(module__course=course, published=True, is_required=True)
        .select_related('module')
        .order_by('module__position', 'position', 'id')
    )
    interactions = list(
        enrollment.interactions
        .filter(user=request.user, kind__in=[LearningInteraction.Kind.TASK, LearningInteraction.Kind.REMINDER])
        .select_related('lesson')
        .order_by('completed', 'due_at', 'created_at')
    )

    checklist = []
    for lesson in lessons:
        row = progress.get(lesson.pk)
        checklist.append({
            'type': 'lesson',
            'id': lesson.pk,
            'lesson_id': lesson.pk,
            'title': lesson.title,
            'module_title': lesson.module.title,
            'done': bool(row and row.completed),
            'due_at': None,
        })
    for item in interactions:
        checklist.append({
            'type': item.kind,
            'id': item.pk,
            'lesson_id': item.lesson_id,
            'title': item.body.strip().splitlines()[0][:180] if item.body.strip() else item.get_kind_display(),
            'module_title': item.lesson.module.title if item.lesson_id else '',
            'done': item.completed,
            'due_at': item.due_at.isoformat() if item.due_at else None,
        })

    done = sum(1 for row in checklist if row['done'])
    total = len(checklist)
    percent = round((done * 100 / total), 1) if total else 0
    next_item = next((row for row in checklist if not row['done']), None)
    return JsonResponse({
        'ok': True,
        'course_id': course.pk,
        'course_progress_percent': float(enrollment.progress_percent),
        'workspace_progress_percent': percent,
        'done': done,
        'total': total,
        'next': next_item,
        'checklist': checklist,
    })


def _grant_json(grant, user):
    project = grant.project
    still_visible = can_view(user, project)
    return {
        'id': grant.pk,
        'project_id': project.pk,
        'project_title': project.title,
        'active': bool(grant.active and still_visible),
        'allow_markdown': grant.allow_markdown,
        'allow_notes': grant.allow_notes,
        'allow_write_interactions': grant.allow_write_interactions,
        'can_view_project': still_visible,
        'can_edit_project': can_edit(user, project) if still_visible else False,
        'updated_at': grant.updated_at.isoformat(),
    }


@require_http_methods(['GET', 'POST'])
def course_pulsar_access(request, course_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    course = _course(course_id)
    if not course:
        return _error('course_not_found', 404)
    enrollment = _enrollment(request.user, course)
    if not enrollment:
        return _error('course_enrollment_required', 403)

    if request.method == 'GET':
        candidates = (
            ResearchProject.objects
            .filter(archived=False)
            .select_related('owner')
            .order_by('title')[:300]
        )
        projects = [
            {
                'id': item.pk,
                'title': item.title,
                'can_edit': can_edit(request.user, item),
            }
            for item in candidates if can_view(request.user, item)
        ]
        grants = (
            PulsarAccessGrant.objects
            .filter(user=request.user, course=course)
            .select_related('project')
            .order_by('project__title')
        )
        return JsonResponse({
            'ok': True,
            'principle': 'Pulsar never receives more access than the signed-in user, and project access is rechecked on every use.',
            'projects': projects,
            'grants': [_grant_json(item, request.user) for item in grants],
        })

    data = _body(request)
    try:
        project_id = int(data.get('project_id'))
    except (TypeError, ValueError):
        return _error('project_id_required')
    project = ResearchProject.objects.filter(pk=project_id, archived=False).first()
    if not project or not can_view(request.user, project):
        return _error('project_access_required', 403)

    enabled = data.get('enabled') is not False
    grant, _ = PulsarAccessGrant.objects.update_or_create(
        user=request.user,
        course=course,
        project=project,
        defaults={
            'active': enabled,
            'allow_markdown': bool(data.get('allow_markdown', True)),
            'allow_notes': bool(data.get('allow_notes', True)),
            'allow_write_interactions': bool(data.get('allow_write_interactions', True)),
        },
    )
    return JsonResponse({'ok': True, 'grant': _grant_json(grant, request.user)})


def _markdown_resource(resource):
    name = (resource.original_name or resource.title or '').lower()
    mime = (resource.mime_type or '').lower()
    return name.endswith(('.md', '.markdown', '.mdown', '.mkd')) or mime in MARKDOWN_MIME_TYPES


def _read_resource_text(user, resource):
    if resource.kind == KnowledgeResource.Kind.NOTE:
        return str(resource.body or '')
    if resource.body:
        return str(resource.body)
    if not resource.storage_path:
        return ''
    identity = getattr(user, 'gravitas_nextcloud', None)
    if not identity:
        return ''
    try:
        response = cloud.download(identity, resource.storage_path)
    except Exception:
        logger.exception('Pulsar could not read permitted project resource %s', resource.pk)
        return ''
    raw = response.content[: MAX_RESOURCE_CHARS * 4]
    try:
        return raw.decode('utf-8')[:MAX_RESOURCE_CHARS]
    except UnicodeDecodeError:
        return raw.decode('utf-8', errors='replace')[:MAX_RESOURCE_CHARS]


def pulsar_project_context(user, course, max_chars=MAX_PROJECT_CONTEXT_CHARS):
    if not user or not user.is_authenticated:
        return '', []
    grants = (
        PulsarAccessGrant.objects
        .filter(user=user, course=course, active=True)
        .select_related('project')
        .order_by('project__title')
    )
    blocks = []
    sources = []
    used = 0
    for grant in grants:
        project = grant.project
        if not can_view(user, project):
            continue
        resources = (
            KnowledgeResource.objects
            .filter(project=project)
            .select_related('project')
            .order_by('-updated_at')[:100]
        )
        for resource in resources:
            if len(sources) >= MAX_CONTEXT_RESOURCES or used >= max_chars:
                break
            if not can_view(user, resource):
                continue
            is_note = resource.kind == KnowledgeResource.Kind.NOTE
            is_markdown = resource.kind == KnowledgeResource.Kind.FILE and _markdown_resource(resource)
            if is_note and not grant.allow_notes:
                continue
            if is_markdown and not grant.allow_markdown:
                continue
            if not is_note and not is_markdown:
                continue
            text = _read_resource_text(user, resource).strip()
            if not text:
                continue
            remaining = max_chars - used
            text = text[: min(MAX_RESOURCE_CHARS, remaining)]
            block = f'Project: {project.title}\nResource: {resource.title}\n{text}'
            blocks.append(block)
            used += len(block)
            sources.append({
                'title': resource.title,
                'project': project.title,
                'resource_id': resource.pk,
                'kind': 'project_note' if is_note else 'markdown',
            })
        if len(sources) >= MAX_CONTEXT_RESOURCES or used >= max_chars:
            break
    return '\n\n---\n\n'.join(blocks), sources
