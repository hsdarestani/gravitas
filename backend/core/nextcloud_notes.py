"""Native Nextcloud Notes adapter for Gravitas workspace notes.

Workspace notes remain first-class Gravitas KnowledgeResource rows so they can
participate in search, ACLs, links and AI context. The same note is mirrored
into the official Nextcloud Notes app and can be edited from either surface.

The Notes API's ETag is the concurrency boundary. We never silently overwrite
when Gravitas and Nextcloud changed since the last common snapshot; the mirror
is marked as a conflict and both versions remain intact until a user resolves
it. Notes created directly in Nextcloud are adopted only when their category
is below ``Gravitas/`` so unrelated personal notes are never pulled into the
platform by surprise.
"""

import hashlib
import json
from urllib.parse import quote

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import cloud
from .layer_access import module_access
from .models import KnowledgeActivity, KnowledgeResource
from .nextcloud_bridge import ensure_user
from .platform_access import can_edit, can_view
from .workspace_api import provision_personal_workspace


CATEGORY_ROOT = 'Gravitas'
SPACE_CATEGORY = {
    'core': f'{CATEGORY_ROOT}/Core',
    'research': f'{CATEGORY_ROOT}/Research',
    'kms': f'{CATEGORY_ROOT}/Learning',
    'learning': f'{CATEGORY_ROOT}/Learning',
}
CATEGORY_SPACE = {
    value: key if key != 'learning' else 'kms'
    for key, value in SPACE_CATEGORY.items()
}
MIRROR_KEY = 'nextcloud_notes'


class NotesError(Exception):
    pass


class NotesConflict(NotesError):
    pass


def _base():
    return f'{settings.NEXTCLOUD_INTERNAL_URL}/index.php/apps/notes/api/v1'


def _headers(extra=None):
    value = {'Accept': 'application/json', 'Content-Type': 'application/json'}
    value.update(extra or {})
    return value


def _request(method, path, *, identity, expected=(200,), body=None, headers=None):
    try:
        response = cloud._request(
            method,
            _base() + path,
            auth=cloud._auth(identity),
            expected=set(expected),
            headers=_headers(headers),
            json=body,
        )
    except Exception as exc:
        raise NotesError(str(exc)) from exc
    payload = None
    if response.content:
        try:
            payload = response.json()
        except ValueError as exc:
            raise NotesError('notes_invalid_response') from exc
    return response.status_code, payload, response.headers


def _list_remote(identity):
    status, payload, _headers_out = _request('GET', '/notes', identity=identity, expected=(200,))
    if status != 200 or not isinstance(payload, list):
        raise NotesError('notes_invalid_list')
    return [item for item in payload if isinstance(item, dict) and item.get('id') is not None]


def _get_remote(identity, note_id):
    status, payload, _headers_out = _request(
        'GET', f'/notes/{int(note_id)}', identity=identity, expected=(200, 404),
    )
    if status == 404:
        return None
    if not isinstance(payload, dict):
        raise NotesError('notes_invalid_note')
    return payload


def _remote_fingerprint(note):
    if not note:
        return ''
    etag = str(note.get('etag') or '').strip()
    if etag:
        return f'etag:{etag}'
    raw = json.dumps({
        'title': str(note.get('title') or ''),
        'content': str(note.get('content') or ''),
        'category': str(note.get('category') or ''),
        'favorite': bool(note.get('favorite')),
        'modified': int(note.get('modified') or 0),
    }, sort_keys=True, ensure_ascii=False).encode('utf-8')
    return 'sha256:' + hashlib.sha256(raw).hexdigest()


def _space(resource):
    value = str((resource.metadata or {}).get('ws_space') or 'research').strip().lower()
    return value if value in {'core', 'research', 'kms'} else 'research'


def _category(resource):
    return SPACE_CATEGORY[_space(resource)]


def _favorite(resource):
    return bool((resource.metadata or {}).get('ws_bookmarked'))


def _local_payload(resource):
    return {
        'title': resource.title,
        'content': resource.body or '',
        'category': _category(resource),
        'favorite': _favorite(resource),
    }


