"""Explicit publication of a reviewed Nextcloud Markdown revision."""
from difflib import SequenceMatcher
from pathlib import PurePosixPath

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET, require_http_methods
from lxml import html as lxml_html

from . import cloud, nextcloud_bridge
from .canonical_api import _project, body, clean_path
from .content_api import _voter_key
from .canonical_models import CanonicalFile
from .canonical_projects import acl_object, decode, object_for
from .models import ResearchProject, TopicEssayPublication, TopicEssayReaction
from .platform_access import can_edit, can_manage, downloads_allowed
from .topic_essay_sources import ESSAYS, SLOTS, SOURCE_FILES, SOURCE_PATHS, is_topic_essay_source, slot_label
from .topic_essay_render import render_essay
from .topic_essay_versions import record_publication

TOPIC_01_PAGE = '/topic-answer-that-looked-right'
MAX_SOURCE_BYTES = 1024 * 1024
MAX_CHANGE_NOTE = 1000


def published_essays():
    return {item.depth: item for item in TopicEssayPublication.objects.all()}


def public_essay_label(item, fallback):
    if item.source_path == SOURCE_PATHS.get(item.depth):
        return SOURCE_FILES[item.depth][1]
    return fallback


def _public_essay(item):
    title, body_html = render_essay(item.markdown, f'essay-{item.depth}')
    label = public_essay_label(item, '')
    if label and not title:
        title = SOURCE_FILES[item.depth][2]
    essay, level = SLOTS.get(item.depth, (0, ''))
    # The slot, not the label, says which essay and level this is: a slot can
    # be bound to a file outside the selected set, which carries no label.
    return {'title': title, 'label': label, 'html': body_html, 'essay': essay, 'level': level,
            'published_at': item.published_at.isoformat() if getattr(item, 'published_at', None) else ''}


def public_essay_context(item):
    essay = _public_essay(item)
    fragment = lxml_html.fragment_fromstring(essay['html'], create_parent=True)
    return f'{essay["title"]}\n{fragment.text_content()}'


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
                'label': slot_label(depth),
                'linked': bool(depth in items and (items[depth].project_id, items[depth].source_path) == (project.pk, path)),
                'occupied': depth in items,
                'version': items[depth].published_at.isoformat() if depth in items else '',
            }
            for depth, _label in TopicEssayPublication.Depth.choices
            if not is_topic_essay_source(project, path) or SOURCE_PATHS[depth] == path
        },
    }


def _lock_editor_project(project_id, user):
    project = ResearchProject.objects.select_for_update().filter(pk=project_id, archived=False).first()
    if not project or not can_edit(user, project):
        raise PermissionError('project_access_required')
    return project


def _has_binding(publication, project, path):
    return bool(publication and (publication.project_id, publication.source_path) == (project.pk, path))


def _source_used_elsewhere(project, depth, path):
    return TopicEssayPublication.objects.filter(project=project, source_path=path).exclude(depth=depth).exists()


def _publication_token(publication):
    return publication.published_at.isoformat() if publication else ''


def _essay_conflict(error):
    return JsonResponse({'ok': False, 'error': error}, status=409)


