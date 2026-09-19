import json
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_http_methods

from . import openedx_bridge
from .layer_access import module_access, record_activity, set_module_grant
from .layer_models import ActivityEvent, ModuleGrant
from .lms_models import (
    Assessment,
    AssessmentAttempt,
    Certificate,
    Course,
    CourseCategory,
    CourseEnrollment,
    CourseInstructor,
    CourseModule,
    CourseRegistrationProfile,
    CourseTag,
    Lesson,
    LessonProgress,
)


def _payload(request):
    try:
        return json.loads(request.body.decode('utf-8') or '{}')
    except (TypeError, ValueError, UnicodeDecodeError):
        return None


def _auth_required(request):
    if request.user.is_authenticated:
        return None
    return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)


def _is_core_admin(user):
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if getattr(user, 'is_superuser', False):
        return True
    from .platform_runtime_v3 import core_role, ensure_platform_workspaces

    spaces = ensure_platform_workspaces(user)
    return core_role(user, spaces['core']) in {'owner', 'admin'}


def _as_decimal(value, default=None):
    if value in (None, ''):
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError('invalid_decimal')


def _safe_http_url(value, *, allow_blank=True):
    raw = str(value or '').strip()
    if not raw and allow_blank:
        return ''
    parsed = urlparse(raw)
    if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
        raise ValueError('invalid_url')
    return raw


def _iso(value):
    return value.isoformat() if value else None


def _public_questions(questions):
    clean = []
    for index, raw in enumerate(questions or []):
        if not isinstance(raw, dict):
            continue
        item = {
            key: value
            for key, value in raw.items()
            if key not in {'correct', 'correct_answer', 'answer', 'explanation_private'}
        }
        item.setdefault('id', str(index + 1))
        clean.append(item)
    return clean


def _enrollment_for(user, course):
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    return CourseEnrollment.objects.filter(user=user, course=course).first()


def _certificate_json(enrollment):
    try:
        cert = enrollment.certificate
    except Certificate.DoesNotExist:
        return None
    return {
        'code': str(cert.code),
        'issued_at': _iso(cert.issued_at),
        'revoked_at': _iso(cert.revoked_at),
        'valid': cert.revoked_at is None,
    }


def _lesson_access(lesson, enrollment):
    rule = lesson.access_rule if isinstance(lesson.access_rule, dict) else {}
    if not rule:
        return True, ''

    requires = rule.get('requires_lesson_ids')
    if isinstance(requires, list):
        ids = []
        for value in requires:
            try:
                ids.append(int(value))
            except (TypeError, ValueError):
                continue
        if ids:
            valid_ids = set(
                Lesson.objects.filter(pk__in=ids, module__course=lesson.module.course)
                .values_list('pk', flat=True)
            )
            completed_ids = set(
                LessonProgress.objects.filter(
                    enrollment=enrollment,
                    lesson_id__in=valid_ids,
                    completed=True,
                ).values_list('lesson_id', flat=True)
            )
            if valid_ids - completed_ids:
                return False, 'prerequisite_lessons'

    minimum = rule.get('min_progress_percent')
    if minimum not in (None, ''):
        try:
            if Decimal(str(enrollment.progress_percent)) < Decimal(str(minimum)):
                return False, 'minimum_progress'
        except (InvalidOperation, TypeError, ValueError):
            return False, 'invalid_access_rule'

    available_after = str(rule.get('available_after') or '').strip()
    if available_after:
        parsed = parse_datetime(available_after)
        if parsed is None:
            return False, 'invalid_access_rule'
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
        if timezone.now() < parsed:
            return False, 'scheduled_release'

    return True, ''