def _local_fingerprint(resource):
    raw = json.dumps(_local_payload(resource), sort_keys=True, ensure_ascii=False).encode('utf-8')
    return 'sha256:' + hashlib.sha256(raw).hexdigest()


def _mirror(resource):
    value = (resource.metadata or {}).get(MIRROR_KEY)
    return dict(value) if isinstance(value, dict) else {}


def _remote_url(note_id=None):
    base = f'{settings.NEXTCLOUD_PUBLIC_URL}/index.php/apps/notes'
    return f'{base}/note/{int(note_id)}' if note_id else base + '/'


def _snapshot(note, local_hash, *, state='synced', error=''):
    return {
        'id': int(note['id']) if note and note.get('id') is not None else None,
        'etag': str((note or {}).get('etag') or ''),
        'remote_fingerprint': _remote_fingerprint(note),
        'local_fingerprint': local_hash,
        'modified': int((note or {}).get('modified') or 0),
        'readonly': bool((note or {}).get('readonly')),
        'state': state,
        'error': str(error or '')[:240],
    }


def _write_mirror(resource, value):
    metadata = dict(resource.metadata or {})
    metadata[MIRROR_KEY] = value
    # A mirror bookkeeping update is not a user edit. QuerySet.update avoids
    # auto_now and post_save, which prevents a successful sync from scheduling
    # itself again forever.
    KnowledgeResource.objects.filter(pk=resource.pk).update(metadata=metadata)
    resource.metadata = metadata


def _mark(resource, state, error='', *, remote=None):
    current = _mirror(resource)
    current.update({
        'state': state,
        'error': str(error or '')[:240],
    })
    if remote:
        current.update({
            'id': int(remote['id']),
            'etag': str(remote.get('etag') or ''),
            'remote_fingerprint': _remote_fingerprint(remote),
            'modified': int(remote.get('modified') or 0),
            'readonly': bool(remote.get('readonly')),
        })
    _write_mirror(resource, current)
    return current


def _create_remote(identity, resource):
    status, note, _headers_out = _request(
        'POST', '/notes', identity=identity, expected=(200,), body=_local_payload(resource),
    )
    if status != 200 or not isinstance(note, dict) or note.get('id') is None:
        raise NotesError('notes_create_failed')
    _write_mirror(resource, _snapshot(note, _local_fingerprint(resource)))
    return note


def _update_remote(identity, resource, remote):
    if remote.get('readonly'):
        _mark(resource, 'readonly', 'nextcloud_note_readonly', remote=remote)
        raise NotesError('nextcloud_note_readonly')
    headers = {}
    known_etag = str(_mirror(resource).get('etag') or '')
    if known_etag:
        headers['If-Match'] = known_etag
    status, note, _headers_out = _request(
        'PUT', f'/notes/{int(remote["id"])}', identity=identity,
        expected=(200, 404, 412), body=_local_payload(resource), headers=headers,
    )
    if status == 412:
        if isinstance(note, dict):
            _mark(resource, 'conflict', 'changed_in_nextcloud_and_gravitas', remote=note)
        else:
            _mark(resource, 'conflict', 'changed_in_nextcloud_and_gravitas')
        raise NotesConflict('changed_in_nextcloud_and_gravitas')
    if status == 404:
        return _create_remote(identity, resource)
    if not isinstance(note, dict):
        raise NotesError('notes_update_failed')
    _write_mirror(resource, _snapshot(note, _local_fingerprint(resource)))
    return note


