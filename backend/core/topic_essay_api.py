"""Explicit publication of a reviewed Nextcloud Markdown revision."""
from pathlib import PurePosixPath

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET, require_http_methods
from markdown_it import MarkdownIt

from . import cloud, nextcloud_bridge
from .canonical_api import _project, body, clean_path
from .canonical_models import CanonicalFile
from .canonical_projects import acl_object, decode, object_for
from .models import ResearchProject, TopicEssayPublication
from .platform_access import can_edit, can_manage, downloads_allowed
from .topic_essay_sources import SOURCE_FILES, SOURCE_PATHS, is_topic_essay_source

TOPIC_01_PAGE = '/topic-answer-that-looked-right.html'
MAX_SOURCE_BYTES = 1024 * 1024
MARKDOWN = MarkdownIt('commonmark', {'html': False, 'maxNesting': 20}).enable(['table', 'strikethrough'])


def published_essays():
    return {item.depth: item for item in TopicEssayPublication.objects.all()}


def public_essay_label(item, fallback):
    if item.source_path == SOURCE_PATHS.get(item.depth):
        return SOURCE_FILES[item.depth][1]
    return fallback


def _public_essay(item):
    source = item.markdown
    env = {}
    tokens = MARKDOWN.parse(source, env)
    title = ''
    if tokens and tokens[0].type == 'heading_open' and tokens[0].tag == 'h1':
        title = ''.join(child.content for child in tokens[1].children or []
                        if child.type in {'text', 'code_inline'}).strip()
        if title:
            tokens = tokens[3:]
    for token in tokens:
        if token.type in {'heading_open', 'heading_close'}:
            token.tag = f'h{min(6, int(token.tag[1]) + 2)}'
    label = public_essay_label(item, '')
    if label and not title:
        title = SOURCE_FILES[item.depth][2]
    return {'title': title, 'label': label, 'html': MARKDOWN.renderer.render(tokens, MARKDOWN.options, env)}


@never_cache
@require_GET
def public_topic_essays(request):
    return JsonResponse({'ok': True, 'essays': {
        depth: _public_essay(item) for depth, item in published_essays().items()
    }})


def read_essay_markdown(response):
    raw = bytearray()
    for chunk in response.iter_content(chunk_size=65536):
        raw.extend(chunk)
        if len(raw) > MAX_SOURCE_BYTES:
            raise ValueError('essay_file_too_large')
    return raw.decode('utf-8-sig')


def _source_markdown(project, user, path, expected_etag):
    canonical = CanonicalFile.objects.filter(project=project, path=path).first()
    obj = object_for(canonical) if canonical and not canonical.deleted else None
    if canonical and (not obj or getattr(obj, 'kind', '') != 'note'
                      or not can_edit(user, acl_object(obj)) or not downloads_allowed(obj)):
        raise PermissionError('essay_file_access_required')
    if not downloads_allowed(project):
        raise PermissionError('downloads_restricted')

    # Read using the editor's DAV identity, including for canonical notes.
    # Publication must never elevate private file access to service privileges.
    identity = nextcloud_bridge.ensure_user(user)
    full_path = f'{cloud.project_mountpoint(project)}/{path}'
    with cloud._request('GET', cloud._dav_url(identity, full_path), auth=cloud._auth(identity),
                        expected={200, 403, 404, 412}, headers={'If-Match': expected_etag},
                        stream=True) as response:
        if response.status_code == 403:
            raise PermissionError('essay_file_access_required')
        if response.status_code != 200 or response.headers.get('ETag') != expected_etag:
            return None
        markdown = read_essay_markdown(response)
    if obj:
        markdown = decode(obj, markdown)['body']
    if not markdown.strip() or '\x00' in markdown:
        raise ValueError('essay_markdown_required')
    return markdown


def _state(project, user, path):
    items = published_essays()
    return {
        'ok': True,
        'can_bind': can_manage(user, project),
        'slots': {
            depth: {
                'label': SOURCE_FILES[depth][1] if is_topic_essay_source(project, path) else label,
                'linked': bool(depth in items and (items[depth].project_id, items[depth].source_path) == (project.pk, path)),
                'occupied': depth in items,
                'version': items[depth].published_at.isoformat() if depth in items else '',
            }
            for depth, label in TopicEssayPublication.Depth.choices
            if not is_topic_essay_source(project, path) or SOURCE_PATHS[depth] == path
        },
    }


@never_cache
@require_http_methods(['GET', 'POST'])
def project_topic_essays(request, project_id):
    if project_id != settings.TOPIC_01_RESEARCH_PROJECT_ID:
        return JsonResponse({'ok': False, 'error': 'topic_essay_project_not_found'}, status=404)
    try:
        project = _project(request, project_id, edit=True)
        if request.method == 'GET':
            return JsonResponse(_state(project, request.user, clean_path(request.GET.get('path'))))
        data = body(request)
        depth = data.get('depth')
        path = clean_path(data.get('path'))
        etag = data.get('etag')
        version = data.get('version')
        if (depth not in TopicEssayPublication.Depth.values
                or (is_topic_essay_source(project, path) and path != SOURCE_PATHS[depth])
                or len(path) > 800 or path == 'project.md' or '//' in path
                or PurePosixPath(path).suffix.lower() != '.md'
                or not isinstance(etag, str) or not 0 < len(etag) <= 255
                or any(ord(char) < 32 for char in etag)
                or not isinstance(version, str) or len(version) > 40):
            raise ValueError('invalid_essay_publication')

        binding = TopicEssayPublication.objects.filter(depth=depth).first()
        if (not binding or (binding.project_id, binding.source_path) != (project.pk, path)) and not can_manage(request.user, project):
            raise PermissionError('essay_binding_requires_project_manager')
        markdown = _source_markdown(project, request.user, path, etag)
        if markdown is None:
            return JsonResponse({'ok': False, 'error': 'essay_source_changed'}, status=409)

        with transaction.atomic():
            project = ResearchProject.objects.select_for_update().filter(pk=project.pk, archived=False).first()
            if not project or not can_edit(request.user, project):
                raise PermissionError('project_access_required')
            current = published_essays()
            binding = current.get(depth)
            already_published = binding and (binding.project_id, binding.source_path, binding.source_etag, binding.markdown) == (
                project.pk, path, etag, markdown
            )
            if not already_published and (binding.published_at.isoformat() if binding else '') != version:
                return JsonResponse({'ok': False, 'error': 'essay_publication_changed'}, status=409)
            other = next((item for key, item in current.items() if key != depth), None)
            if other and (other.project_id, other.source_path) == (project.pk, path):
                return JsonResponse({'ok': False, 'error': 'essay_file_already_linked'}, status=409)
            if not binding or (binding.project_id, binding.source_path) != (project.pk, path):
                if not can_manage(request.user, project):
                    raise PermissionError('essay_binding_requires_project_manager')
            if not already_published:
                TopicEssayPublication.objects.update_or_create(depth=depth, defaults={
                    'project': project, 'source_path': path, 'source_etag': etag, 'markdown': markdown,
                    'published_at': timezone.now(), 'published_by': request.user,
                })
        return JsonResponse(_state(project, request.user, path))
    except PermissionError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=403)
    except (ValueError, ValidationError) as exc:
        error = str(exc) if str(exc) in {'essay_file_too_large', 'essay_markdown_required'} else 'invalid_essay_publication'
        return JsonResponse({'ok': False, 'error': error}, status=400)
    except (cloud.CloudError, ImproperlyConfigured):
        return JsonResponse({'ok': False, 'error': 'essay_source_unavailable'}, status=503)
