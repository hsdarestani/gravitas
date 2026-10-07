import json
import mimetypes
import uuid
from pathlib import Path

from django.conf import settings
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .content_api import _poll_definitions
from .layer_access import record_activity
from .layer_models import ActivityEvent
from .models import Comment, ContentItem, ContentTranslation
from .platform_runtime_v3 import core_role, ensure_platform_workspaces


SUPPORTED_TRANSLATIONS = set(ContentTranslation.Locale.values)


def _payload(request):
    try:
        return json.loads(request.body.decode('utf-8') or '{}')
    except (TypeError, ValueError, UnicodeDecodeError):
        return None


def _is_admin(request):
    if not request.user.is_authenticated:
        return False
    if request.user.is_superuser:
        return True
    spaces = ensure_platform_workspaces(request.user)
    return core_role(request.user, spaces['core']) in {'owner', 'admin'}


def _denied(request):
    return JsonResponse(
        {'ok': False, 'error': 'authentication_required' if not request.user.is_authenticated else 'core_admin_required'},
        status=401 if not request.user.is_authenticated else 403,
    )


def _iso(value):
    return value.isoformat() if value else None


def _translation_json(item):
    return {
        'locale': item.locale,
        'status': item.status,
        'title': item.title,
        'summary': item.summary,
        'body': item.body,
        'published_at': _iso(item.published_at),
        'updated_at': _iso(item.updated_at),
    }


def _content_json(item, include_body=False):
    data = {
        'id': item.pk,
        'kind': item.kind,
        'status': item.status,
        'slug': item.slug,
        'title': item.title,
        'summary': item.summary,
        'topic_data': item.topic_data if isinstance(item.topic_data, dict) else {},
        'poll_results': (_topic_poll_results(item) or [None])[0],
        'poll_results_list': _topic_poll_results(item),
        'published_at': _iso(item.published_at),
        'created_at': _iso(item.created_at),
        'updated_at': _iso(item.updated_at),
        'translations': [_translation_json(row) for row in item.translations.all()],
    }
    if include_body:
        data['body'] = item.body
    return data


def _topic_poll_results(item):
    if item.kind != ContentItem.Kind.TOPIC:
        return []
    results = []
    for poll in _poll_definitions(item):
        labels = {option['id']: option['label'] for option in poll['options']}
        counts = {key: 0 for key in labels}
        for option_id in item.poll_votes.filter(poll_id=poll['id']).values_list('option_id', flat=True):
            if option_id in counts:
                counts[option_id] += 1
        results.append({
            'id': poll['id'],
            'question': poll['question'],
            'total_votes': sum(counts.values()),
            'options': [{'id': key, 'label': labels[key], 'votes': counts[key]} for key in labels],
        })
    return results


def _apply_translation(content, raw):
    if not isinstance(raw, dict):
        raise ValueError('invalid_translation')
    locale = str(raw.get('locale') or '').strip().lower()
    if locale not in SUPPORTED_TRANSLATIONS:
        raise ValueError('invalid_translation_locale')
    status = str(raw.get('status') or ContentTranslation.Status.DRAFT)
    if status not in ContentTranslation.Status.values:
        raise ValueError('invalid_translation_status')
    title = str(raw.get('title') or '').strip()
    if not title:
        raise ValueError('translation_title_required')
    existing = ContentTranslation.objects.filter(content=content, locale=locale).first()
    published_at = existing.published_at if existing else None
    if status == ContentTranslation.Status.PUBLISHED and not published_at:
        published_at = timezone.now()
    if status != ContentTranslation.Status.PUBLISHED:
        published_at = None
    ContentTranslation.objects.update_or_create(
        content=content,
        locale=locale,
        defaults={
            'status': status,
            'title': title,
            'summary': str(raw.get('summary') or ''),
            'body': str(raw.get('body') or ''),
            'published_at': published_at,
        },
    )


