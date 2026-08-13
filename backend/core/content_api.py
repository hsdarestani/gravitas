from django.db.models import Prefetch
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render

from .models import ContentItem, ContentTranslation


SUPPORTED_LOCALES = {'en', 'de', 'fa'}


def _requested_locale(request):
    locale = str(request.GET.get('lang', 'en')).strip().lower()
    return locale if locale in SUPPORTED_LOCALES else None


def _translation_for(item, locale):
    if locale == 'en':
        return None
    prefetched = getattr(item, 'published_translations', None)
    if prefetched is not None:
        return prefetched[0] if prefetched else None
    return item.translations.filter(
        locale=locale,
        status=ContentTranslation.Status.PUBLISHED,
    ).first()


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
        'updated_at': (
            translation.updated_at.isoformat()
            if translation
            else item.updated_at.isoformat()
        ),
    }
    if include_body:
        data['body'] = translation.body if translation else item.body
    return data


def _with_locale(queryset, locale):
    if locale == 'en':
        return queryset
    published = ContentTranslation.objects.filter(
        locale=locale,
        status=ContentTranslation.Status.PUBLISHED,
    )
    return queryset.prefetch_related(
        Prefetch('translations', queryset=published, to_attr='published_translations')
    )


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
    return JsonResponse({
        'ok': True,
        'language': locale,
        'count': len(items),
        'items': [_content_json(item, locale=locale) for item in items],
    })


def content_detail(request, slug):
    if request.method != 'GET':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)

    locale = _requested_locale(request)
    if locale is None:
        return JsonResponse({'ok': False, 'error': 'invalid_language'}, status=400)

    queryset = ContentItem.objects.filter(
        slug=slug,
        status=ContentItem.Status.PUBLISHED,
    )
    item = _with_locale(queryset, locale).first()
    if item is None:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)

    return JsonResponse({
        'ok': True,
        'language': locale,
        'item': _content_json(item, locale=locale, include_body=True),
    })


def content_page(request, slug):
    item = get_object_or_404(
        ContentItem,
        slug=slug,
        status=ContentItem.Status.PUBLISHED,
    )
    return render(request, 'core/content_page.html', {'item': item})