def _course_json(course, user=None, *, include_structure=False):
    enrollment = _enrollment_for(user, course)
    admin = _is_core_admin(user)
    entitled = bool(
        admin
        or (
            enrollment
            and enrollment.status
            in {
                CourseEnrollment.Status.ACTIVE,
                CourseEnrollment.Status.COMPLETED,
                CourseEnrollment.Status.PAUSED,
            }
        )
    )
    registration_complete = True
    if enrollment and course.registration_schema:
        try:
            registration_complete = bool(enrollment.registration_profile.completed)
        except CourseRegistrationProfile.DoesNotExist:
            registration_complete = False

    data = {
        'id': course.pk,
        'slug': course.slug,
        'title': course.title,
        'summary': course.summary,
        'description': course.description if entitled or course.status == Course.Status.PUBLISHED else '',
        'status': course.status,
        'access_type': course.access_type,
        'price': str(course.price) if course.price is not None else None,
        'currency': course.currency,
        'certificate_enabled': course.certificate_enabled,
        'provider': course.provider,
        'openedx_course_key': course.openedx_course_key if admin else '',
        'openedx_launch_url': (
            course.openedx_course_url
            or (
                f"{openedx_bridge.settings.OPENEDX_LMS_URL}/courses/{course.openedx_course_key}/course/"
                if course.provider == Course.Provider.OPENEDX and course.openedx_course_key
                else ''
            )
        ) if entitled or admin else '',
        'openedx_studio_url': course.openedx_studio_url if admin else '',
        'category': (
            {'id': course.category_id, 'slug': course.category.slug, 'name': course.category.name}
            if course.category_id else None
        ),
        'tags': [{'id': tag.pk, 'slug': tag.slug, 'name': tag.name} for tag in course.tags.all()],
        'instructors': [{
            'user_id': link.user_id,
            'name': link.user.get_full_name() or link.user.email,
            'email': link.user.email,
            'role': link.role,
        } for link in course.instructor_links.select_related('user').all()],
        'registration_schema': course.registration_schema if isinstance(course.registration_schema, list) else [],
        'payment': {
            'configured': bool(course.payment_config),
            'enabled': bool((course.payment_config or {}).get('enabled')),
            'provider': str((course.payment_config or {}).get('provider') or ''),
            'checkout_url': str((course.payment_config or {}).get('checkout_url') or ''),
            'sku': str((course.payment_config or {}).get('sku') or ''),
        },
        'payment_config': course.payment_config if admin else {},
        'learning_config': course.learning_config if admin or entitled else {},
        'published_at': _iso(course.published_at),
        'updated_at': _iso(course.updated_at),
        'enrolled': bool(enrollment and enrollment.status != CourseEnrollment.Status.REVOKED),
        'progress_percent': str(enrollment.progress_percent) if enrollment else '0.00',
        'enrollment_status': enrollment.status if enrollment else None,
        'registration_complete': registration_complete,
        'certificate': _certificate_json(enrollment) if enrollment else None,
    }

    if not include_structure:
        data['module_count'] = course.modules.count()
        data['lesson_count'] = Lesson.objects.filter(module__course=course, published=True).count()
        return data

    modules = []
    for module in course.modules.prefetch_related('lessons', 'assessments').all():
        lessons = []
        for lesson in module.lessons.all():
            if not lesson.published and not admin:
                continue
            rule_open, lock_reason = (True, '') if admin or not enrollment else _lesson_access(lesson, enrollment)
            can_open = admin or lesson.is_preview or (entitled and registration_complete and rule_open)
            if not can_open and not lock_reason:
                if entitled and not registration_complete:
                    lock_reason = 'course_profile_required'
                elif not entitled:
                    lock_reason = 'course_enrollment_required'
            lessons.append({
                'id': lesson.pk,
                'position': lesson.position,
                'title': lesson.title,
                'kind': lesson.kind,
                'summary': lesson.summary,
                'duration_seconds': lesson.duration_seconds,
                'is_preview': lesson.is_preview,
                'is_required': lesson.is_required,
                'published': lesson.published,
                'locked': not can_open,
                'lock_reason': lock_reason if not can_open else '',
                'body': lesson.body if can_open else '',
                'content_url': lesson.content_url if can_open else '',
                'metadata': lesson.metadata if can_open else {},
                'access_rule': lesson.access_rule if can_open or admin else {},
                'provider_key': lesson.provider_key if admin else '',
                'lab_slug': lesson.lab_slug if can_open else '',
            })
        modules.append({
            'id': module.pk,
            'position': module.position,
            'title': module.title,
            'summary': module.summary,
            'lessons': lessons,
        })
    data['modules'] = modules
    data['assets'] = [{
        'id': asset.pk,
        'lesson_id': asset.lesson_id,
        'kind': asset.kind,
        'title': asset.title,
        'source_url': asset.source_url if entitled or admin else '',
        'mime_type': asset.mime_type,
        'size': asset.size,
        'download_url': f'/api/lms/assets/{asset.pk}/download/' if entitled or admin else '',
    } for asset in course.assets.all()]
    data['assessments'] = [
        {
            'id': assessment.pk,
            'module_id': assessment.module_id,
            'title': assessment.title,
            'instructions': assessment.instructions if entitled or admin else '',
            'passing_score': str(assessment.passing_score),
            'max_attempts': assessment.max_attempts,
            'required_for_completion': assessment.required_for_completion,
            'published': assessment.published,
            'questions': _public_questions(assessment.questions) if entitled or admin else [],
        }
        for assessment in course.assessments.all()
        if assessment.published or admin
    ]
    return data