def _change_note(data):
    note = data.get('change_note', '')
    if not isinstance(note, str) or len(note) > MAX_CHANGE_NOTE or '\x00' in note:
        raise ValueError('invalid_essay_change_note')
    return note.strip()


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
        change_note = _change_note(data)
        if (depth not in TopicEssayPublication.Depth.values
                or (is_topic_essay_source(project, path) and path != SOURCE_PATHS[depth])
                or len(path) > 800 or path == 'project.md' or '//' in path
                or PurePosixPath(path).suffix.lower() != '.md'
                or not isinstance(etag, str) or not 0 < len(etag) <= 255
                or any(ord(char) < 32 for char in etag)
                or not isinstance(version, str) or len(version) > 40):
            raise ValueError('invalid_essay_publication')

        binding = TopicEssayPublication.objects.filter(depth=depth).first()
        if not _has_binding(binding, project, path) and not can_manage(request.user, project):
            raise PermissionError('essay_binding_requires_project_manager')
        markdown = _source_markdown(project, request.user, path, etag)
        if markdown is None:
            return JsonResponse({'ok': False, 'error': 'essay_source_changed'}, status=409)

        with transaction.atomic():
            project = _lock_editor_project(project.pk, request.user)
            binding = TopicEssayPublication.objects.filter(depth=depth).first()
            same_source = _has_binding(binding, project, path)
            same_markdown = binding and binding.project_id == project.pk and binding.markdown == markdown
            if not (same_source and same_markdown) and _publication_token(binding) != version:
                return _essay_conflict('essay_publication_changed')
            if _source_used_elsewhere(project, depth, path):
                return _essay_conflict('essay_file_already_linked')
            if not same_source and not can_manage(request.user, project):
                raise PermissionError('essay_binding_requires_project_manager')
            if not same_markdown:
                record_publication(binding, depth=depth, project=project, path=path, etag=etag,
                                   markdown=markdown, publisher=request.user, change_note=change_note)
            elif not same_source:
                # A manager can rebind an identical file. Keep the history of
                # the Markdown intact while invalidating other open previews.
                binding.source_path = path
                binding.source_etag = etag
                binding.published_at = timezone.now()
                binding.published_by = request.user
                binding.save(update_fields=['source_path', 'source_etag', 'published_at', 'published_by'])
            elif binding.source_etag != etag:
                binding.source_etag = etag
                binding.save(update_fields=['source_etag'])
        return JsonResponse({**_state(project, request.user, path), 'created_version': not same_markdown})
    except PermissionError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=403)
    except (ValueError, ValidationError) as exc:
        error = str(exc) if str(exc) in {'essay_file_too_large', 'essay_markdown_required', 'invalid_essay_change_note'} else 'invalid_essay_publication'
        return JsonResponse({'ok': False, 'error': error}, status=400)
    except (cloud.CloudError, ImproperlyConfigured):
        return JsonResponse({'ok': False, 'error': 'essay_source_unavailable'}, status=503)


def _version_metadata(version, publication, manager, current_number):
    return {
        'number': version.number,
        'published_at': version.published_at.isoformat(),
        'publisher': version.publisher_name,
        'source_path': version.source_path,
        'change_note': version.change_note,
        'restored_from': version.restored_from,
        'can_restore': version.number != current_number and (
            manager or version.source_path == publication.source_path
        ),
    }


def _comparison(before, after):
    old_lines = before.markdown.splitlines(keepends=True)
    new_lines = after.markdown.splitlines(keepends=True)
    matcher = SequenceMatcher(None, old_lines, new_lines)
    return [
        {'changes': [
            {'type': kind, 'old_line': old_start + 1, 'new_line': new_start + 1,
             'old': ''.join(old_lines[old_start:old_end]),
             'new': ''.join(new_lines[new_start:new_end]) if kind != 'equal' else ''}
            for kind, old_start, old_end, new_start, new_end in group
        ]}
        for group in matcher.get_grouped_opcodes()
    ]