def _pull_remote(resource, remote):
    if not isinstance(remote, dict):
        raise NotesError('notes_invalid_note')
    content = str(remote.get('content') or '')
    title = str(remote.get('title') or '').strip()[:240] or 'Untitled'
    metadata = dict(resource.metadata or {})
    metadata['ws_bookmarked'] = bool(remote.get('favorite'))
    # The native Notes app edits Markdown as one document. Preserve it as one
    # workspace block on an inbound edit rather than trying to reverse-engineer
    # rich blocks and risking destructive formatting changes.
    metadata['ws_blocks'] = [{'id': f'b-{resource.pk}-native', 'type': 'p', 'text': content}]
    category = str(remote.get('category') or '')
    metadata['ws_space'] = CATEGORY_SPACE.get(category, metadata.get('ws_space') or 'research')

    resource.title = title
    resource.body = content
    resource.metadata = metadata
    local_hash = _local_fingerprint(resource)
    metadata[MIRROR_KEY] = _snapshot(remote, local_hash)
    resource.metadata = metadata
    resource.save(update_fields=['title', 'body', 'metadata', 'updated_at'])
    return resource


def sync_note_to_nextcloud(resource, *, identity=None):
    """Reconcile one Gravitas note against its mapped native Notes note."""
    if resource.kind != KnowledgeResource.Kind.NOTE:
        return None
    identity = identity or ensure_user(resource.owner)
    mirror = _mirror(resource)
    note_id = mirror.get('id')
    if not note_id:
        return _create_remote(identity, resource)

    remote = _get_remote(identity, note_id)
    if remote is None:
        return _create_remote(identity, resource)

    local_hash = _local_fingerprint(resource)
    stored_local = str(mirror.get('local_fingerprint') or '')
    stored_remote = str(mirror.get('remote_fingerprint') or '')
    current_remote = _remote_fingerprint(remote)
    local_changed = bool(stored_local and local_hash != stored_local)
    remote_changed = bool(stored_remote and current_remote != stored_remote)

    if local_changed and remote_changed:
        _mark(resource, 'conflict', 'changed_in_nextcloud_and_gravitas', remote=remote)
        raise NotesConflict('changed_in_nextcloud_and_gravitas')
    if remote_changed and not local_changed:
        _pull_remote(resource, remote)
        return remote
    if local_changed and not remote_changed:
        return _update_remote(identity, resource, remote)

    # First snapshot after upgrading from the old WebDAV-only mirror: if both
    # representations already match, adopt the remote ETag without rewriting.
    if not stored_local or not stored_remote:
        expected = _local_payload(resource)
        same = (
            str(remote.get('title') or '') == expected['title']
            and str(remote.get('content') or '') == expected['content']
            and str(remote.get('category') or '') == expected['category']
            and bool(remote.get('favorite')) == expected['favorite']
        )
        if not same:
            # There is no trustworthy common ancestor. Preserve both and make
            # the conflict explicit instead of choosing a winner by timestamp.
            _mark(resource, 'conflict', 'initial_native_note_mismatch', remote=remote)
            raise NotesConflict('initial_native_note_mismatch')
    _write_mirror(resource, _snapshot(remote, local_hash))
    return remote


def _adopt_remote(user, remote):
    category = str(remote.get('category') or '')
    space = CATEGORY_SPACE.get(category)
    if not space:
        return None
    workspace = provision_personal_workspace(user)
    content = str(remote.get('content') or '')
    title = str(remote.get('title') or '').strip()[:240] or 'Untitled'
    with transaction.atomic():
        resource = KnowledgeResource.objects.create(
            workspace=workspace,
            owner=user,
            kind=KnowledgeResource.Kind.NOTE,
            title=title,
            body=content,
            metadata={
                'ws_space': space,
                'ws_kind': 'note',
                'ws_parent': None,
                'ws_bookmarked': bool(remote.get('favorite')),
                'ws_blocks': [{'id': 'b-native-1', 'type': 'p', 'text': content}],
            },
        )
        metadata = dict(resource.metadata or {})
        resource.metadata = metadata
        local_hash = _local_fingerprint(resource)
        metadata[MIRROR_KEY] = _snapshot(remote, local_hash)
        KnowledgeResource.objects.filter(pk=resource.pk).update(metadata=metadata)
        resource.metadata = metadata
        KnowledgeActivity.objects.create(
            workspace=workspace,
            actor=user,
            resource=resource,
            action='note_adopted_from_nextcloud',
            detail={'title': title, 'nextcloud_note_id': int(remote['id'])},
        )
    return resource


