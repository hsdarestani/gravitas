from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render

from .models import ContentItem


def _content_json(item, include_body=False):
    data = {
        'id': item.pk,
        'kind': item.kind,
        'slug': item.slug,
        'title': item.title,
        'summary': item.summary,
        'published_at': item.published_at.isoformat() if item.published_at else None,
        'updated_at': item.updated_at.isoformat(),
    }
    if include_body:
        data['body'] = item.body
    return data


def content_list(request):
    if request.method != 'GET':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)

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

    items = list(queryset.order_by('-published_at', '-created_at')[:limit])
    return JsonResponse({
        'ok': True,
        'count': len(items),
        'items': [_content_json(item) for item in items],
    })


def content_detail(request, slug):
    if request.method != 'GET':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)

    item = ContentItem.objects.filter(
        slug=slug,
        status=ContentItem.Status.PUBLISHED,
    ).first()
    if item is None:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)

    return JsonResponse({'ok': True, 'item': _content_json(item, include_body=True)})


def content_page(request, slug):
    item = get_object_or_404(
        ContentItem,
        slug=slug,
        status=ContentItem.Status.PUBLISHED,
    )
    return render(request, 'core/content_page.html', {'item': item})