def _assessment_values(raw):
    if not isinstance(raw, dict) or not str(raw.get('title', '')).strip():
        raise ValueError('invalid_assessment')
    questions = raw.get('questions') or []
    if not isinstance(questions, list):
        raise ValueError('invalid_assessment_questions')
    return {
        'title': str(raw['title']).strip(),
        'instructions': str(raw.get('instructions') or ''),
        'questions': questions,
        'passing_score': _as_decimal(raw.get('passing_score'), Decimal('70')),
        'max_attempts': max(1, int(raw.get('max_attempts') or 3)),
        'required_for_completion': bool(raw.get('required_for_completion', True)),
        'published': bool(raw.get('published', True)),
    }


def _sync_assessment(course, raw, module=None):
    values = _assessment_values(raw)
    raw_id = raw.get('id') if isinstance(raw, dict) else None
    if raw_id:
        item = Assessment.objects.filter(pk=raw_id, course=course).first()
        if not item:
            raise ValueError('assessment_not_found')
        item.module = module
        for field, value in values.items():
            setattr(item, field, value)
        item.save()
        return item
    return Assessment.objects.create(course=course, module=module, **values)


def _replace_structure(course, modules_payload, assessments_payload=None):
    """Synchronize authored structure without destroying learner progress.

    Existing objects keep stable IDs. Removed lessons/assessments that already
    have learner records are retired (unpublished and non-required) instead of
    deleted, so historical progress and reports remain valid.
    """
    if not isinstance(modules_payload, list):
        raise ValueError('invalid_modules')
    if assessments_payload is not None and not isinstance(assessments_payload, list):
        raise ValueError('invalid_assessments')

    # Backward compatibility for the original V1 course editor/API: before
    # stable object IDs were exposed, a PATCH represented a full replacement
    # and every row arrived without an id. For an unenrolled course there is
    # no learner history to preserve, so keep that exact replacement contract.
    # Mixed payloads (existing rows with ids plus new rows without ids) still
    # use the stable-ID synchronizer below.
    existing_structure = course.modules.exists() or course.assessments.exists()
    legacy_modules = bool(modules_payload) and all(
        isinstance(item, dict) and not item.get('id')
        for item in modules_payload
    )
    legacy_assessments = all(
        isinstance(item, dict) and not item.get('id')
        for item in (assessments_payload or [])
    )
    if (
        existing_structure
        and not course.enrollments.exists()
        and legacy_modules
        and legacy_assessments
    ):
        course.assessments.all().delete()
        course.modules.all().delete()

    keep_modules = set()
    keep_assessments = set()

    for m_index, raw_module in enumerate(modules_payload, start=1):
        if not isinstance(raw_module, dict) or not str(raw_module.get('title', '')).strip():
            raise ValueError('invalid_module')
        raw_module_id = raw_module.get('id')
        if raw_module_id:
            module = CourseModule.objects.filter(pk=raw_module_id, course=course).first()
            if not module:
                raise ValueError('module_not_found')
            module.position = int(raw_module.get('position') or m_index)
            module.title = str(raw_module['title']).strip()
            module.summary = str(raw_module.get('summary') or '')
            module.save()
        else:
            module = CourseModule.objects.create(
                course=course,
                position=int(raw_module.get('position') or m_index),
                title=str(raw_module['title']).strip(),
                summary=str(raw_module.get('summary') or ''),
            )
        keep_modules.add(module.pk)

        keep_lessons = set()
        lessons_payload = raw_module.get('lessons') or []
        if not isinstance(lessons_payload, list):
            raise ValueError('invalid_lessons')
        for l_index, raw_lesson in enumerate(lessons_payload, start=1):
            if not isinstance(raw_lesson, dict) or not str(raw_lesson.get('title', '')).strip():
                raise ValueError('invalid_lesson')
            kind = str(raw_lesson.get('kind') or Lesson.Kind.ARTICLE)
            if kind not in Lesson.Kind.values:
                raise ValueError('invalid_lesson_kind')
            values = {
                'module': module,
                'position': int(raw_lesson.get('position') or l_index),
                'title': str(raw_lesson['title']).strip(),
                'kind': kind,
                'summary': str(raw_lesson.get('summary') or ''),
                'body': str(raw_lesson.get('body') or ''),
                'content_url': _safe_http_url(raw_lesson.get('content_url')),
                'duration_seconds': max(0, int(raw_lesson.get('duration_seconds') or 0)),
                'is_preview': bool(raw_lesson.get('is_preview', False)),
                'is_required': bool(raw_lesson.get('is_required', True)),
                'published': bool(raw_lesson.get('published', True)),
                'metadata': raw_lesson.get('metadata') if isinstance(raw_lesson.get('metadata'), dict) else {},
                'access_rule': raw_lesson.get('access_rule') if isinstance(raw_lesson.get('access_rule'), dict) else {},
                'provider_key': str(raw_lesson.get('provider_key') or '')[:255],
                'lab_slug': str(raw_lesson.get('lab_slug') or '')[:190],
            }
            raw_lesson_id = raw_lesson.get('id')
            if raw_lesson_id:
                lesson = Lesson.objects.filter(pk=raw_lesson_id, module__course=course).first()
                if not lesson:
                    raise ValueError('lesson_not_found')
                for field, value in values.items():
                    setattr(lesson, field, value)
                lesson.save()
            else:
                lesson = Lesson.objects.create(**values)
            keep_lessons.add(lesson.pk)

        retired = Lesson.objects.filter(module=module).exclude(pk__in=keep_lessons)
        for lesson in retired:
            if lesson.progress_rows.exists() or lesson.events.exists():
                lesson.published = False
                lesson.is_required = False
                lesson.save(update_fields=['published', 'is_required', 'updated_at'])
            else:
                lesson.delete()

        module_assessments = raw_module.get('assessments') or []
        if not isinstance(module_assessments, list):
            raise ValueError('invalid_assessments')
        for raw_assessment in module_assessments:
            item = _sync_assessment(course, raw_assessment, module=module)
            keep_assessments.add(item.pk)

    for raw_assessment in assessments_payload or []:
        item = _sync_assessment(course, raw_assessment, module=None)
        keep_assessments.add(item.pk)

    for assessment in course.assessments.exclude(pk__in=keep_assessments):
        if assessment.attempts.exists():
            assessment.published = False
            assessment.required_for_completion = False
            assessment.save(update_fields=['published', 'required_for_completion', 'updated_at'])
        else:
            assessment.delete()

    for module in course.modules.exclude(pk__in=keep_modules):
        has_history = (
            LessonProgress.objects.filter(lesson__module=module).exists()
            or AssessmentAttempt.objects.filter(assessment__module=module).exists()
        )
        if has_history:
            module.lessons.update(published=False, is_required=False)
            module.assessments.update(published=False, required_for_completion=False)
        else:
            module.delete()