@never_cache
@require_http_methods(['GET', 'POST'])
def project_topic_essay_versions(request, project_id, depth):
    if project_id != settings.TOPIC_01_RESEARCH_PROJECT_ID or depth not in SLOTS:
        return JsonResponse({'ok': False, 'error': 'topic_essay_version_not_found'}, status=404)
    try:
        project = _project(request, project_id, edit=True)
        if not downloads_allowed(project):
            raise PermissionError('downloads_restricted')
        if request.method == 'POST':
            data = body(request)
            number = data.get('number')
            token = data.get('version')
            if (data.get('confirm') is not True or type(number) is not int or not 0 < number <= 2147483647
                    or not isinstance(token, str) or not token or len(token) > 40):
                raise ValueError('invalid_essay_restore')
            change_note = _change_note(data)
            with transaction.atomic():
                project = _lock_editor_project(project_id, request.user)
                if not downloads_allowed(project):
                    raise PermissionError('downloads_restricted')
                publication = TopicEssayPublication.objects.filter(project=project, depth=depth).first()
                if not publication or _publication_token(publication) != token:
                    return _essay_conflict('essay_publication_changed')
                versions = publication.versions.filter(project=project)
                source = versions.filter(number=number).first()
                if not source:
                    return JsonResponse({'ok': False, 'error': 'topic_essay_version_not_found'}, status=404)
                if number == versions.values_list('number', flat=True).first():
                    return _essay_conflict('essay_version_is_current')
                if source.source_path != publication.source_path and not can_manage(request.user, project):
                    raise PermissionError('essay_binding_requires_project_manager')
                if _source_used_elsewhere(project, depth, source.source_path):
                    return _essay_conflict('essay_file_already_linked')
                restored = record_publication(
                    publication, depth=depth, project=project, path=source.source_path,
                    etag=source.source_etag, markdown=source.markdown, publisher=request.user,
                    change_note=change_note, restored_from=number,
                )
            return JsonResponse({'ok': True, 'number': restored.number})

        number, before, after = (request.GET.get(key) for key in ('number', 'from', 'to'))
        publication = TopicEssayPublication.objects.filter(project=project, depth=depth).first()
        if not publication:
            if any(value is not None for value in (number, before, after)):
                return JsonResponse({'ok': False, 'error': 'topic_essay_version_not_found'}, status=404)
            return JsonResponse({'ok': True, 'versions': [], 'version': '', 'current': None})
        versions = publication.versions.filter(project=project)
        if before is not None or after is not None:
            if number is not None:
                raise ValueError('invalid_essay_version')
            before, after = int(before or ''), int(after or '')
            pair = {row.number: row for row in versions.filter(number__in=[before, after])}
            if before not in pair or after not in pair:
                return JsonResponse({'ok': False, 'error': 'topic_essay_version_not_found'}, status=404)
            return JsonResponse({'ok': True, 'groups': _comparison(pair[before], pair[after])})
        if number is not None:
            item = versions.filter(number=int(number)).first()
            if not item:
                return JsonResponse({'ok': False, 'error': 'topic_essay_version_not_found'}, status=404)
            return JsonResponse({'ok': True, 'number': item.number, 'markdown': item.markdown})

        items = list(versions.defer('markdown', 'source_etag'))
        current = items[0].number if items else None
        manager = can_manage(request.user, project)
        return JsonResponse({
            'ok': True, 'version': _publication_token(publication), 'current': current,
            'versions': [_version_metadata(item, publication, manager, current) for item in items],
        })
    except PermissionError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=403)
    except ValueError as exc:
        error = str(exc) if str(exc) in {'invalid_essay_restore', 'invalid_essay_change_note'} else 'invalid_essay_version'
        return JsonResponse({'ok': False, 'error': error}, status=400)


def _reaction_json(request, essay):
    counts = {value: 0 for value in TopicEssayReaction.Value.values}
    for value in TopicEssayReaction.objects.filter(essay=essay).values_list('value', flat=True):
        if value in counts:
            counts[value] += 1
    selected = TopicEssayReaction.objects.filter(
        essay=essay, voter_key=_voter_key(request),
    ).values_list('value', flat=True).first()
    return {'essay': essay, 'useful': counts['useful'], 'not_useful': counts['not_useful'], 'selected': selected or ''}


@never_cache
@require_http_methods(['GET', 'POST'])
def topic_essay_reaction(request, essay):
    """"Was this essay useful to you?", answered once per reader and changeable.

    POST {"value": "useful" | "not_useful" | ""}; an empty value withdraws the
    answer. Only an essay that is published at some level can be answered.
    """
    published = {SLOTS[depth][0] for depth in published_essays() if depth in SLOTS}
    if essay not in ESSAYS or essay not in published:
        return JsonResponse({'ok': False, 'error': 'essay_not_found'}, status=404)
    if request.method == 'POST':
        try:
            value = body(request).get('value') or ''
        except ValueError:
            return JsonResponse({'ok': False, 'error': 'invalid_json'}, status=400)
        if value and value not in TopicEssayReaction.Value.values:
            return JsonResponse({'ok': False, 'error': 'invalid_value'}, status=400)
        key = _voter_key(request)
        if value:
            TopicEssayReaction.objects.update_or_create(essay=essay, voter_key=key, defaults={'value': value})
        else:
            TopicEssayReaction.objects.filter(essay=essay, voter_key=key).delete()
    return JsonResponse({'ok': True, 'reaction': _reaction_json(request, essay)})