def _apply_content(item, data, *, creating=False):
    if creating or 'kind' in data:
        kind = str(data.get('kind') or ContentItem.Kind.ARTICLE)
        if kind not in ContentItem.Kind.values:
            raise ValueError('invalid_kind')
        item.kind = kind
    if creating or 'status' in data:
        status = str(data.get('status') or ContentItem.Status.DRAFT)
        if status not in ContentItem.Status.values:
            raise ValueError('invalid_status')
        item.status = status
    for field in ('slug', 'title'):
        if creating or field in data:
            value = str(data.get(field) or '').strip()
            if not value:
                raise ValueError(f'{field}_required')
            setattr(item, field, value)
    for field in ('summary', 'body'):
        if field in data:
            setattr(item, field, str(data.get(field) or ''))
    if 'topic_data' in data:
        topic_data = data.get('topic_data')
        if not isinstance(topic_data, dict):
            raise ValueError('invalid_topic_data')
        if len(json.dumps(topic_data, ensure_ascii=False).encode('utf-8')) > 2 * 1024 * 1024:
            raise ValueError('topic_data_too_large')
        item.topic_data = topic_data
    if item.status == ContentItem.Status.PUBLISHED and not item.published_at:
        item.published_at = timezone.now()
    if item.status != ContentItem.Status.PUBLISHED:
        item.published_at = None
    item.save()
    if 'translations' in data:
        translations = data.get('translations')
        if not isinstance(translations, list):
            raise ValueError('invalid_translations')
        for raw in translations:
            _apply_translation(item, raw)
    return item


@require_http_methods(['GET', 'POST'])
def admin_site_content(request):
    if not _is_admin(request):
        return _denied(request)
    if request.method == 'GET':
        qs = ContentItem.objects.prefetch_related('translations').all()
        status = str(request.GET.get('status') or '').strip()
        kind = str(request.GET.get('kind') or '').strip()
        if status:
            if status not in ContentItem.Status.values:
                return JsonResponse({'ok': False, 'error': 'invalid_status'}, status=400)
            qs = qs.filter(status=status)
        if kind:
            if kind not in ContentItem.Kind.values:
                return JsonResponse({'ok': False, 'error': 'invalid_kind'}, status=400)
            qs = qs.filter(kind=kind)
        return JsonResponse({'ok': True, 'items': [_content_json(item) for item in qs[:250]]})

    data = _payload(request)
    if data is None:
        return JsonResponse({'ok': False, 'error': 'invalid_json'}, status=400)
    try:
        with transaction.atomic():
            item = _apply_content(ContentItem(), data, creating=True)
    except ValueError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=400)
    except IntegrityError:
        return JsonResponse({'ok': False, 'error': 'slug_exists'}, status=409)
    record_activity(
        layer=ActivityEvent.Layer.SHELL,
        action='content.created',
        actor=request.user,
        object_type='content',
        object_id=item.pk,
        detail={'slug': item.slug, 'status': item.status, 'kind': item.kind},
    )
    return JsonResponse({'ok': True, 'item': _content_json(item, include_body=True)}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def admin_site_content_detail(request, item_id):
    if not _is_admin(request):
        return _denied(request)
    try:
        item = ContentItem.objects.prefetch_related('translations').get(pk=item_id)
    except ContentItem.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'content_not_found'}, status=404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'item': _content_json(item, include_body=True)})
    if request.method == 'DELETE':
        slug = item.slug
        item.delete()
        record_activity(
            layer=ActivityEvent.Layer.SHELL,
            action='content.deleted',
            actor=request.user,
            object_type='content',
            object_id=item_id,
            detail={'slug': slug},
        )
        return JsonResponse({'ok': True, 'deleted': True})
    data = _payload(request)
    if data is None:
        return JsonResponse({'ok': False, 'error': 'invalid_json'}, status=400)
    try:
        with transaction.atomic():
            item = ContentItem.objects.select_for_update().get(pk=item.pk)
            item = _apply_content(item, data)
    except ValueError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=400)
    except IntegrityError:
        return JsonResponse({'ok': False, 'error': 'slug_exists'}, status=409)
    record_activity(
        layer=ActivityEvent.Layer.SHELL,
        action='content.updated',
        actor=request.user,
        object_type='content',
        object_id=item.pk,
        detail={'fields': sorted(data.keys()), 'slug': item.slug, 'status': item.status},
    )
    return JsonResponse({'ok': True, 'item': _content_json(item, include_body=True)})


