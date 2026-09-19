import base64
import io
import json
import re
import secrets
import zipfile
from urllib.parse import quote

import requests
from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import cloud
from .lms_models import (
    Course,
    CourseDiscussionMessage,
    CourseEnrollment,
    CourseEvent,
    CoursePayment,
    CourseRegistrationProfile,
    LearnerPathAssignment,
    LearningIntegration,
    LearningPath,
    LearningRepository,
    Lesson,
    NotebookWorkspace,
)
from .layer_access import set_module_grant
from .layer_models import ModuleGrant
from .lms_api import _openedx_sync_enrollment
from .platform_runtime_v3 import core_role, ensure_platform_workspaces
from .pulsar import PulsarError, complete


REQUEST_TIMEOUT = 8
SAFE_NOTE = re.compile(r'[^A-Za-z0-9._ -]+')


def _json_body(request):
    try:
        data = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _admin(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    spaces = ensure_platform_workspaces(user)
    return core_role(user, spaces['core']) in {'owner', 'admin'}


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


def _access(user, course):
    enrollment = _enrollment(user, course)
    return (_admin(user) or bool(enrollment)), enrollment


def _event(user, course, kind, *, enrollment=None, lesson=None, metadata=None):
    if not user or not user.is_authenticated:
        return None
    return CourseEvent.objects.create(
        user=user,
        course=course,
        enrollment=enrollment,
        lesson=lesson,
        kind=kind,
        metadata=metadata if isinstance(metadata, dict) else {},
    )


def _payment_json(item):
    return {
        'id': item.pk,
        'course_id': item.course_id,
        'course_title': item.course.title,
        'user_id': item.user_id,
        'user_name': item.user.get_full_name() or item.user.email,
        'user_email': item.user.email,
        'provider': item.provider,
        'amount': str(item.amount),
        'currency': item.currency,
        'status': item.status,
        'external_reference': item.external_reference,
        'checkout_url': item.checkout_url,
        'metadata': item.metadata,
        'verified_by': (
            item.verified_by.get_full_name() or item.verified_by.email
            if item.verified_by_id else ''
        ),
        'verified_at': item.verified_at.isoformat() if item.verified_at else None,
        'created_at': item.created_at.isoformat(),
        'updated_at': item.updated_at.isoformat(),
    }


def _render_checkout_url(template, payment):
    url = str(template or '')
    replacements = {
        '{payment_id}': str(payment.pk),
        '{course_id}': str(payment.course_id),
        '{user_email}': quote(payment.user.email, safe=''),
        '{amount}': quote(str(payment.amount), safe=''),
        '{currency}': quote(payment.currency, safe=''),
    }
    for token, value in replacements.items():
        url = url.replace(token, value)
    return url


def _grant_paid_enrollment(payment, actor):
    enrollment, _created = CourseEnrollment.objects.update_or_create(
        user=payment.user,
        course=payment.course,
        defaults={
            'status': CourseEnrollment.Status.ACTIVE,
            'access_source': CourseEnrollment.AccessSource.PURCHASE,
            'granted_by': actor,
        },
    )
    profile, _ = CourseRegistrationProfile.objects.get_or_create(enrollment=enrollment)
    if not payment.course.registration_schema and not profile.completed:
        profile.completed = True
        profile.completed_at = timezone.now()
        profile.save(update_fields=['completed', 'completed_at', 'updated_at'])
    set_module_grant(
        payment.user,
        ModuleGrant.Module.LMS,
        enabled=True,
        access_level=ModuleGrant.AccessLevel.PARTICIPATE,
        source=ModuleGrant.Source.ENROLLMENT,
        granted_by=actor,
        metadata={'course_id': payment.course_id, 'enrollment_id': enrollment.pk, 'payment_id': payment.pk},
    )
    _openedx_sync_enrollment(enrollment)
    return enrollment


def _message_json(item):
    return {
        'id': item.pk,
        'course_id': item.course_id,
        'body': '' if item.deleted else item.body,
        'deleted': item.deleted,
        'reply_to_id': item.reply_to_id,
        'author': {
            'id': item.author_id,
            'name': item.author.get_full_name() or item.author.email,
            'email': item.author.email,
        },
        'created_at': item.created_at.isoformat(),
        'updated_at': item.updated_at.isoformat(),
    }


@require_http_methods(['GET', 'POST'])
def course_checkout(request, course_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    course = _course(course_id)
    if not course or course.status != Course.Status.PUBLISHED:
        return _error('course_not_found', 404)
    if course.access_type != Course.AccessType.PAID:
        return _error('course_not_paid', 409)
    if _enrollment(request.user, course):
        return JsonResponse({'ok': True, 'enrolled': True, 'payments': []})

    rows = (
        CoursePayment.objects
        .filter(user=request.user, course=course)
        .select_related('course', 'user', 'verified_by')
        .order_by('-created_at')
    )
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'enrolled': False, 'payments': [_payment_json(item) for item in rows[:20]]})

    config = course.payment_config if isinstance(course.payment_config, dict) else {}
    if not config.get('enabled'):
        return _error('checkout_not_enabled', 409)
    checkout_url = str(config.get('checkout_url') or '').strip()
    if not checkout_url:
        return _error('checkout_url_missing', 409)
    provider = str(config.get('provider') or 'external').strip().lower()
    if provider not in {'external', 'stripe', 'sumup'}:
        return _error('invalid_payment_provider', 409)

    pending = rows.filter(status=CoursePayment.Status.PENDING).first()
    if pending:
        pending.provider = provider
        pending.amount = course.price
        pending.currency = course.currency
        pending.checkout_url = _render_checkout_url(checkout_url, pending)
        pending.save(update_fields=['checkout_url', 'provider', 'amount', 'currency', 'updated_at'])
        return JsonResponse({'ok': True, 'payment': _payment_json(pending)})

    payment = CoursePayment.objects.create(
        user=request.user,
        course=course,
        provider=provider,
        amount=course.price,
        currency=course.currency,
        checkout_url='',
        metadata={
            'sku': str(config.get('sku') or ''),
            'created_from': 'learner_checkout',
        },
    )
    payment.checkout_url = _render_checkout_url(checkout_url, payment)
    payment.save(update_fields=['checkout_url', 'updated_at'])
    return JsonResponse({'ok': True, 'payment': _payment_json(payment)}, status=201)


