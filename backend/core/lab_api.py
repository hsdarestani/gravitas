import json
import mimetypes
import re

from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_http_methods

from .models import InteractiveLab
from .platform_runtime_v3 import core_role, ensure_platform_workspaces


SAFE_FILE = re.compile(r'^[A-Za-z0-9._/-]{1,180}$')
MAX_FILES = 16
MAX_CODE_BYTES = 1024 * 1024


def _admin(request):
    if not request.user.is_authenticated:
        return False
    if request.user.is_superuser:
        return True
    spaces = ensure_platform_workspaces(request.user)
    return core_role(request.user, spaces['core']) in {'owner', 'admin'}


def _body(request):
    try:
        value = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _clean_files(value):
    if not isinstance(value, list) or len(value) > MAX_FILES:
        raise ValueError('invalid_files')
    result, seen, total = [], set(), 0
    for raw in value:
        if not isinstance(raw, dict):
            raise ValueError('invalid_files')
        name = str(raw.get('name') or '').strip().lstrip('/')
        content = str(raw.get('content') or '')
        if not SAFE_FILE.fullmatch(name) or '..' in name.split('/') or name in seen:
            raise ValueError('invalid_file_name')
        total += len(content.encode('utf-8'))
        if total > MAX_CODE_BYTES:
            raise ValueError('lab_code_too_large')
        seen.add(name)
        result.append({'name': name, 'content': content})
    return result


def _json(item, include_files=False):
    data = {
        'id': item.pk,
        'slug': item.slug,
        'title': item.title,
        'summary': item.summary,
        'description': item.description,
        'duration_text': item.duration_text,
        'status': item.status,
        'run_url': f'/lab-run/{item.slug}/',
        'updated_at': item.updated_at.isoformat(),
    }
    if include_files:
        data['files'] = item.files if isinstance(item.files, list) else []
    return data


@require_http_methods(['GET'])
def public_labs(request):
    qs = InteractiveLab.objects.filter(status=InteractiveLab.Status.PUBLISHED)
    return JsonResponse({'ok': True, 'labs': [_json(item) for item in qs[:100]]})


@require_http_methods(['GET'])
def public_lab_detail(request, slug):
    item = InteractiveLab.objects.filter(slug=slug, status=InteractiveLab.Status.PUBLISHED).first()
    if not item:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    return JsonResponse({'ok': True, 'lab': _json(item)})


@require_http_methods(['GET'])
def run_lab_file(request, slug, file_path='index.html'):
    item = InteractiveLab.objects.filter(slug=slug, status=InteractiveLab.Status.PUBLISHED).first()
    if not item:
        return HttpResponse('Not found', status=404)
    target = str(file_path or 'index.html').lstrip('/')
    files = item.files if isinstance(item.files, list) else []
    row = next((part for part in files if isinstance(part, dict) and part.get('name') == target), None)
    if row is None:
        return HttpResponse('Not found', status=404)
    content_type = mimetypes.guess_type(target)[0] or 'text/plain'
    response = HttpResponse(str(row.get('content') or ''), content_type=f'{content_type}; charset=utf-8')
    response['Cache-Control'] = 'no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    response['Content-Security-Policy'] = (
        "default-src 'none'; script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; "
        "font-src 'self' data:; connect-src https:; media-src https: data:"
    )
    return response


@require_http_methods(['GET', 'POST'])
def admin_labs(request):
    if not _admin(request):
        return JsonResponse({'ok': False, 'error': 'core_admin_required'}, status=403)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'labs': [_json(item, True) for item in InteractiveLab.objects.all()[:250]]})
    data = _body(request)
    slug = str(data.get('slug') or '').strip().lower()[:180]
    title = str(data.get('title') or '').strip()[:240]
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug) or not title:
        return JsonResponse({'ok': False, 'error': 'slug_and_title_required'}, status=400)
    if InteractiveLab.objects.filter(slug=slug).exists():
        return JsonResponse({'ok': False, 'error': 'slug_exists'}, status=409)
    try:
        files = _clean_files(data.get('files') or [])
    except ValueError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=400)
    status = str(data.get('status') or 'draft')
    if status not in InteractiveLab.Status.values:
        return JsonResponse({'ok': False, 'error': 'invalid_status'}, status=400)
    if status == InteractiveLab.Status.PUBLISHED and not any(row['name'] == 'index.html' for row in files):
        return JsonResponse({'ok': False, 'error': 'index_html_required'}, status=400)
    item = InteractiveLab.objects.create(
        slug=slug, title=title, summary=str(data.get('summary') or ''),
        description=str(data.get('description') or ''),
        duration_text=str(data.get('duration_text') or '')[:80],
        status=status, files=files, created_by=request.user,
    )
    return JsonResponse({'ok': True, 'lab': _json(item, True)}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def admin_lab_detail(request, lab_id):
    if not _admin(request):
        return JsonResponse({'ok': False, 'error': 'core_admin_required'}, status=403)
    item = InteractiveLab.objects.filter(pk=lab_id).first()
    if not item:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'lab': _json(item, True)})
    if request.method == 'DELETE':
        item.delete()
        return JsonResponse({'ok': True})
    data = _body(request)
    for field, limit in [('title', 240), ('summary', None), ('description', None), ('duration_text', 80)]:
        if field in data:
            value = str(data[field] or '')
            setattr(item, field, value[:limit] if limit else value)
    if 'files' in data:
        try:
            item.files = _clean_files(data['files'])
        except ValueError as exc:
            return JsonResponse({'ok': False, 'error': str(exc)}, status=400)
    if 'status' in data:
        status = str(data['status'])
        if status not in InteractiveLab.Status.values:
            return JsonResponse({'ok': False, 'error': 'invalid_status'}, status=400)
        item.status = status
    if item.status == InteractiveLab.Status.PUBLISHED and not any(
        isinstance(row, dict) and row.get('name') == 'index.html' for row in (item.files or [])
    ):
        return JsonResponse({'ok': False, 'error': 'index_html_required'}, status=400)
    item.save()
    return JsonResponse({'ok': True, 'lab': _json(item, True)})