@require_http_methods(['POST'])
def admin_site_media_upload(request):
    if not _is_admin(request):
        return _denied(request)
    upload = request.FILES.get('file')
    if upload is None:
        return JsonResponse({'ok': False, 'error': 'file_required'}, status=400)
    if upload.size > settings.GRAVITAS_MAX_UPLOAD_BYTES:
        return JsonResponse({'ok': False, 'error': 'file_too_large'}, status=413)
    content_type = str(getattr(upload, 'content_type', '') or '').lower()
    if not (content_type.startswith('image/') or content_type.startswith('video/')):
        return JsonResponse({'ok': False, 'error': 'unsupported_media_type'}, status=415)
    suffix = Path(upload.name or '').suffix.lower()
    if not suffix or len(suffix) > 11 or not suffix[1:].isalnum():
        suffix = mimetypes.guess_extension(content_type) or ''
    if not suffix or len(suffix) > 11:
        return JsonResponse({'ok': False, 'error': 'unsupported_file_extension'}, status=415)
    root = Path(settings.TOPIC_MEDIA_ROOT)
    root.mkdir(parents=True, exist_ok=True)
    name = f'{uuid.uuid4().hex}{suffix}'
    target = root / name
    with target.open('wb') as handle:
        for chunk in upload.chunks():
            handle.write(chunk)
    return JsonResponse({
        'ok': True,
        'name': name,
        'url': f'/api/content/media/{name}/',
        'content_type': content_type,
        'size': upload.size,
    }, status=201)


def _comment_json(comment):
    author = comment.author
    return {
        'id': comment.pk,
        'content_key': comment.content_key,
        'parent_id': comment.parent_id,
        'body': comment.body,
        'status': comment.status,
        'author': {
            'id': author.pk,
            'email': author.email,
            'name': author.get_full_name() or author.get_username(),
        },
        'created_at': _iso(comment.created_at),
        'updated_at': _iso(comment.updated_at),
    }


@require_http_methods(['GET'])
def admin_site_comments(request):
    if not _is_admin(request):
        return _denied(request)
    qs = Comment.objects.select_related('author', 'parent').all()
    status = str(request.GET.get('status') or '').strip()
    content_key = str(request.GET.get('content_key') or '').strip()
    if status:
        if status not in Comment.Status.values:
            return JsonResponse({'ok': False, 'error': 'invalid_status'}, status=400)
        qs = qs.filter(status=status)
    if content_key:
        qs = qs.filter(content_key=content_key)
    return JsonResponse({'ok': True, 'comments': [_comment_json(item) for item in qs.order_by('-created_at')[:250]]})


@require_http_methods(['PATCH'])
def admin_site_comment_detail(request, comment_id):
    if not _is_admin(request):
        return _denied(request)
    try:
        comment = Comment.objects.select_related('author').get(pk=comment_id)
    except Comment.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'comment_not_found'}, status=404)
    data = _payload(request)
    if data is None:
        return JsonResponse({'ok': False, 'error': 'invalid_json'}, status=400)
    status = str(data.get('status') or '').strip()
    if status not in Comment.Status.values:
        return JsonResponse({'ok': False, 'error': 'invalid_status'}, status=400)
    before = comment.status
    comment.status = status
    comment.save(update_fields=['status', 'updated_at'])
    record_activity(
        layer=ActivityEvent.Layer.SHELL,
        action='comment.moderated',
        actor=request.user,
        subject_user=comment.author,
        object_type='comment',
        object_id=comment.pk,
        detail={'from': before, 'to': status, 'content_key': comment.content_key},
    )
    return JsonResponse({'ok': True, 'comment': _comment_json(comment)})