def _course_relation_fields(course, data):
    if 'category_id' in data:
        category_id = data.get('category_id')
        if category_id in (None, ''):
            course.category = None
        else:
            category = CourseCategory.objects.filter(pk=category_id).first()
            if not category:
                raise ValueError('category_not_found')
            course.category = category

    if 'provider' in data:
        provider = str(data.get('provider') or Course.Provider.NATIVE)
        if provider not in Course.Provider.values:
            raise ValueError('invalid_course_provider')
        course.provider = provider

    if 'openedx_course_key' in data:
        course.openedx_course_key = str(data.get('openedx_course_key') or '').strip()
    if 'openedx_course_url' in data:
        course.openedx_course_url = _safe_http_url(data.get('openedx_course_url'))
    if 'openedx_studio_url' in data:
        course.openedx_studio_url = _safe_http_url(data.get('openedx_studio_url'))

    for field, expected in (
        ('registration_schema', list),
        ('payment_config', dict),
        ('learning_config', dict),
    ):
        if field in data:
            value = data.get(field)
            if not isinstance(value, expected):
                raise ValueError(f'invalid_{field}')
            setattr(course, field, value)


def _save_course_relations(course, data):
    if 'tag_ids' in data:
        values = data.get('tag_ids')
        if not isinstance(values, list):
            raise ValueError('invalid_tag_ids')
        tags = list(CourseTag.objects.filter(pk__in=values))
        if len({tag.pk for tag in tags}) != len({int(value) for value in values if str(value).isdigit()}):
            raise ValueError('tag_not_found')
        course.tags.set(tags)

    if 'instructors' in data:
        rows = data.get('instructors')
        if not isinstance(rows, list):
            raise ValueError('invalid_instructors')
        User = get_user_model()
        clean = []
        seen = set()
        for position, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ValueError('invalid_instructor')
            try:
                user = User.objects.get(pk=int(row.get('user_id')))
            except (User.DoesNotExist, TypeError, ValueError):
                raise ValueError('instructor_not_found')
            role = str(row.get('role') or CourseInstructor.Role.INSTRUCTOR)
            if role not in CourseInstructor.Role.values:
                raise ValueError('invalid_instructor_role')
            if user.pk in seen:
                continue
            seen.add(user.pk)
            clean.append((user, role, position))
        course.instructor_links.exclude(user_id__in=seen).delete()
        for user, role, position in clean:
            CourseInstructor.objects.update_or_create(
                course=course,
                user=user,
                defaults={'role': role, 'position': position},
            )