def reconcile_notes(user, *, adopt=True):
    """Bidirectionally reconcile all of a user's Gravitas-native Notes notes."""
    identity = ensure_user(user)
    remote_notes = _list_remote(identity)
    remote_by_id = {int(item['id']): item for item in remote_notes}
    locals_qs = KnowledgeResource.objects.filter(owner=user, kind=KnowledgeResource.Kind.NOTE).order_by('pk')
    local_items = list(locals_qs)
    mapped_ids = {
        int(value)
        for resource in local_items
        for value in [_mirror(resource).get('id')]
        if value is not None
    }
    counts = {'created': 0, 'pushed': 0, 'pulled': 0, 'adopted': 0, 'conflicts': 0, 'errors': 0}

    for resource in local_items:
        before = _mirror(resource)
        before_id = before.get('id')
        before_local = _local_fingerprint(resource)
        before_remote = remote_by_id.get(int(before_id)) if before_id is not None else None
        try:
            result = sync_note_to_nextcloud(resource, identity=identity)
            after = _mirror(resource)
            if before_id is None and after.get('id'):
                counts['created'] += 1
                mapped_ids.add(int(after['id']))
            elif before_remote is not None:
                if before_local != str(before.get('local_fingerprint') or ''):
                    counts['pushed'] += 1
                elif _remote_fingerprint(before_remote) != str(before.get('remote_fingerprint') or ''):
                    counts['pulled'] += 1
            if result and result.get('id') is not None:
                remote_by_id[int(result['id'])] = result
        except NotesConflict:
            counts['conflicts'] += 1
        except (NotesError, cloud.CloudError, ImproperlyConfigured) as exc:
            _mark(resource, 'error', str(exc))
            counts['errors'] += 1

    if adopt:
        for remote in remote_notes:
            remote_id = int(remote['id'])
            if remote_id in mapped_ids:
                continue
            if not str(remote.get('category') or '').startswith(CATEGORY_ROOT + '/'):
                continue
            try:
                adopted = _adopt_remote(user, remote)
                if adopted:
                    counts['adopted'] += 1
                    mapped_ids.add(remote_id)
            except Exception:
                counts['errors'] += 1

    return {
        'counts': counts,
        'native_url': _remote_url(),
        'remote_total': len(remote_notes),
        'local_total': KnowledgeResource.objects.filter(owner=user, kind=KnowledgeResource.Kind.NOTE).count(),
    }


def _allowed_space(user, space):
    if user.is_superuser:
        return True
    if space == 'core':
        return module_access(user, 'core')
    if space == 'research':
        return module_access(user, 'research') or module_access(user, 'core')
    return module_access(user, 'dashboard')


def _resource_for_user(user, resource_id):
    try:
        resource_id = int(resource_id)
    except (TypeError, ValueError):
        return None
    resource = KnowledgeResource.objects.filter(pk=resource_id, kind=KnowledgeResource.Kind.NOTE).first()
    if not resource or not can_view(user, resource):
        return None
    return resource


def _json(resource):
    mirror = _mirror(resource)
    space = _space(resource)
    return {
        'id': resource.pk,
        'title': resource.title,
        'content': resource.body or '',
        'space': space,
        'category': _category(resource),
        'favorite': _favorite(resource),
        'updated': resource.updated_at.isoformat(),
        'sync_state': mirror.get('state') or ('pending' if not mirror.get('id') else 'synced'),
        'sync_error': mirror.get('error') or '',
        'remote_id': mirror.get('id'),
        'remote_modified': mirror.get('modified') or 0,
        'readonly': bool(mirror.get('readonly')),
        'native_url': _remote_url(mirror.get('id')) if mirror.get('id') else _remote_url(),
    }


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