@csrf_exempt
@require_http_methods(['POST'])
def course_payment_webhook(request, course_id):
    course = _course(course_id)
    if not course:
        return _error('course_not_found', 404)
    config = course.payment_config if isinstance(course.payment_config, dict) else {}
    secret = str(config.get('webhook_secret') or '')
    supplied = str(request.headers.get('X-Gravitas-Payment-Secret') or '')
    if not secret or not supplied or not secrets.compare_digest(secret, supplied):
        return _error('payment_webhook_unauthorized', 403)

    data = _json_body(request)
    try:
        payment_id = int(data.get('payment_id'))
    except (TypeError, ValueError):
        return _error('payment_id_required')
    payment = (
        CoursePayment.objects
        .select_related('course', 'user', 'verified_by')
        .filter(pk=payment_id, course=course)
        .first()
    )
    if not payment:
        return _error('payment_not_found', 404)

    status = str(data.get('status') or '').strip().lower()
    if status not in CoursePayment.Status.values:
        return _error('invalid_payment_status')
    if 'external_reference' in data:
        payment.external_reference = str(data.get('external_reference') or '').strip()[:240]
    payment.status = status
    metadata = dict(payment.metadata or {})
    metadata['verified_via'] = 'webhook'
    if isinstance(data.get('metadata'), dict):
        metadata['provider_payload'] = data['metadata']
    payment.metadata = metadata
    if status == CoursePayment.Status.PAID:
        payment.verified_by = None
        payment.verified_at = timezone.now()
    elif status in {CoursePayment.Status.PENDING, CoursePayment.Status.FAILED, CoursePayment.Status.CANCELLED}:
        payment.verified_by = None
        payment.verified_at = None
    payment.save()

    enrollment = None
    if status == CoursePayment.Status.PAID:
        enrollment = _grant_paid_enrollment(payment, None)
    elif status == CoursePayment.Status.REFUNDED:
        enrollment = CourseEnrollment.objects.filter(user=payment.user, course=payment.course).first()
        if enrollment and enrollment.access_source == CourseEnrollment.AccessSource.PURCHASE:
            enrollment.status = CourseEnrollment.Status.REVOKED
            enrollment.save(update_fields=['status', 'updated_at'])

    return JsonResponse({
        'ok': True,
        'payment': _payment_json(payment),
        'enrollment_id': enrollment.pk if enrollment else None,
        'enrollment_status': enrollment.status if enrollment else None,
    })


@require_http_methods(['GET', 'PATCH'])
def admin_course_payments(request):
    if not _admin(request.user):
        return _error('core_admin_required', 403)

    if request.method == 'GET':
        qs = (
            CoursePayment.objects
            .select_related('course', 'user', 'verified_by')
            .order_by('-created_at')
        )
        course_id = request.GET.get('course_id')
        user_id = request.GET.get('user_id')
        status = str(request.GET.get('status') or '').strip()
        if course_id:
            qs = qs.filter(course_id=course_id)
        if user_id:
            qs = qs.filter(user_id=user_id)
        if status:
            if status not in CoursePayment.Status.values:
                return _error('invalid_payment_status')
            qs = qs.filter(status=status)
        return JsonResponse({'ok': True, 'payments': [_payment_json(item) for item in qs[:500]]})

    data = _json_body(request)
    try:
        payment_id = int(data.get('payment_id'))
    except (TypeError, ValueError):
        return _error('payment_id_required')
    payment = (
        CoursePayment.objects
        .select_related('course', 'user', 'verified_by')
        .filter(pk=payment_id)
        .first()
    )
    if not payment:
        return _error('payment_not_found', 404)

    status = str(data.get('status') or payment.status).strip()
    if status not in CoursePayment.Status.values:
        return _error('invalid_payment_status')
    if 'external_reference' in data:
        payment.external_reference = str(data.get('external_reference') or '').strip()[:240]

    payment.status = status
    if status == CoursePayment.Status.PAID:
        payment.verified_by = request.user
        payment.verified_at = timezone.now()
    elif status in {CoursePayment.Status.PENDING, CoursePayment.Status.FAILED, CoursePayment.Status.CANCELLED}:
        payment.verified_by = None
        payment.verified_at = None
    payment.save()

    enrollment = None
    if status == CoursePayment.Status.PAID:
        enrollment = _grant_paid_enrollment(payment, request.user)
    elif status == CoursePayment.Status.REFUNDED:
        enrollment = CourseEnrollment.objects.filter(user=payment.user, course=payment.course).first()
        if enrollment and enrollment.access_source == CourseEnrollment.AccessSource.PURCHASE:
            enrollment.status = CourseEnrollment.Status.REVOKED
            enrollment.save(update_fields=['status', 'updated_at'])

    payload = _payment_json(payment)
    payload['enrollment_id'] = enrollment.pk if enrollment else None
    payload['enrollment_status'] = enrollment.status if enrollment else None
    return JsonResponse({'ok': True, 'payment': payload})


