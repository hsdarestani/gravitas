import hashlib
import json
import mimetypes
import re
from pathlib import Path

from django.conf import settings
from django.db.models import Prefetch
from django.http import FileResponse, JsonResponse
from django.shortcuts import get_object_or_404, render

from .models import ContentItem, ContentTranslation, TopicPollVote
from .topic_progress import mark_topic_progress


SUPPORTED_LOCALES = {'en', 'de', 'fa'}
MEDIA_NAME_RE = re.compile(r'^[0-9a-f]{32}\.[a-z0-9]{1,10}$')


def _requested_locale(request):
    locale = str(request.GET.get('lang', 'en')).strip().lower()
    return locale if locale in SUPPORTED_LOCALES else None


def _translation_for(item, locale):
    if locale == 'en':
        return None
    prefetched = getattr(item, 'published_translations', None)
    if prefetched is not None:
        return prefetched[0] if prefetched else None
    return item.translations.filter(locale=locale, status=ContentTranslation.Status.PUBLISHED).first()


def _content_json(item, locale='en', include_body=False):
    translation = _translation_for(item, locale)
    effective_locale = translation.locale if translation else 'en'
    data = {
        'id': item.pk,
        'kind': item.kind,
        'slug': item.slug,
        'locale': effective_locale,
        'requested_locale': locale,
        'fallback_to_english': bool(locale != 'en' and translation is None),
        'title': translation.title if translation else item.title,
        'summary': translation.summary if translation else item.summary,
        'published_at': (
            translation.published_at.isoformat()
            if translation and translation.published_at
            else item.published_at.isoformat() if item.published_at else None
        ),
        'updated_at': translation.updated_at.isoformat() if translation else item.updated_at.isoformat(),
    }
    if item.kind == ContentItem.Kind.TOPIC:
        data['topic_data'] = item.topic_data if isinstance(item.topic_data, dict) else {}
    if include_body:
        data['body'] = translation.body if translation else item.body
    return data


def _with_locale(queryset, locale):
    if locale == 'en':
        return queryset
    published = ContentTranslation.objects.filter(locale=locale, status=ContentTranslation.Status.PUBLISHED)
    return queryset.prefetch_related(Prefetch('translations', queryset=published, to_attr='published_translations'))


def content_list(request):
    if request.method != 'GET':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)
    locale = _requested_locale(request)
    if locale is None:
        return JsonResponse({'ok': False, 'error': 'invalid_language'}, status=400)
    queryset = ContentItem.objects.filter(status=ContentItem.Status.PUBLISHED)
    kind = str(request.GET.get('kind', '')).strip()
    if kind:
        valid_kinds = {value for value, _label in ContentItem.Kind.choices}
        if kind not in valid_kinds:
            return JsonResponse({'ok': False, 'error': 'invalid_kind'}, status=400)
        queryset = queryset.filter(kind=kind)
    try:
        limit = int(request.GET.get('limit', '50'))
    except (TypeError, ValueError):
        limit = 50
    limit = max(1, min(limit, 100))
    queryset = _with_locale(queryset, locale)
    items = list(queryset.order_by('-published_at', '-created_at')[:limit])
    return JsonResponse({'ok': True, 'language': locale, 'count': len(items), 'items': [_content_json(item, locale=locale) for item in items]})


def content_detail(request, slug):
    if request.method != 'GET':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)
    locale = _requested_locale(request)
    if locale is None:
        return JsonResponse({'ok': False, 'error': 'invalid_language'}, status=400)
    item = _with_locale(
        ContentItem.objects.filter(slug=slug, status=ContentItem.Status.PUBLISHED),
        locale,
    ).first()
    if item is None:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    return JsonResponse({'ok': True, 'language': locale, 'item': _content_json(item, locale=locale, include_body=True)})