@require_http_methods(['GET', 'POST'])
def native_notes(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)

    if request.method == 'POST':
        data = _body(request)
        title = str(data.get('title') or '').strip()[:240] or 'Untitled'
        content = str(data.get('content') or '')
        space = str(data.get('space') or 'research').strip().lower()
        if space not in {'core', 'research', 'kms'} or not _allowed_space(request.user, space):
            return JsonResponse({'ok': False, 'error': 'space_access_required'}, status=403)
        workspace = provision_personal_workspace(request.user)
        resource = KnowledgeResource.objects.create(
            workspace=workspace,
            owner=request.user,
            kind=KnowledgeResource.Kind.NOTE,
            title=title,
            body=content,
            metadata={
                'ws_space': space,
                'ws_kind': 'note',
                'ws_parent': None,
                'ws_bookmarked': bool(data.get('favorite')),
                'ws_blocks': [{'id': 'b-native-1', 'type': 'p', 'text': content}],
            },
        )
        KnowledgeActivity.objects.create(
            workspace=workspace, actor=request.user, resource=resource,
            action='note_created', detail={'title': title, 'surface': 'nextcloud_notes'},
        )
        try:
            sync_note_to_nextcloud(resource)
        except NotesConflict as exc:
            return JsonResponse({'ok': False, 'error': str(exc), 'item': _json(resource)}, status=409)
        except Exception as exc:
            _mark(resource, 'error', str(exc))
        return JsonResponse({'ok': True, 'item': _json(resource)}, status=201)

    sync_result = None
    available = True
    try:
        sync_result = reconcile_notes(request.user)
    except Exception as exc:
        available = False
        sync_result = {'counts': {'errors': 1}, 'error': str(exc), 'native_url': _remote_url()}
    items = [
        _json(resource)
        for resource in KnowledgeResource.objects.filter(owner=request.user, kind=KnowledgeResource.Kind.NOTE).order_by('-updated_at')
        if _allowed_space(request.user, _space(resource))
    ]
    return JsonResponse({
        'ok': True,
        'available': available,
        'native_url': _remote_url(),
        'sync': sync_result,
        'items': items,
    })


@require_http_methods(['GET', 'PATCH'])
def native_note_detail(request, resource_id):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    resource = _resource_for_user(request.user, resource_id)
    if not resource:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'item': _json(resource)})
    if not can_edit(request.user, resource):
        return JsonResponse({'ok': False, 'error': 'permission_denied'}, status=403)

    data = _body(request)
    metadata = dict(resource.metadata or {})
    if 'title' in data:
        title = str(data.get('title') or '').strip()[:240]
        if not title:
            return JsonResponse({'ok': False, 'error': 'title_required'}, status=400)
        resource.title = title
    if 'content' in data:
        resource.body = str(data.get('content') or '')
        metadata['ws_blocks'] = [{'id': f'b-{resource.pk}-native', 'type': 'p', 'text': resource.body}]
    if 'favorite' in data:
        metadata['ws_bookmarked'] = bool(data.get('favorite'))
    if 'space' in data:
        space = str(data.get('space') or '').strip().lower()
        if space not in {'core', 'research', 'kms'} or not _allowed_space(request.user, space):
            return JsonResponse({'ok': False, 'error': 'space_access_required'}, status=403)
        metadata['ws_space'] = space
    resource.metadata = metadata
    resource.save(update_fields=['title', 'body', 'metadata', 'updated_at'])
    KnowledgeActivity.objects.create(
        workspace=resource.workspace, actor=request.user, resource=resource,
        project=resource.project, action='note_edited',
        detail={'title': resource.title, 'surface': 'nextcloud_notes'},
    )
    try:
        sync_note_to_nextcloud(resource)
    except NotesConflict as exc:
        return JsonResponse({'ok': False, 'error': str(exc), 'item': _json(resource)}, status=409)
    except Exception as exc:
        _mark(resource, 'error', str(exc))
    return JsonResponse({'ok': True, 'item': _json(resource)})


@require_http_methods(['POST'])
def native_notes_sync(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    try:
        result = reconcile_notes(request.user)
    except Exception as exc:
        return JsonResponse({'ok': False, 'error': 'notes_sync_failed', 'detail': str(exc)}, status=503)
    return JsonResponse({'ok': True, **result})