def _openedx_sync_enrollment(enrollment):
    course = enrollment.course
    if (
        course.provider != Course.Provider.OPENEDX
        or not course.openedx_course_key
        or not openedx_bridge.configured()
    ):
        return
    state = dict(enrollment.provider_state or {})
    try:
        openedx_bridge.allow_enrollment(
            email=enrollment.user.email,
            course_key=course.openedx_course_key,
        )
        try:
            openedx_bridge.enroll_by_email(
                email=enrollment.user.email,
                course_key=course.openedx_course_key,
            )
            sync_state = 'enrolled'
            sync_error = ''
        except openedx_bridge.OpenEdXError as exc:
            if str(exc) == 'openedx_account_pending':
                sync_state = 'allowed_pending_account'
                sync_error = str(exc)
            else:
                raise
        state['openedx'] = {
            'state': sync_state,
            'course_key': course.openedx_course_key,
            'error': sync_error,
            'synced_at': timezone.now().isoformat(),
        }
    except openedx_bridge.OpenEdXError as exc:
        state['openedx'] = {
            'state': 'pending',
            'course_key': course.openedx_course_key,
            'error': str(exc),
            'synced_at': timezone.now().isoformat(),
        }
    enrollment.provider_state = state
    enrollment.save(update_fields=['provider_state', 'updated_at'])


@require_http_methods(['GET', 'POST'])
def lms_courses(request):
    if request.method == 'GET':
        admin = _is_core_admin(request.user)
        qs = Course.objects.all() if admin and request.GET.get('all') == '1' else Course.objects.filter(status=Course.Status.PUBLISHED)
        return JsonResponse({
            'ok': True,
            'courses': [_course_json(course, request.user) for course in qs],
        })

    denied = _auth_required(request)
    if denied:
        return denied
    if not _is_core_admin(request.user):
        return JsonResponse({'ok': False, 'error': 'core_admin_required'}, status=403)
    data = _payload(request)
    if data is None:
        return JsonResponse({'ok': False, 'error': 'invalid_json'}, status=400)
    title = str(data.get('title') or '').strip()
    slug = str(data.get('slug') or '').strip()
    if not title or not slug:
        return JsonResponse({'ok': False, 'error': 'title_and_slug_required'}, status=400)
    access_type = str(data.get('access_type') or Course.AccessType.OPEN)
    if access_type not in Course.AccessType.values:
        return JsonResponse({'ok': False, 'error': 'invalid_access_type'}, status=400)
    status = str(data.get('status') or Course.Status.DRAFT)
    if status not in Course.Status.values:
        return JsonResponse({'ok': False, 'error': 'invalid_status'}, status=400)
    try:
        price = _as_decimal(data.get('price'))
    except ValueError:
        return JsonResponse({'ok': False, 'error': 'invalid_price'}, status=400)
    if access_type == Course.AccessType.PAID and (price is None or price <= 0):
        return JsonResponse({'ok': False, 'error': 'paid_course_price_required'}, status=400)

    try:
        with transaction.atomic():
            course = Course(
                slug=slug,
                title=title,
                summary=str(data.get('summary') or ''),
                description=str(data.get('description') or ''),
                status=status,
                access_type=access_type,
                price=price,
                currency=str(data.get('currency') or 'EUR')[:8].upper(),
                certificate_enabled=bool(data.get('certificate_enabled', True)),
                created_by=request.user,
                published_at=timezone.now() if status == Course.Status.PUBLISHED else None,
            )
            _course_relation_fields(course, data)
            if course.provider == Course.Provider.OPENEDX and not course.openedx_course_key:
                raise ValueError('openedx_course_key_required')
            course.save()
            _save_course_relations(course, data)
            _replace_structure(course, data.get('modules') or [], data.get('assessments') or [])
    except ValueError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=400)
    except IntegrityError:
        return JsonResponse({'ok': False, 'error': 'course_slug_exists'}, status=409)

    record_activity(
        layer=ActivityEvent.Layer.LMS,
        action='course.created',
        actor=request.user,
        object_type='course',
        object_id=course.pk,
        detail={'title': course.title, 'status': course.status, 'access_type': course.access_type},
    )
    return JsonResponse({'ok': True, 'course': _course_json(course, request.user, include_structure=True)}, status=201)