@require_http_methods(['GET', 'POST'])
def course_discussion(request, course_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    course = _course(course_id)
    if not course:
        return _error('course_not_found', 404)
    allowed, enrollment = _access(request.user, course)
    if not allowed:
        return _error('course_enrollment_required', 403)
    if (course.learning_config or {}).get('discussions_enabled', True) is False and not _admin(request.user):
        return _error('course_discussion_disabled', 403)

    if request.method == 'GET':
        rows = course.discussion_messages.select_related('author', 'reply_to').order_by('-created_at')[:250]
        return JsonResponse({'ok': True, 'messages': [_message_json(item) for item in reversed(list(rows))]})

    data = _json_body(request)
    body = str(data.get('body') or '').strip()[:12000]
    if not body:
        return _error('message_required')
    reply_to = None
    if data.get('reply_to_id'):
        reply_to = CourseDiscussionMessage.objects.filter(pk=data['reply_to_id'], course=course).first()
        if not reply_to:
            return _error('reply_target_not_found', 404)
    item = CourseDiscussionMessage.objects.create(
        course=course,
        author=request.user,
        reply_to=reply_to,
        body=body,
    )
    _event(
        request.user,
        course,
        CourseEvent.Kind.DISCUSSION_POST,
        enrollment=enrollment,
        metadata={'reply': bool(reply_to)},
    )
    return JsonResponse({'ok': True, 'message': _message_json(item)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def course_discussion_detail(request, course_id, message_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    course = _course(course_id)
    if not course:
        return _error('course_not_found', 404)
    allowed, _enrollment_row = _access(request.user, course)
    if not allowed:
        return _error('course_enrollment_required', 403)
    item = CourseDiscussionMessage.objects.select_related('author').filter(pk=message_id, course=course).first()
    if not item:
        return _error('message_not_found', 404)
    if item.author_id != request.user.pk and not _admin(request.user):
        return _error('permission_denied', 403)

    if request.method == 'DELETE':
        item.body = ''
        item.deleted = True
        item.save(update_fields=['body', 'deleted', 'updated_at'])
        return JsonResponse({'ok': True})

    body = str(_json_body(request).get('body') or '').strip()[:12000]
    if not body:
        return _error('message_required')
    item.body = body
    item.deleted = False
    item.save(update_fields=['body', 'deleted', 'updated_at'])
    return JsonResponse({'ok': True, 'message': _message_json(item)})


def _integration_json(item):
    return {
        'id': item.pk,
        'provider': item.provider,
        'label': item.label,
        'account_id': item.account_id,
        'connected': bool(item.account_id or item.encrypted_token),
        'has_token': bool(item.encrypted_token),
        'metadata': item.metadata,
        'updated_at': item.updated_at.isoformat(),
    }


def _github_identity(token):
    response = requests.get(
        'https://api.github.com/user',
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json'},
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        raise ValueError('github_credentials_invalid')
    data = response.json()
    return str(data.get('login') or ''), str(data.get('html_url') or '')


def _medium_identity(token):
    response = requests.get(
        'https://api.medium.com/v1/me',
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/json'},
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        raise ValueError('medium_credentials_invalid')
    data = (response.json() or {}).get('data') or {}
    return str(data.get('id') or ''), str(data.get('name') or data.get('username') or '')


@require_http_methods(['GET', 'POST', 'DELETE'])
def learning_integrations(request):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    if request.method == 'GET':
        rows = LearningIntegration.objects.filter(user=request.user)
        return JsonResponse({'ok': True, 'integrations': [_integration_json(item) for item in rows]})

    data = _json_body(request)
    provider = str(data.get('provider') or '').strip().lower()
    if provider not in LearningIntegration.Provider.values:
        return _error('invalid_provider')

    if request.method == 'DELETE':
        LearningIntegration.objects.filter(user=request.user, provider=provider).delete()
        return JsonResponse({'ok': True})

    token = str(data.get('token') or '').strip()
    account_id = str(data.get('account_id') or '').strip()[:320]
    label = str(data.get('label') or '').strip()[:160]
    metadata = data.get('metadata') if isinstance(data.get('metadata'), dict) else {}
    validate = bool(data.get('validate', True))

    if provider == LearningIntegration.Provider.ORCID:
        if not re.fullmatch(r'\d{4}-\d{4}-\d{4}-[\dX]{4}', account_id, flags=re.I):
            return _error('invalid_orcid')
        token = ''
        label = label or f'ORCID {account_id}'
    else:
        if not token:
            existing = LearningIntegration.objects.filter(user=request.user, provider=provider).first()
            if not existing or not existing.encrypted_token:
                return _error('token_required')
            encrypted = existing.encrypted_token
        else:
            encrypted = cloud._encrypt(token)

        if validate and token:
            try:
                if provider == LearningIntegration.Provider.GITHUB:
                    account_id, profile_url = _github_identity(token)
                    metadata = {**metadata, 'profile_url': profile_url}
                    label = label or account_id
                elif provider == LearningIntegration.Provider.MEDIUM:
                    account_id, medium_name = _medium_identity(token)
                    label = label or medium_name or account_id
                elif provider == LearningIntegration.Provider.LINKEDIN and not account_id.startswith('urn:li:'):
                    return _error('linkedin_author_urn_required')
            except (requests.RequestException, ValueError) as exc:
                return _error(str(exc), 400)

    defaults = {
        'label': label,
        'account_id': account_id,
        'metadata': metadata,
    }
    if provider != LearningIntegration.Provider.ORCID:
        defaults['encrypted_token'] = encrypted

    item, _ = LearningIntegration.objects.update_or_create(
        user=request.user,
        provider=provider,
        defaults=defaults,
    )
    return JsonResponse({'ok': True, 'integration': _integration_json(item)}, status=201)


def _paper(provider, title, *, url='', authors=None, year='', abstract='', external_id=''):
    return {
        'provider': provider,
        'title': str(title or '').strip(),
        'url': str(url or '').strip(),
        'authors': authors or [],
        'year': str(year or ''),
        'abstract': str(abstract or '')[:2400],
        'external_id': str(external_id or ''),
    }


def _search_semantic(query, limit):
    response = requests.get(
        'https://api.semanticscholar.org/graph/v1/paper/search',
        params={
            'query': query,
            'limit': min(limit, 20),
            'fields': 'title,authors,year,url,abstract,externalIds',
        },
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    out = []
    for item in (response.json() or {}).get('data') or []:
        external = item.get('externalIds') or {}
        out.append(_paper(
            'semantic_scholar',
            item.get('title'),
            url=item.get('url'),
            authors=[a.get('name') for a in item.get('authors') or [] if a.get('name')],
            year=item.get('year'),
            abstract=item.get('abstract'),
            external_id=external.get('DOI') or item.get('paperId'),
        ))
    return out


def _search_inspire(query, limit):
    response = requests.get(
        'https://inspirehep.net/api/literature',
        params={'q': query, 'size': min(limit, 20)},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    out = []
    for hit in ((response.json() or {}).get('hits') or {}).get('hits') or []:
        meta = hit.get('metadata') or {}
        titles = meta.get('titles') or []
        title = (titles[0] or {}).get('title') if titles else ''
        authors = []
        for author in meta.get('authors') or []:
            name = author.get('full_name') or author.get('raw_affiliations')
            if isinstance(name, str):
                authors.append(name)
        arxiv = (meta.get('arxiv_eprints') or [{}])[0].get('value')
        doi = (meta.get('dois') or [{}])[0].get('value')
        url = f'https://inspirehep.net/literature/{hit.get("id")}' if hit.get('id') else ''
        out.append(_paper(
            'inspire',
            title,
            url=url,
            authors=authors[:20],
            year=meta.get('earliest_date', '')[:4],
            abstract=((meta.get('abstracts') or [{}])[0].get('value') if meta.get('abstracts') else ''),
            external_id=doi or arxiv or hit.get('id'),
        ))
    return out


def _search_arxiv(query, limit):
    response = requests.get(
        'https://export.arxiv.org/api/query',
        params={'search_query': f'all:{query}', 'start': 0, 'max_results': min(limit, 20)},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    import xml.etree.ElementTree as ET
    root = ET.fromstring(response.content)
    ns = {'a': 'http://www.w3.org/2005/Atom'}
    out = []
    for entry in root.findall('a:entry', ns):
        title = ' '.join((entry.findtext('a:title', default='', namespaces=ns) or '').split())
        summary = ' '.join((entry.findtext('a:summary', default='', namespaces=ns) or '').split())
        url = entry.findtext('a:id', default='', namespaces=ns)
        published = entry.findtext('a:published', default='', namespaces=ns)
        authors = [
            node.findtext('a:name', default='', namespaces=ns)
            for node in entry.findall('a:author', ns)
        ]
        out.append(_paper(
            'arxiv',
            title,
            url=url,
            authors=[name for name in authors if name],
            year=published[:4],
            abstract=summary,
            external_id=url.rsplit('/', 1)[-1] if url else '',
        ))
    return out


def _search_orcid(user, limit):
    integration = LearningIntegration.objects.filter(
        user=user,
        provider=LearningIntegration.Provider.ORCID,
    ).first()
    if not integration or not integration.account_id:
        return []
    response = requests.get(
        f'https://pub.orcid.org/v3.0/{quote(integration.account_id, safe="")}/works',
        headers={'Accept': 'application/json'},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    out = []
    for group in (response.json() or {}).get('group') or []:
        summaries = group.get('work-summary') or []
        if not summaries:
            continue
        item = summaries[0]
        title = (((item.get('title') or {}).get('title') or {}).get('value') or '')
        ext = ''
        for external in ((item.get('external-ids') or {}).get('external-id') or []):
            if external.get('external-id-value'):
                ext = external['external-id-value']
                break
        year = (((item.get('publication-date') or {}).get('year') or {}).get('value') or '')
        out.append(_paper(
            'orcid',
            title,
            url=(item.get('url') or {}).get('value') or '',
            authors=[],
            year=year,
            external_id=ext or item.get('put-code'),
        ))
        if len(out) >= limit:
            break
    return out


@require_http_methods(['GET'])
def literature_recommendations(request, course_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    course = _course(course_id)
    if not course:
        return _error('course_not_found', 404)
    allowed, enrollment = _access(request.user, course)
    if not allowed:
        return _error('course_enrollment_required', 403)
    if (course.learning_config or {}).get('literature_enabled', True) is False and not _admin(request.user):
        return _error('literature_disabled', 403)

    lesson = None
    lesson_id = request.GET.get('lesson_id')
    if lesson_id:
        lesson = Lesson.objects.filter(pk=lesson_id, module__course=course).first()
        if not lesson:
            return _error('lesson_not_found', 404)

    query = str(request.GET.get('q') or '').strip()[:500]
    if not query:
        tag_text = ' '.join(tag.name for tag in course.tags.all()[:4])
        if lesson:
            lesson_context = ' '.join(
                part for part in [
                    lesson.title,
                    lesson.summary,
                    re.sub(r'<[^>]+>', ' ', lesson.body or '')[:500],
                    tag_text,
                ] if part
            )
            query = lesson_context[:500].strip()
        else:
            query = f'{course.title} {tag_text}'.strip()
    try:
        limit = max(1, min(12, int(request.GET.get('limit') or 6)))
    except ValueError:
        limit = 6
    requested = {
        item.strip().lower()
        for item in str(request.GET.get('providers') or 'semantic_scholar,arxiv,inspire,orcid').split(',')
        if item.strip()
    }

    results = []
    errors = {}
    searches = [
        ('semantic_scholar', lambda: _search_semantic(query, limit)),
        ('arxiv', lambda: _search_arxiv(query, limit)),
        ('inspire', lambda: _search_inspire(query, limit)),
        ('orcid', lambda: _search_orcid(request.user, limit)),
    ]
    for provider, runner in searches:
        if provider not in requested:
            continue
        try:
            results.extend(runner())
        except (requests.RequestException, ValueError, json.JSONDecodeError) as exc:
            errors[provider] = exc.__class__.__name__

    deduped = []
    seen = set()
    for item in results:
        key = (item.get('external_id') or item.get('title') or '').strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    _event(
        request.user,
        course,
        CourseEvent.Kind.LITERATURE_SEARCH,
        enrollment=enrollment,
        lesson=lesson,
        metadata={'query': query[:240], 'providers': sorted(requested), 'result_count': len(deduped)},
    )
    return JsonResponse({'ok': True, 'query': query, 'papers': deduped[: max(limit * 3, 12)], 'errors': errors})


def _path_assignment_json(item):
    return {
        'id': item.pk,
        'goal': item.goal,
        'learning_path_id': item.learning_path_id,
        'nodes': item.nodes,
        'edges': item.edges,
        'rationale': item.rationale,
        'generated_by_ai': item.generated_by_ai,
        'active': item.active,
        'updated_at': item.updated_at.isoformat(),
    }


def _fallback_path(goal, courses):
    words = {part for part in re.findall(r'[a-z0-9]+', goal.lower()) if len(part) > 2}
    ranked = []
    for course in courses:
        haystack = f'{course.title} {course.summary} {course.description}'.lower()
        score = sum(1 for word in words if word in haystack)
        ranked.append((score, course))
    ranked.sort(key=lambda pair: (-pair[0], pair[1].title.lower()))
    selected = [course for _score, course in ranked[: min(6, len(ranked))]]
    nodes = [{'id': f'course-{course.pk}', 'course_id': course.pk, 'title': course.title} for course in selected]
    edges = [
        {'from': nodes[index]['id'], 'to': nodes[index + 1]['id'], 'rule': 'complete'}
        for index in range(max(0, len(nodes) - 1))
    ]
    return nodes, edges, 'Path selected from the published catalog using your research goal.'


@require_http_methods(['GET', 'POST'])
def personalized_learning_paths(request):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    if request.method == 'GET':
        rows = LearnerPathAssignment.objects.filter(user=request.user, active=True)[:20]
        return JsonResponse({'ok': True, 'assignments': [_path_assignment_json(item) for item in rows]})

    data = _json_body(request)
    goal = str(data.get('goal') or '').strip()[:4000]
    if not goal:
        return _error('goal_required')
    courses = list(
        Course.objects.filter(status=Course.Status.PUBLISHED)
        .prefetch_related('tags')
        .order_by('title')[:120]
    )
    if not courses:
        return _error('no_published_courses', 409)

    nodes, edges, rationale = _fallback_path(goal, courses)
    generated_by_ai = False
    catalog = [
        {
            'id': course.pk,
            'title': course.title,
            'summary': course.summary,
            'tags': [tag.name for tag in course.tags.all()],
        }
        for course in courses
    ]
    try:
        answer = complete(
            system=(
                'You design research learning paths. Return strict JSON only with keys '
                '"course_ids" (ordered array of integers) and "rationale" (short string). '
                'Use only course IDs supplied by the catalog. Choose at most 6 courses.'
            ),
            user=f'Learner research goal:\n{goal}\n\nCatalog:\n{json.dumps(catalog, ensure_ascii=False)}',
            max_tokens=900,
            temperature=0.15,
        )
        match = re.search(r'\{.*\}', answer, flags=re.S)
        payload = json.loads(match.group(0) if match else answer)
        requested_ids = [int(value) for value in payload.get('course_ids') or []]
        by_id = {course.pk: course for course in courses}
        selected = [by_id[value] for value in requested_ids if value in by_id][:6]
        if selected:
            nodes = [{'id': f'course-{course.pk}', 'course_id': course.pk, 'title': course.title} for course in selected]
            edges = [
                {'from': nodes[index]['id'], 'to': nodes[index + 1]['id'], 'rule': 'complete'}
                for index in range(len(nodes) - 1)
            ]
            rationale = str(payload.get('rationale') or rationale)[:4000]
            generated_by_ai = True
    except (PulsarError, ValueError, TypeError, json.JSONDecodeError):
        pass

    template = None
    template_id = data.get('learning_path_id')
    if template_id:
        template = LearningPath.objects.filter(pk=template_id, status=LearningPath.Status.PUBLISHED).first()
    LearnerPathAssignment.objects.filter(user=request.user, active=True).update(active=False)
    item = LearnerPathAssignment.objects.create(
        user=request.user,
        learning_path=template,
        goal=goal,
        nodes=nodes,
        edges=edges,
        rationale=rationale,
        generated_by_ai=generated_by_ai,
    )
    first_course = None
    if nodes:
        first_course = _course(nodes[0].get('course_id'))
    _event(
        request.user,
        first_course or courses[0],
        CourseEvent.Kind.PATH_PERSONALIZE,
        enrollment=_enrollment(request.user, first_course) if first_course else None,
        metadata={'course_count': len(nodes), 'generated_by_ai': generated_by_ai},
    )
    return JsonResponse({'ok': True, 'assignment': _path_assignment_json(item)}, status=201)


def _notebook_json(item):
    learning_config = (
        item.enrollment.course.learning_config
        if isinstance(item.enrollment.course.learning_config, dict)
        else {}
    )
    return {
        'id': item.pk,
        'course_id': item.enrollment.course_id,
        'lesson_id': item.lesson_id,
        'title': item.title,
        'runtime': item.runtime,
        'code': item.code,
        'environment': item.environment,
        'revision': item.revision,
        'jupyter_url': str(learning_config.get('jupyter_url') or settings.LMS_JUPYTER_PUBLIC_URL),
        'mathematica_url': str(learning_config.get('mathematica_url') or settings.LMS_MATHEMATICA_PUBLIC_URL),
        'browser_python': item.runtime == NotebookWorkspace.Runtime.PYTHON,
        'remote_execution': (
            bool(settings.LMS_JUPYTER_EXEC_URL)
            if item.runtime == NotebookWorkspace.Runtime.JUPYTER
            else bool(settings.LMS_MATHEMATICA_EXEC_URL)
            if item.runtime == NotebookWorkspace.Runtime.MATHEMATICA
            else False
        ),
        'last_run_at': item.last_run_at.isoformat() if item.last_run_at else None,
        'updated_at': item.updated_at.isoformat(),
    }


@require_http_methods(['GET', 'POST'])
def course_notebooks(request, course_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    course = _course(course_id)
    if not course:
        return _error('course_not_found', 404)
    enrollment = _enrollment(request.user, course)
    if not enrollment:
        return _error('course_enrollment_required', 403)
    if (course.learning_config or {}).get('notebook_enabled', True) is False:
        return _error('notebook_disabled', 403)

    if request.method == 'GET':
        rows = enrollment.notebooks.select_related('lesson', 'enrollment__course').all()
        return JsonResponse({'ok': True, 'notebooks': [_notebook_json(item) for item in rows]})

    data = _json_body(request)
    item = None
    if data.get('id'):
        item = NotebookWorkspace.objects.filter(pk=data['id'], enrollment=enrollment).first()
        if not item:
            return _error('notebook_not_found', 404)
    lesson = None
    if data.get('lesson_id'):
        lesson = Lesson.objects.filter(pk=data['lesson_id'], module__course=course).first()
        if not lesson:
            return _error('lesson_not_found', 404)
    runtime = str(data.get('runtime') or NotebookWorkspace.Runtime.PYTHON)
    if runtime not in NotebookWorkspace.Runtime.values:
        return _error('invalid_runtime')
    environment = data.get('environment') if isinstance(data.get('environment'), dict) else {}
    if item:
        item.title = str(data.get('title') or item.title).strip()[:240]
        item.runtime = runtime
        item.lesson = lesson if data.get('lesson_id') else item.lesson
        item.code = str(data.get('code') if 'code' in data else item.code)
        item.environment = environment if 'environment' in data else item.environment
        item.revision += 1
        item.save()
    else:
        item = NotebookWorkspace.objects.create(
            enrollment=enrollment,
            lesson=lesson,
            title=str(data.get('title') or f'{course.title} notebook').strip()[:240],
            runtime=runtime,
            code=str(data.get('code') or ''),
            environment=environment,
        )
    _event(
        request.user,
        course,
        CourseEvent.Kind.NOTEBOOK_OPEN,
        enrollment=enrollment,
        lesson=lesson,
        metadata={'runtime': item.runtime, 'revision': item.revision},
    )
    return JsonResponse({'ok': True, 'notebook': _notebook_json(item)}, status=201)


@require_http_methods(['POST'])
def notebook_execute(request, notebook_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    item = (
        NotebookWorkspace.objects
        .select_related('enrollment__course', 'lesson')
        .filter(pk=notebook_id, enrollment__user=request.user)
        .first()
    )
    if not item:
        return _error('notebook_not_found', 404)

    if item.runtime == NotebookWorkspace.Runtime.PYTHON:
        return _error('browser_execution_required', 409)

    if item.runtime == NotebookWorkspace.Runtime.JUPYTER:
        runner_url = settings.LMS_JUPYTER_EXEC_URL
        token = settings.LMS_JUPYTER_EXEC_TOKEN
    else:
        runner_url = settings.LMS_MATHEMATICA_EXEC_URL
        token = settings.LMS_MATHEMATICA_EXEC_TOKEN

    if not runner_url:
        return _error('notebook_runner_not_configured', 409, runtime=item.runtime)

    headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    payload = {
        'runtime': item.runtime,
        'code': item.code,
        'environment': item.environment,
        'notebook_id': item.pk,
        'course_id': item.enrollment.course_id,
        'lesson_id': item.lesson_id,
        'revision': item.revision,
    }
    try:
        response = requests.post(
            runner_url,
            headers=headers,
            json=payload,
            timeout=(5, 120),
        )
    except requests.RequestException:
        return _error('notebook_runner_unavailable', 503, runtime=item.runtime)
    if response.status_code < 200 or response.status_code >= 300:
        return _error(
            'notebook_execution_failed',
            502,
            runtime=item.runtime,
            status_code=response.status_code,
        )
    try:
        result = response.json()
    except ValueError:
        result = {'output': response.text[:20000]}
    if not isinstance(result, dict):
        result = {'result': result}

    item.last_run_at = timezone.now()
    item.save(update_fields=['last_run_at', 'updated_at'])
    _event(
        request.user,
        item.enrollment.course,
        CourseEvent.Kind.NOTEBOOK_OPEN,
        enrollment=item.enrollment,
        lesson=item.lesson,
        metadata={'runtime': item.runtime, 'revision': item.revision, 'executed': True},
    )
    return JsonResponse({
        'ok': True,
        'runtime': item.runtime,
        'output': str(result.get('output') or '')[:50000],
        'result': result.get('result'),
        'artifacts': result.get('artifacts') if isinstance(result.get('artifacts'), list) else [],
        'last_run_at': item.last_run_at.isoformat(),
    })


@require_http_methods(['GET'])
def notebook_export(request, notebook_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    item = NotebookWorkspace.objects.select_related('enrollment__course', 'lesson').filter(
        pk=notebook_id,
        enrollment__user=request.user,
    ).first()
    if not item:
        return _error('notebook_not_found', 404)
    notebook = {
        'cells': [{
            'cell_type': 'code',
            'execution_count': None,
            'metadata': {},
            'outputs': [],
            'source': [line + '\n' for line in item.code.splitlines()],
        }],
        'metadata': {
            'gravitas': {
                'course_id': item.enrollment.course_id,
                'lesson_id': item.lesson_id,
                'revision': item.revision,
                'environment': item.environment,
            },
            'kernelspec': {
                'display_name': 'Python 3',
                'language': 'python',
                'name': 'python3',
            },
            'language_info': {'name': 'python', 'version': '3'},
        },
        'nbformat': 4,
        'nbformat_minor': 5,
    }
    response = HttpResponse(
        json.dumps(notebook, ensure_ascii=False, indent=2),
        content_type='application/x-ipynb+json',
    )
    safe = SAFE_NOTE.sub('_', item.title).strip() or 'notebook'
    response['Content-Disposition'] = f'attachment; filename="{safe}.ipynb"'
    return response


def _github_headers(token):
    return {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    }


def _repository_json(item):
    return {
        'id': item.pk,
        'course_id': item.enrollment.course_id,
        'course_title': item.enrollment.course.title,
        'user_id': item.enrollment.user_id,
        'learner': item.enrollment.user.get_full_name() or item.enrollment.user.email,
        'learner_email': item.enrollment.user.email,
        'lesson_id': item.lesson_id,
        'lesson_title': item.lesson.title if item.lesson_id else '',
        'owner': item.owner,
        'repository': item.repository,
        'branch': item.branch,
        'path_prefix': item.path_prefix,
        'html_url': item.html_url,
        'last_commit_sha': item.last_commit_sha,
        'review_status': item.review_status,
        'review_note': item.review_note,
        'reviewed_by': (
            item.reviewed_by.get_full_name() or item.reviewed_by.email
            if item.reviewed_by_id else ''
        ),
        'reviewed_at': item.reviewed_at.isoformat() if item.reviewed_at else None,
        'updated_at': item.updated_at.isoformat(),
    }


@require_http_methods(['GET', 'POST'])
def course_git(request, course_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    course = _course(course_id)
    if not course:
        return _error('course_not_found', 404)
    enrollment = _enrollment(request.user, course)
    if not enrollment:
        return _error('course_enrollment_required', 403)
    if (course.learning_config or {}).get('git_enabled', True) is False:
        return _error('git_disabled', 403)

    if request.method == 'GET':
        rows = enrollment.repositories.select_related('lesson', 'reviewed_by').all()
        return JsonResponse({'ok': True, 'repositories': [_repository_json(item) for item in rows]})

    integration = LearningIntegration.objects.filter(
        user=request.user,
        provider=LearningIntegration.Provider.GITHUB,
    ).first()
    if not integration or not integration.encrypted_token:
        return _error('github_integration_required', 409)
    token = cloud._decrypt(integration.encrypted_token)

    data = _json_body(request)
    owner = str(data.get('owner') or integration.account_id or '').strip()[:160]
    repository = str(data.get('repository') or '').strip()[:220]
    branch = str(data.get('branch') or 'main').strip()[:160]
    path = str(data.get('path') or '').strip().strip('/')[:600]
    content = str(data.get('content') or '')
    message = str(data.get('message') or f'Update {path or "Gravitas exercise"}').strip()[:240]
    if not owner or not repository or not path:
        return _error('repository_owner_and_path_required')

    lesson = None
    if data.get('lesson_id'):
        lesson = Lesson.objects.filter(pk=data['lesson_id'], module__course=course).first()
        if not lesson:
            return _error('lesson_not_found', 404)

    endpoint = f'https://api.github.com/repos/{quote(owner, safe="")}/{quote(repository, safe="")}/contents/{quote(path, safe="/")}'
    headers = _github_headers(token)
    sha = None
    try:
        existing = requests.get(endpoint, headers=headers, params={'ref': branch}, timeout=REQUEST_TIMEOUT)
        if existing.status_code == 200:
            sha = (existing.json() or {}).get('sha')
        elif existing.status_code not in {404}:
            return _error('github_repository_unavailable', 502, status_code=existing.status_code)
        payload = {
            'message': message,
            'content': base64.b64encode(content.encode('utf-8')).decode('ascii'),
            'branch': branch,
        }
        if sha:
            payload['sha'] = sha
        response = requests.put(endpoint, headers=headers, json=payload, timeout=REQUEST_TIMEOUT)
        if response.status_code not in {200, 201}:
            return _error('github_push_failed', 502, status_code=response.status_code)
        result = response.json() or {}
    except requests.RequestException:
        return _error('github_unavailable', 503)

    commit_sha = ((result.get('commit') or {}).get('sha') or '')
    html_url = ((result.get('content') or {}).get('html_url') or f'https://github.com/{owner}/{repository}')
    repo, _ = LearningRepository.objects.update_or_create(
        enrollment=enrollment,
        lesson=lesson,
        provider='github',
        owner=owner,
        repository=repository,
        path_prefix=str(data.get('path_prefix') or '').strip()[:600],
        defaults={
            'branch': branch,
            'html_url': html_url,
            'last_commit_sha': commit_sha,
            'review_status': LearningRepository.ReviewStatus.PENDING,
            'review_note': '',
            'reviewed_by': None,
            'reviewed_at': None,
        },
    )
    _event(
        request.user,
        course,
        CourseEvent.Kind.GIT_PUSH,
        enrollment=enrollment,
        lesson=lesson,
        metadata={'repository': f'{owner}/{repository}', 'path': path, 'commit_sha': commit_sha},
    )
    return JsonResponse({
        'ok': True,
        'repository': {
            'id': repo.pk,
            'html_url': repo.html_url,
            'last_commit_sha': repo.last_commit_sha,
        },
    }, status=201)


@require_http_methods(['GET', 'PATCH'])
def admin_learning_repositories(request):
    if not _admin(request.user):
        return _error('core_admin_required', 403)

    if request.method == 'GET':
        rows = (
            LearningRepository.objects
            .select_related('enrollment__course', 'enrollment__user', 'lesson', 'reviewed_by')
            .order_by('-updated_at')
        )
        course_id = request.GET.get('course_id')
        user_id = request.GET.get('user_id')
        status = str(request.GET.get('status') or '').strip()
        if course_id:
            rows = rows.filter(enrollment__course_id=course_id)
        if user_id:
            rows = rows.filter(enrollment__user_id=user_id)
        if status:
            if status not in LearningRepository.ReviewStatus.values:
                return _error('invalid_review_status')
            rows = rows.filter(review_status=status)
        return JsonResponse({'ok': True, 'repositories': [_repository_json(item) for item in rows[:500]]})

    data = _json_body(request)
    try:
        repository_id = int(data.get('repository_id'))
    except (TypeError, ValueError):
        return _error('repository_id_required')
    item = (
        LearningRepository.objects
        .select_related('enrollment__course', 'enrollment__user', 'lesson', 'reviewed_by')
        .filter(pk=repository_id)
        .first()
    )
    if not item:
        return _error('repository_not_found', 404)
    status = str(data.get('review_status') or '').strip()
    if status not in LearningRepository.ReviewStatus.values:
        return _error('invalid_review_status')
    item.review_status = status
    item.review_note = str(data.get('review_note') or '').strip()[:12000]
    item.reviewed_by = request.user
    item.reviewed_at = timezone.now()
    item.save(update_fields=['review_status', 'review_note', 'reviewed_by', 'reviewed_at', 'updated_at'])
    return JsonResponse({'ok': True, 'repository': _repository_json(item)})


@require_http_methods(['POST'])
def social_publish(request, course_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    course = _course(course_id)
    if not course:
        return _error('course_not_found', 404)
    enrollment = _enrollment(request.user, course)
    if not enrollment:
        return _error('course_enrollment_required', 403)
    if (course.learning_config or {}).get('social_publish_enabled', True) is False:
        return _error('social_publish_disabled', 403)

    data = _json_body(request)
    provider = str(data.get('provider') or '').lower()
    if provider not in {LearningIntegration.Provider.LINKEDIN, LearningIntegration.Provider.MEDIUM}:
        return _error('invalid_publish_provider')
    integration = LearningIntegration.objects.filter(user=request.user, provider=provider).first()
    if not integration or not integration.encrypted_token:
        return _error('publishing_integration_required', 409)
    token = cloud._decrypt(integration.encrypted_token)
    text = str(data.get('text') or '').strip()[:12000]
    title = str(data.get('title') or course.title).strip()[:240]
    canonical_url = str(data.get('canonical_url') or '').strip()[:1600]
    if not text:
        return _error('post_text_required')

    try:
        if provider == LearningIntegration.Provider.LINKEDIN:
            if not integration.account_id.startswith('urn:li:'):
                return _error('linkedin_author_urn_required')
            payload = {
                'author': integration.account_id,
                'commentary': text[:3000],
                'visibility': 'PUBLIC',
                'distribution': {
                    'feedDistribution': 'MAIN_FEED',
                    'targetEntities': [],
                    'thirdPartyDistributionChannels': [],
                },
                'lifecycleState': 'PUBLISHED',
                'isReshareDisabledByAuthor': False,
            }
            response = requests.post(
                'https://api.linkedin.com/rest/posts',
                headers={
                    'Authorization': f'Bearer {token}',
                    'Content-Type': 'application/json',
                    'X-Restli-Protocol-Version': '2.0.0',
                    'Linkedin-Version': settings.LMS_LINKEDIN_API_VERSION,
                },
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )
            if response.status_code != 201:
                return _error('linkedin_publish_failed', 502, status_code=response.status_code)
            external_id = response.headers.get('x-restli-id', '')
            external_url = ''
        else:
            if not integration.account_id:
                return _error('medium_user_id_required')
            payload = {
                'title': title,
                'contentFormat': 'markdown',
                'content': text,
                'publishStatus': str(data.get('publish_status') or 'public'),
            }
            if canonical_url:
                payload['canonicalUrl'] = canonical_url
            response = requests.post(
                f'https://api.medium.com/v1/users/{quote(integration.account_id, safe="")}/posts',
                headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'Accept': 'application/json'},
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )
            if response.status_code not in {200, 201}:
                return _error('medium_publish_failed', 502, status_code=response.status_code)
            result = (response.json() or {}).get('data') or {}
            external_id = str(result.get('id') or '')
            external_url = str(result.get('url') or '')
    except requests.RequestException:
        return _error('publishing_provider_unavailable', 503)

    _event(
        request.user,
        course,
        CourseEvent.Kind.SOCIAL_PUBLISH,
        enrollment=enrollment,
        metadata={'provider': provider, 'external_id': external_id},
    )
    return JsonResponse({
        'ok': True,
        'provider': provider,
        'external_id': external_id,
        'url': external_url,
        'legacy_provider': provider == LearningIntegration.Provider.MEDIUM,
    }, status=201)


def _course_markdown(course):
    lines = [f'# {course.title}', '', course.summary or course.description or '', '']
    for module in course.modules.prefetch_related('lessons').all():
        lines.extend([f'## {module.title}', '', module.summary or '', ''])
        for lesson in module.lessons.all():
            lines.extend([f'### {lesson.title}', '', lesson.body or lesson.summary or '', ''])
            if lesson.content_url:
                lines.extend([f'Resource: {lesson.content_url}', ''])
    return '\n'.join(lines).strip() + '\n'


@require_http_methods(['GET'])
def pkm_export(request, course_id, target):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    course = _course(course_id)
    if not course:
        return _error('course_not_found', 404)
    allowed, enrollment = _access(request.user, course)
    if not allowed:
        return _error('course_enrollment_required', 403)
    if target not in {'obsidian', 'logseq', 'notion', 'roam'}:
        return _error('invalid_pkm_target')

    safe_title = SAFE_NOTE.sub('_', course.title).strip() or f'course-{course.pk}'
    markdown = _course_markdown(course)
    if target == 'roam':
        payload = {
            'version': 0.2,
            'type': 'graph',
            'course': course.title,
            'pages': [{
                'title': course.title,
                'children': [
                    {'string': line.lstrip('# ').strip(), 'children': []}
                    for line in markdown.splitlines()
                    if line.strip()
                ],
            }],
        }
        response = HttpResponse(json.dumps(payload, ensure_ascii=False, indent=2), content_type='application/json')
        response['Content-Disposition'] = f'attachment; filename="{safe_title}-roam.json"'
    else:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            root = safe_title
            frontmatter = (
                f'---\n'
                f'title: "{course.title.replace(chr(34), chr(39))}"\n'
                f'gravitas_course_id: {course.pk}\n'
                f'target: {target}\n'
                f'---\n\n'
            )
            archive.writestr(f'{root}/{safe_title}.md', frontmatter + markdown)
            for module in course.modules.prefetch_related('lessons').all():
                module_name = SAFE_NOTE.sub('_', module.title).strip() or f'module-{module.pk}'
                body = [f'# {module.title}', '', module.summary or '', '']
                for lesson in module.lessons.all():
                    body.extend([f'## {lesson.title}', '', lesson.body or lesson.summary or '', ''])
                archive.writestr(f'{root}/Modules/{module_name}.md', '\n'.join(body))
            archive.writestr(
                f'{root}/gravitas.json',
                json.dumps({'course_id': course.pk, 'target': target, 'exported_at': timezone.now().isoformat()}, indent=2),
            )
        buffer.seek(0)
        response = HttpResponse(buffer.getvalue(), content_type='application/zip')
        response['Content-Disposition'] = f'attachment; filename="{safe_title}-{target}.zip"'

    _event(
        request.user,
        course,
        CourseEvent.Kind.PKM_EXPORT,
        enrollment=enrollment,
        metadata={'target': target},
    )
    return response
