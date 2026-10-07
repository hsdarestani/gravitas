import os
import re
import uuid
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, JsonResponse
from django.views.decorators.http import require_http_methods

from .layer_access import module_access
from .layer_models import ModuleGrant
from .platform_models import ContentWorkAttachment, ContentWorkComment, ContentWorkItem



def _safe_filename(value):
    name = Path(str(value or '')).name.strip() or 'file'
    name = re.sub(r'[^A-Za-z0-9._ -]+', '_', name)
    return name[:255] or 'file'

def _deny(request):
    return JsonResponse(
        {'ok': False, 'error': 'authentication_required' if not request.user.is_authenticated else 'core_access_required'},
        status=401 if not request.user.is_authenticated else 403,
    )


def _allowed(request):
    return request.user.is_authenticated and module_access(request.user, ModuleGrant.Module.CORE)


def _item(item_id):
    return ContentWorkItem.objects.filter(pk=item_id).first()


def _comment_json(row):
    return {
        'id': row.pk,
        'author': row.author.get_full_name() or row.author.email,
        'author_id': row.author_id,
        'body': row.body,
        'created_at': row.created_at.isoformat(),
    }


def _attachment_json(row):
    return {
        'id': row.pk,
        'name': row.name,
        'mime_type': row.mime_type,
        'size': row.size,
        'uploader': row.uploader.get_full_name() or row.uploader.email,
        'created_at': row.created_at.isoformat(),
        'download_url': f'/api/platform/content/{row.item_id}/attachments/{row.pk}/download/',
    }


@require_http_methods(['GET', 'POST'])
def content_comments(request, item_id):
    if not _allowed(request):
        return _deny(request)
    item = _item(item_id)
    if not item:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    if request.method == 'GET':
        rows = item.comments.select_related('author').all()[:300]
        return JsonResponse({'ok': True, 'comments': [_comment_json(row) for row in rows]})
    body = str(request.POST.get('body') or '')
    if not body:
        try:
            import json
            data = json.loads(request.body or '{}')
        except Exception:
            data = {}
        body = str(data.get('body') or '')
    body = body.strip()
    if not body or len(body) > 10000:
        return JsonResponse({'ok': False, 'error': 'invalid_comment'}, status=400)
    row = ContentWorkComment.objects.create(item=item, author=request.user, body=body)
    return JsonResponse({'ok': True, 'comment': _comment_json(row)}, status=201)


@require_http_methods(['GET', 'POST'])
def content_attachments(request, item_id):
    if not _allowed(request):
        return _deny(request)
    item = _item(item_id)
    if not item:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    if request.method == 'GET':
        rows = item.attachments.select_related('uploader').all()[:200]
        return JsonResponse({'ok': True, 'attachments': [_attachment_json(row) for row in rows]})
    uploaded = request.FILES.get('file')
    if not uploaded:
        return JsonResponse({'ok': False, 'error': 'file_required'}, status=400)
    if uploaded.size <= 0 or uploaded.size > settings.CONTENT_ATTACHMENT_MAX_BYTES:
        return JsonResponse({
            'ok': False, 'error': 'file_size_invalid',
            'max_bytes': settings.CONTENT_ATTACHMENT_MAX_BYTES,
        }, status=413)
    name = _safe_filename(uploaded.name)
    root = Path(settings.CORE_UPLOAD_ROOT) / 'content' / str(item.pk)
    root.mkdir(parents=True, exist_ok=True)
    stored = f'{uuid.uuid4().hex}-{name}'
    path = root / stored
    with path.open('wb') as handle:
        for chunk in uploaded.chunks():
            handle.write(chunk)
    row = ContentWorkAttachment.objects.create(
        item=item, uploader=request.user, name=name,
        storage_path=str(path), mime_type=(uploaded.content_type or '')[:160],
        size=uploaded.size,
    )
    return JsonResponse({'ok': True, 'attachment': _attachment_json(row)}, status=201)


@require_http_methods(['GET'])
def content_attachment_download(request, item_id, attachment_id):
    if not _allowed(request):
        return _deny(request)
    row = ContentWorkAttachment.objects.select_related('item').filter(
        pk=attachment_id, item_id=item_id,
    ).first()
    if not row or not os.path.isfile(row.storage_path):
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    return FileResponse(open(row.storage_path, 'rb'), as_attachment=True, filename=row.name)
