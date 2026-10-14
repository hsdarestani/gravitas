"""Line-anchored comments for the SAME shared note/task objects in Core and Research.

Each object's discussion is stored in exactly one standalone JSON file in the
service-managed Nextcloud sidecar directory. No parallel database comment body
is created. Writes use the exact DAV ETag and reject stale anchors.
"""
import json
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import cloud
from .models import KnowledgeResource
from .operating_models import OperatingTask
from .platform_access import can_edit, can_view

ROOT = 'GraviQuest-Annotations'
FIELDS = {
    'note': {'content', 'title'},
    'task': {'title', 'description', 'definition_of_done', 'blocked_reason'},
}
MAX_COMMENTS = 2000


def _error(code, status=400, **kwargs):
    return JsonResponse({'ok': False, 'error': code, **kwargs}, status=status)


def _object(kind, object_id):
    if kind == 'note':
        return KnowledgeResource.objects.filter(pk=object_id, kind=KnowledgeResource.Kind.NOTE).first()
    if kind == 'task':
        return OperatingTask.objects.filter(pk=object_id).first()
    return None


def _content(obj, kind, field):
    if kind == 'note' and field == 'content':
        return obj.body or ''
    return str(getattr(obj, field) or '')


def _path(kind, object_id):
    # IDs are decimal integers from the typed Django route, never user paths.
    return f'{ROOT}/{kind}/{int(object_id)}.json'


def _read(kind, object_id):
    path = _path(kind, object_id)
    result = cloud._request(
        'GET', cloud._admin_dav_url(path), auth=cloud._admin_auth(),
        expected={200, 404}, headers={'Accept-Encoding': 'identity'},
    )
    if result.status_code == 404:
        return {'schema': 1, 'target': {'kind': kind, 'id': object_id}, 'comments': []}, None
    if not result.headers.get('ETag'):
        raise cloud.CloudError('comment_revision_missing')
    try:
        data = result.json()
    except (ValueError, TypeError) as exc:
        raise cloud.CloudError('comment_file_invalid_json') from exc
    if not isinstance(data, dict) or data.get('schema') != 1 or data.get('target') != {'kind': kind, 'id': object_id} or not isinstance(data.get('comments'), list):
        raise cloud.CloudError('comment_file_invalid_schema')
    return data, result.headers['ETag']


def _write(kind, object_id, data, etag):
    path = _path(kind, object_id)
    cloud.admin_make_folder(f'{ROOT}/{kind}')
    headers = {'Content-Type': 'application/json; charset=utf-8',
               'Accept-Encoding': 'identity'}
    if etag is None:
        headers['If-None-Match'] = '*'
    else:
        headers['If-Match'] = etag
    res = cloud._request(
        'PUT', cloud._admin_dav_url(path), auth=cloud._admin_auth(),
        expected={201, 204, 412, 423}, headers=headers,
        data=json.dumps(data, ensure_ascii=False, sort_keys=True).encode('utf-8'),
    )
    if res.status_code in {412, 423}:
        return False
    # Read back the exact appended JSON comment; conditional PUT response alone
    # can be misleading behind a storage proxy.
    remote, _ = _read(kind, object_id)
    if remote.get('comments') != data['comments']:
        raise cloud.CloudError('comment_readback_mismatch')
    return True


@require_http_methods(['GET', 'POST'])
def anchored_comments(request, kind, object_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    if kind not in FIELDS:
        return _error('invalid_comment_target', 404)
    obj = _object(kind, object_id)
    if not obj or not can_view(request.user, obj):
        return _error('not_found', 404)
    if request.method == 'POST' and not can_edit(request.user, obj):
        return _error('permission_denied', 403)
    try:
        data, etag = _read(kind, object_id)
    except cloud.CloudError as exc:
        return _error('comment_storage_unavailable', 503, detail=str(exc)[:160])
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'comments': data['comments']})
    try:
        payload = json.loads(request.body or '{}')
    except (ValueError, UnicodeDecodeError):
        return _error('invalid_comment')
    if not isinstance(payload, dict):
        return _error('invalid_comment')
    field = str(payload.get('field') or '')
    text = str(payload.get('text') or '').strip()
    quote = str(payload.get('quote') or '')
    try:
        line = int(payload.get('line'))
    except (TypeError, ValueError):
        return _error('invalid_line')
    if field not in FIELDS[kind] or line < 1 or len(text) < 1 or len(text) > 3000 or len(quote) > 2000:
        return _error('invalid_comment_anchor')
    # Re-read the current canonical object, not a user's stale browser buffer.
    obj = _object(kind, object_id)
    lines = _content(obj, kind, field).split('\n')
    if line > len(lines) or lines[line - 1] != quote:
        return _error('comment_anchor_changed', 409,
                      detail='The line changed since you opened it. Refresh and select the new line.')
    if len(data['comments']) >= MAX_COMMENTS:
        return _error('comment_file_full', 409)
    comment = {
        'id': str(uuid.uuid4()),
        'author_id': request.user.pk,
        'author': request.user.get_full_name() or request.user.email or 'Member',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'text': text, 'anchor': {'field': field, 'line': line, 'quote': quote},
    }
    data['comments'].append(comment)
    try:
        if not _write(kind, object_id, data, etag):
            return _error('comment_concurrent_update_or_lock', 409,
                          detail='Someone updated this discussion or the file is locked; the comment was not posted.')
    except cloud.CloudError as exc:
        return _error('comment_storage_unavailable', 503, detail=str(exc)[:160])
    return JsonResponse({'ok': True, 'comment': comment}, status=201)