@require_http_methods(['GET', 'PATCH'])
def lms_course_detail(request, course_id):
    try:
        course = Course.objects.get(pk=course_id)
    except Course.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'course_not_found'}, status=404)

    admin = _is_core_admin(request.user)
    if request.method == 'GET':
        if course.status != Course.Status.PUBLISHED and not admin:
            return JsonResponse({'ok': False, 'error': 'course_not_found'}, status=404)
        return JsonResponse({'ok': True, 'course': _course_json(course, request.user, include_structure=True)})

    denied = _auth_required(request)
    if denied:
        return denied
    if not admin:
        return JsonResponse({'ok': False, 'error': 'core_admin_required'}, status=403)
    data = _payload(request)
    if data is None:
        return JsonResponse({'ok': False, 'error': 'invalid_json'}, status=400)

    try:
        with transaction.atomic():
            course = Course.objects.select_for_update().get(pk=course.pk)
            for field in ('title', 'summary', 'description', 'currency'):
                if field in data:
                    setattr(course, field, str(data[field] or '').strip() if field == 'title' else str(data[field] or ''))
            if 'slug' in data:
                course.slug = str(data['slug'] or '').strip()
            if 'access_type' in data:
                value = str(data['access_type'])
                if value not in Course.AccessType.values:
                    raise ValueError('invalid_access_type')
                course.access_type = value
            if 'status' in data:
                value = str(data['status'])
                if value not in Course.Status.values:
                    raise ValueError('invalid_status')
                if value == Course.Status.PUBLISHED and not course.published_at:
                    course.published_at = timezone.now()
                course.status = value
            if 'price' in data:
                course.price = _as_decimal(data.get('price'))
            if 'certificate_enabled' in data:
                course.certificate_enabled = bool(data['certificate_enabled'])
            _course_relation_fields(course, data)
            if course.provider == Course.Provider.OPENEDX and not course.openedx_course_key:
                raise ValueError('openedx_course_key_required')
            if course.access_type == Course.AccessType.PAID and (course.price is None or course.price <= 0):
                raise ValueError('paid_course_price_required')
            course.save()
            _save_course_relations(course, data)
            has_modules = 'modules' in data
            has_assessments = 'assessments' in data
            if has_modules != has_assessments:
                raise ValueError('complete_structure_payload_required')
            if has_modules and has_assessments:
                _replace_structure(course, data.get('modules') or [], data.get('assessments') or [])
    except ValueError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=409 if str(exc) == 'course_structure_locked_after_enrollment' else 400)
    except IntegrityError:
        return JsonResponse({'ok': False, 'error': 'course_slug_exists'}, status=409)

    record_activity(
        layer=ActivityEvent.Layer.LMS,
        action='course.updated',
        actor=request.user,
        object_type='course',
        object_id=course.pk,
        detail={'fields': sorted(data.keys())},
    )
    return JsonResponse({'ok': True, 'course': _course_json(course, request.user, include_structure=True)})


@require_http_methods(['POST'])
def lms_course_enroll(request, course_id):
    denied = _auth_required(request)
    if denied:
        return denied
    try:
        course = Course.objects.get(pk=course_id)
    except Course.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'course_not_found'}, status=404)
    data = _payload(request)
    if data is None:
        return JsonResponse({'ok': False, 'error': 'invalid_json'}, status=400)

    admin = _is_core_admin(request.user)
    target = request.user
    source = CourseEnrollment.AccessSource.OPEN
    if data.get('user_id') not in (None, '', request.user.pk):
        if not admin:
            return JsonResponse({'ok': False, 'error': 'core_admin_required'}, status=403)
        try:
            target = get_user_model().objects.get(pk=int(data['user_id']))
        except (get_user_model().DoesNotExist, TypeError, ValueError):
            return JsonResponse({'ok': False, 'error': 'user_not_found'}, status=404)
        source = CourseEnrollment.AccessSource.ADMIN

    if target.pk == request.user.pk and not admin:
        if course.status != Course.Status.PUBLISHED:
            return JsonResponse({'ok': False, 'error': 'course_not_available'}, status=403)
        if course.access_type == Course.AccessType.LOCKED:
            return JsonResponse({'ok': False, 'error': 'course_access_required'}, status=403)
        if course.access_type == Course.AccessType.PAID:
            # V1 deliberately does not fake a purchase. A payment integration
            # must create/grant the enrollment after a verified transaction.
            return JsonResponse({'ok': False, 'error': 'payment_required'}, status=402)

    enrollment, created = CourseEnrollment.objects.update_or_create(
        user=target,
        course=course,
        defaults={
            'status': CourseEnrollment.Status.ACTIVE,
            'access_source': source if admin and target.pk != request.user.pk else CourseEnrollment.AccessSource.OPEN,
            'granted_by': request.user if admin and target.pk != request.user.pk else None,
        },
    )
    _openedx_sync_enrollment(enrollment)
    profile, _ = CourseRegistrationProfile.objects.get_or_create(enrollment=enrollment)
    if not course.registration_schema and not profile.completed:
        profile.completed = True
        profile.completed_at = timezone.now()
        profile.save(update_fields=['completed', 'completed_at', 'updated_at'])

    set_module_grant(
        target,
        ModuleGrant.Module.LMS,
        enabled=True,
        access_level=ModuleGrant.AccessLevel.PARTICIPATE,
        source=ModuleGrant.Source.ENROLLMENT,
        granted_by=request.user if admin and target.pk != request.user.pk else None,
        metadata={'course_id': course.pk, 'enrollment_id': enrollment.pk},
    )
    record_activity(
        layer=ActivityEvent.Layer.LMS,
        action='course.enrolled' if created else 'course.enrollment_reactivated',
        actor=request.user,
        subject_user=target,
        object_type='course',
        object_id=course.pk,
        detail={'title': course.title, 'source': enrollment.access_source},
    )
    return JsonResponse({'ok': True, 'enrollment': _enrollment_json(enrollment)}, status=201 if created else 200)