def _poll_options(topic):
    data = topic.topic_data if isinstance(topic.topic_data, dict) else {}
    viewpoints = data.get('viewpoints') if isinstance(data.get('viewpoints'), dict) else {}
    raw = viewpoints.get('poll_options') if isinstance(viewpoints.get('poll_options'), list) else []
    options, seen = [], set()
    for index, option in enumerate(raw):
        if isinstance(option, dict):
            option_id = str(option.get('id') or f'option-{index + 1}').strip()[:80]
            label = str(option.get('label') or '').strip()[:300]
        else:
            option_id, label = f'option-{index + 1}', str(option).strip()[:300]
        if option_id and label and option_id not in seen:
            seen.add(option_id)
            options.append({'id': option_id, 'label': label})
    return options


def _voter_key(request):
    if not request.session.session_key:
        request.session.create()
    raw = f'{settings.SECRET_KEY}:{request.session.session_key}'.encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


def _poll_json(request, topic):
    options = _poll_options(topic)
    valid = {item['id'] for item in options}
    counts = {item['id']: 0 for item in options}
    for option_id in topic.poll_votes.values_list('option_id', flat=True):
        if option_id in valid:
            counts[option_id] += 1
    selected = topic.poll_votes.filter(voter_key=_voter_key(request)).values_list('option_id', flat=True).first()
    data = topic.topic_data if isinstance(topic.topic_data, dict) else {}
    viewpoints = data.get('viewpoints') if isinstance(data.get('viewpoints'), dict) else {}
    return {
        'question': str(viewpoints.get('poll_question') or ''),
        'options': [{'id': item['id'], 'label': item['label'], 'votes': counts[item['id']]} for item in options],
        'total_votes': sum(counts.values()),
        'selected': selected if selected in valid else None,
    }


def topic_poll(request, slug):
    topic = get_object_or_404(ContentItem, slug=slug, kind=ContentItem.Kind.TOPIC, status=ContentItem.Status.PUBLISHED)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'poll': _poll_json(request, topic)})
    if request.method != 'POST':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)
    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except (TypeError, ValueError, UnicodeDecodeError):
        return JsonResponse({'ok': False, 'error': 'invalid_json'}, status=400)
    option_id = str(payload.get('option_id') or '').strip()
    if option_id not in {item['id'] for item in _poll_options(topic)}:
        return JsonResponse({'ok': False, 'error': 'invalid_option'}, status=400)
    TopicPollVote.objects.update_or_create(topic=topic, voter_key=_voter_key(request), defaults={'option_id': option_id})
    if request.user.is_authenticated:
        mark_topic_progress(request.user, topic, 'vote')
    return JsonResponse({'ok': True, 'poll': _poll_json(request, topic)})



def community_polls(request):
    if request.method != 'GET':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)
    topics = ContentItem.objects.filter(
        kind=ContentItem.Kind.TOPIC,
        status=ContentItem.Status.PUBLISHED,
    ).order_by('-published_at', '-created_at')
    result = []
    for topic in topics[:100]:
        poll = _poll_json(request, topic)
        if not poll.get('options'):
            continue
        data = topic.topic_data if isinstance(topic.topic_data, dict) else {}
        viewpoints = data.get('viewpoints') if isinstance(data.get('viewpoints'), dict) else {}
        result.append({
            'topic_id': topic.pk,
            'slug': topic.slug,
            'title': topic.title,
            'summary': topic.summary,
            'url': f'/topic.html?slug={topic.slug}#views',
            'question': poll.get('question') or 'Where do you land?',
            'explanation': str(viewpoints.get('poll_note') or topic.summary or ''),
            'options': poll.get('options', []),
            'total_votes': poll.get('total_votes', 0),
            'selected': poll.get('selected'),
        })
    return JsonResponse({'ok': True, 'polls': result})

def topic_media(request, name):
    if request.method != 'GET':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)
    if not MEDIA_NAME_RE.fullmatch(name or ''):
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    target = Path(settings.TOPIC_MEDIA_ROOT) / name
    if not target.is_file():
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    content_type = mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
    response = FileResponse(target.open('rb'), content_type=content_type)
    response['Cache-Control'] = 'public, max-age=31536000, immutable'
    return response


def content_page(request, slug):
    item = get_object_or_404(ContentItem, slug=slug, status=ContentItem.Status.PUBLISHED)
    return render(request, 'core/content_page.html', {'item': item})