def _enrollment_json(enrollment):
    try:
        registration_complete = bool(enrollment.registration_profile.completed)
    except CourseRegistrationProfile.DoesNotExist:
        registration_complete = not bool(enrollment.course.registration_schema)
    return {
        'id': enrollment.pk,
        'course_id': enrollment.course_id,
        'course_title': enrollment.course.title,
        'status': enrollment.status,
        'access_source': enrollment.access_source,
        'progress_percent': str(enrollment.progress_percent),
        'provider_state': enrollment.provider_state,
        'registration_complete': registration_complete,
        'enrolled_at': _iso(enrollment.enrolled_at),
        'completed_at': _iso(enrollment.completed_at),
        'certificate': _certificate_json(enrollment),
    }


@require_http_methods(['GET'])
def lms_me(request):
    denied = _auth_required(request)
    if denied:
        return denied
    enabled = module_access(request.user, ModuleGrant.Module.LMS)
    enrollments = CourseEnrollment.objects.filter(user=request.user).select_related('course').order_by('-updated_at')
    return JsonResponse({
        'ok': True,
        'access': enabled,
        'enrollments': [_enrollment_json(item) for item in enrollments],
    })


def _recompute_enrollment(enrollment):
    course = enrollment.course
    required_lessons = Lesson.objects.filter(module__course=course, published=True, is_required=True)
    required_assessments = Assessment.objects.filter(course=course, published=True, required_for_completion=True)

    lesson_total = required_lessons.count()
    lesson_done = LessonProgress.objects.filter(
        enrollment=enrollment,
        lesson__in=required_lessons,
        completed=True,
    ).count()
    assessment_total = required_assessments.count()
    assessment_done = sum(
        1
        for assessment in required_assessments
        if AssessmentAttempt.objects.filter(enrollment=enrollment, assessment=assessment, passed=True).exists()
    )

    total = lesson_total + assessment_total
    done = lesson_done + assessment_done
    enrollment.progress_percent = Decimal('0.00') if total == 0 else (Decimal(done) * Decimal('100') / Decimal(total)).quantize(Decimal('0.01'))

    completed_now = total > 0 and done == total
    was_completed = enrollment.status == CourseEnrollment.Status.COMPLETED
    if completed_now:
        enrollment.status = CourseEnrollment.Status.COMPLETED
        enrollment.completed_at = enrollment.completed_at or timezone.now()
    elif enrollment.status == CourseEnrollment.Status.COMPLETED:
        enrollment.status = CourseEnrollment.Status.ACTIVE
        enrollment.completed_at = None
    enrollment.save(update_fields=['progress_percent', 'status', 'completed_at', 'updated_at'])

    certificate = None
    if completed_now and course.certificate_enabled:
        certificate, _ = Certificate.objects.get_or_create(enrollment=enrollment)
    return completed_now and not was_completed, certificate


@require_http_methods(['PUT'])
def lms_lesson_progress(request, lesson_id):
    denied = _auth_required(request)
    if denied:
        return denied
    if not module_access(request.user, ModuleGrant.Module.LMS):
        return JsonResponse({'ok': False, 'error': 'lms_access_required'}, status=403)
    try:
        lesson = Lesson.objects.select_related('module__course').get(pk=lesson_id, published=True)
    except Lesson.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'lesson_not_found'}, status=404)
    enrollment = CourseEnrollment.objects.filter(
        user=request.user,
        course=lesson.module.course,
        status__in=[CourseEnrollment.Status.ACTIVE, CourseEnrollment.Status.COMPLETED],
    ).first()
    if not enrollment:
        return JsonResponse({'ok': False, 'error': 'course_enrollment_required'}, status=403)
    if lesson.module.course.registration_schema:
        try:
            profile_complete = bool(enrollment.registration_profile.completed)
        except CourseRegistrationProfile.DoesNotExist:
            profile_complete = False
        if not profile_complete:
            return JsonResponse({'ok': False, 'error': 'course_profile_required'}, status=409)
    rule_open, lock_reason = _lesson_access(lesson, enrollment)
    if not rule_open:
        return JsonResponse({'ok': False, 'error': 'lesson_locked', 'reason': lock_reason}, status=409)
    data = _payload(request)
    if data is None:
        return JsonResponse({'ok': False, 'error': 'invalid_json'}, status=400)
    progress, _ = LessonProgress.objects.get_or_create(enrollment=enrollment, lesson=lesson)
    if 'completed' in data:
        progress.completed = bool(data['completed'])
    if 'progress_seconds' in data:
        try:
            progress.progress_seconds = max(0, int(data['progress_seconds']))
        except (TypeError, ValueError):
            return JsonResponse({'ok': False, 'error': 'invalid_progress_seconds'}, status=400)
    if 'score' in data:
        try:
            progress.score = _as_decimal(data['score'])
        except ValueError:
            return JsonResponse({'ok': False, 'error': 'invalid_score'}, status=400)
    if isinstance(data.get('state'), dict):
        progress.state = data['state']
    progress.save()
    completed_now, certificate = _recompute_enrollment(enrollment)

    if progress.completed:
        record_activity(
            layer=ActivityEvent.Layer.LMS,
            action='lesson.completed',
            actor=request.user,
            subject_user=request.user,
            object_type='lesson',
            object_id=lesson.pk,
            detail={'course_id': enrollment.course_id, 'title': lesson.title},
        )
    if completed_now:
        record_activity(
            layer=ActivityEvent.Layer.LMS,
            action='course.completed',
            actor=request.user,
            subject_user=request.user,
            object_type='course',
            object_id=enrollment.course_id,
            detail={'certificate_code': str(certificate.code) if certificate else None},
        )
    return JsonResponse({
        'ok': True,
        'progress': {
            'lesson_id': lesson.pk,
            'completed': progress.completed,
            'progress_seconds': progress.progress_seconds,
            'score': str(progress.score) if progress.score is not None else None,
        },
        'enrollment': _enrollment_json(enrollment),
    })


@require_http_methods(['POST'])
def lms_assessment_attempt(request, assessment_id):
    denied = _auth_required(request)
    if denied:
        return denied
    if not module_access(request.user, ModuleGrant.Module.LMS):
        return JsonResponse({'ok': False, 'error': 'lms_access_required'}, status=403)
    try:
        assessment = Assessment.objects.select_related('course').get(pk=assessment_id, published=True)
    except Assessment.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'assessment_not_found'}, status=404)
    enrollment = CourseEnrollment.objects.filter(
        user=request.user,
        course=assessment.course,
        status__in=[CourseEnrollment.Status.ACTIVE, CourseEnrollment.Status.COMPLETED],
    ).first()
    if not enrollment:
        return JsonResponse({'ok': False, 'error': 'course_enrollment_required'}, status=403)
    if assessment.course.registration_schema:
        try:
            profile_complete = bool(enrollment.registration_profile.completed)
        except CourseRegistrationProfile.DoesNotExist:
            profile_complete = False
        if not profile_complete:
            return JsonResponse({'ok': False, 'error': 'course_profile_required'}, status=409)
    data = _payload(request)
    if data is None or not isinstance(data.get('answers'), dict):
        return JsonResponse({'ok': False, 'error': 'answers_required'}, status=400)

    previous = AssessmentAttempt.objects.filter(enrollment=enrollment, assessment=assessment).count()
    if previous >= assessment.max_attempts:
        return JsonResponse({'ok': False, 'error': 'max_attempts_reached'}, status=409)

    scorable = []
    for index, question in enumerate(assessment.questions or [], start=1):
        if not isinstance(question, dict):
            continue
        qid = str(question.get('id') or index)
        expected = question.get('correct_answer', question.get('correct'))
        if expected is not None:
            scorable.append((qid, expected))
    if not scorable:
        return JsonResponse({'ok': False, 'error': 'assessment_not_scorable'}, status=409)

    answers = data['answers']
    correct = sum(1 for qid, expected in scorable if answers.get(qid) == expected)
    score = (Decimal(correct) * Decimal('100') / Decimal(len(scorable))).quantize(Decimal('0.01'))
    passed = score >= assessment.passing_score
    attempt = AssessmentAttempt.objects.create(
        enrollment=enrollment,
        assessment=assessment,
        attempt_no=previous + 1,
        answers=answers,
        score=score,
        passed=passed,
    )
    completed_now, certificate = _recompute_enrollment(enrollment)
    record_activity(
        layer=ActivityEvent.Layer.LMS,
        action='assessment.submitted',
        actor=request.user,
        subject_user=request.user,
        object_type='assessment',
        object_id=assessment.pk,
        detail={'score': str(score), 'passed': passed, 'attempt_no': attempt.attempt_no},
    )
    if completed_now:
        record_activity(
            layer=ActivityEvent.Layer.LMS,
            action='course.completed',
            actor=request.user,
            subject_user=request.user,
            object_type='course',
            object_id=enrollment.course_id,
            detail={'certificate_code': str(certificate.code) if certificate else None},
        )
    return JsonResponse({
        'ok': True,
        'attempt': {
            'id': attempt.pk,
            'attempt_no': attempt.attempt_no,
            'score': str(attempt.score),
            'passed': attempt.passed,
            'submitted_at': _iso(attempt.submitted_at),
        },
        'enrollment': _enrollment_json(enrollment),
    })
