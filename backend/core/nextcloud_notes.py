"""Native Nextcloud Notes adapter for Gravitas workspace notes.

Workspace notes remain first-class Gravitas KnowledgeResource rows so they can
participate in search, ACLs, links and AI context. The same note is mirrored
into the official Nextcloud Notes app and can be edited from either surface.

The Notes API's ETag is the concurrency boundary. We never silently overwrite
when Gravitas and Nextcloud changed since the last common snapshot; the mirror
is marked as a conflict and both versions remain intact until a user explicitly
chooses a winner. Notes created directly in Nextcloud are adopted only from a
Gravitas category the user is actually entitled to use.
"""

import hashlib
import json

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from . import cloud
from .layer_access import module_access
from .layer_models import ActivityEvent
from .models import KnowledgeActivity, KnowledgeResource
from .nextcloud_bridge import ensure_user
from .platform_access import can_edit, can_view
from .workspace_api import provision_personal_workspace


CATEGORY_ROOT = 'Gravitas'
SPACE_CATEGORY = {
    'core': f'{CATEGORY_ROOT}/Core',
    'research': f'{CATEGORY_ROOT}/Research',
    'kms': f'{CATEGORY_ROOT}/Learning',
}
CATEGORY_SPACE = {value: key for key, value in SPACE_CATEGORY.items()}
MIRROR_KEY = 'nextcloud_notes'
DELETE_PENDING_ACTION = 'note.nextcloud_delete_pending'
DELETE_DONE_ACTION = 'note.nextcloud_deleted'
DELETE_OBJECT_TYPE = 'nextcloud_note_tombstone'


class NotesError(Exception):
    pass


class NotesConflict(NotesError):
    pass


def _allowed_space(user, space):
    if not user or not getattr(user, 'is_authenticated', False) or not user.is_active:
        return False
    if user.is_superuser:
        return True
    if space == 'core':
        return module_access(user, 'core')
    if space == 'research':
        return module_access(user, 'research') or module_access(user, 'core')
    if space == 'kms':
        return module_access(user, 'dashboard')
    return False


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


def _delete_remote(identity, note_id):
    status, _payload, _headers_out = _request(
        'DELETE', f'/notes/{int(note_id)}', identity=identity, expected=(200, 404),
    )
    return status in {200, 404}


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
    return value if value in SPACE_CATEGORY else 'research'


def _category(resource):
    return SPACE_CATEGORY[_space(resource)]


def _remote_space(remote):
    return CATEGORY_SPACE.get(str((remote or {}).get('category') or '').strip())


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


def record_note_delete_tombstone(resource):
    """Persist a remote-delete intent after a local note row disappears.

    Without a tombstone, a temporarily unreachable Nextcloud could leave the
    remote note behind and the next reconciliation would adopt it as a new
    local note, effectively resurrecting a deletion. ActivityEvent is used as a
    durable queue because it has no workspace/resource FK and survives cleanup.
    """
    mirror = _mirror(resource)
    note_id = mirror.get('id')
    if note_id is None:
        return None
    return ActivityEvent.objects.create(
        layer=ActivityEvent.Layer.CORE if _space(resource) == 'core' else ActivityEvent.Layer.RESEARCH,
        action=DELETE_PENDING_ACTION,
        object_type=DELETE_OBJECT_TYPE,
        object_id=str(int(note_id)),
        detail={
            'user_id': resource.owner_id,
            'resource_id': resource.pk,
            'title': resource.title,
            'space': _space(resource),
        },
    )


def process_note_delete_tombstones(user, *, identity=None):
    identity = identity or ensure_user(user)
    pending_ids = set()
    deleted = 0
    events = ActivityEvent.objects.filter(
        action=DELETE_PENDING_ACTION,
        object_type=DELETE_OBJECT_TYPE,
    ).order_by('id')
    for event in events.iterator():
        detail = event.detail if isinstance(event.detail, dict) else {}
        try:
            owner_id = int(detail.get('user_id'))
        except (TypeError, ValueError):
            continue
        if owner_id != user.pk:
            continue
        try:
            note_id = int(event.object_id)
        except (TypeError, ValueError):
            event.action = DELETE_DONE_ACTION
            detail['processed_at'] = timezone.now().isoformat()
            detail['result'] = 'invalid_remote_id'
            event.detail = detail
            event.save(update_fields=['action', 'detail'])
            continue
        pending_ids.add(note_id)
        try:
            _delete_remote(identity, note_id)
        except NotesError as exc:
            detail['last_error'] = str(exc)[:240]
            detail['last_attempt_at'] = timezone.now().isoformat()
            event.detail = detail
            event.save(update_fields=['detail'])
            continue
        detail['processed_at'] = timezone.now().isoformat()
        detail['result'] = 'deleted_or_already_missing'
        event.action = DELETE_DONE_ACTION
        event.detail = detail
        event.save(update_fields=['action', 'detail'])
        deleted += 1
    return {'pending_ids': pending_ids, 'deleted': deleted}


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
        _mark(resource, 'conflict', 'deleted_in_nextcloud')
        raise NotesConflict('deleted_in_nextcloud')
    if not isinstance(note, dict):
        raise NotesError('notes_update_failed')
    _write_mirror(resource, _snapshot(note, _local_fingerprint(resource)))
    return note


def _force_update_remote(identity, resource, remote):
    """Explicitly choose the Gravitas copy as the conflict winner."""
    if remote is None:
        return _create_remote(identity, resource)
    if remote.get('readonly'):
        _mark(resource, 'readonly', 'nextcloud_note_readonly', remote=remote)
        raise NotesError('nextcloud_note_readonly')
    status, note, _headers_out = _request(
        'PUT', f'/notes/{int(remote["id"])}', identity=identity,
        expected=(200, 404), body=_local_payload(resource), headers={},
    )
    if status == 404:
        return _create_remote(identity, resource)
    if not isinstance(note, dict):
        raise NotesError('notes_update_failed')
    _write_mirror(resource, _snapshot(note, _local_fingerprint(resource)))
    return note


def _pull_remote(resource, remote):
    if not isinstance(remote, dict):
        raise NotesError('notes_invalid_note')
    target_space = _remote_space(remote)
    if target_space is None:
        _mark(resource, 'conflict', 'moved_outside_gravitas', remote=remote)
        raise NotesConflict('moved_outside_gravitas')
    if not _allowed_space(resource.owner, target_space):
        _mark(resource, 'conflict', 'space_access_required', remote=remote)
        raise NotesConflict('space_access_required')

    content = str(remote.get('content') or '')
    title = str(remote.get('title') or '').strip()[:240] or 'Untitled'
    metadata = dict(resource.metadata or {})
    metadata['ws_bookmarked'] = bool(remote.get('favorite'))
    # The native Notes app edits Markdown as one document. Preserve it as one
    # workspace block on an inbound edit rather than trying to reverse-engineer
    # rich blocks and risking destructive formatting changes.
    metadata['ws_blocks'] = [{'id': f'b-{resource.pk}-native', 'type': 'p', 'text': content}]
    metadata['ws_space'] = target_space

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
    if not _allowed_space(resource.owner, _space(resource)):
        _mark(resource, 'blocked', 'space_access_required')
        raise NotesError('space_access_required')

    identity = identity or ensure_user(resource.owner)
    mirror = _mirror(resource)
    note_id = mirror.get('id')
    if not note_id:
        return _create_remote(identity, resource)

    remote = _get_remote(identity, note_id)
    local_hash = _local_fingerprint(resource)
    stored_local = str(mirror.get('local_fingerprint') or '')
    if remote is None:
        error = 'deleted_in_nextcloud_and_changed_in_gravitas' if stored_local and local_hash != stored_local else 'deleted_in_nextcloud'
        _mark(resource, 'conflict', error)
        raise NotesConflict(error)

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
            _mark(resource, 'conflict', 'initial_native_note_mismatch', remote=remote)
            raise NotesConflict('initial_native_note_mismatch')
    _write_mirror(resource, _snapshot(remote, local_hash))
    return remote


def _adopt_remote(user, remote):
    space = _remote_space(remote)
    if not space or not _allowed_space(user, space):
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
    """Bidirectionally reconcile all entitled native Notes for one account."""
    identity = ensure_user(user)
    tombstones = process_note_delete_tombstones(user, identity=identity)
    remote_notes = _list_remote(identity)
    remote_by_id = {int(item['id']): item for item in remote_notes}
    all_local_items = list(
        KnowledgeResource.objects.filter(owner=user, kind=KnowledgeResource.Kind.NOTE).order_by('pk')
    )
    local_items = [item for item in all_local_items if _allowed_space(user, _space(item))]
    mapped_ids = {
        int(value)
        for resource in all_local_items
        for value in [_mirror(resource).get('id')]
        if value is not None
    }
    mapped_ids.update(tombstones['pending_ids'])
    counts = {
        'created': 0,
        'pushed': 0,
        'pulled': 0,
        'adopted': 0,
        'deleted': tombstones['deleted'],
        'conflicts': 0,
        'errors': 0,
    }

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
        'local_total': len(local_items),
    }


def _resource_for_user(user, resource_id):
    try:
        resource_id = int(resource_id)
    except (TypeError, ValueError):
        return None
    resource = KnowledgeResource.objects.filter(pk=resource_id, kind=KnowledgeResource.Kind.NOTE).first()
    if not resource or not can_view(user, resource) or not _allowed_space(user, _space(resource)):
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
        'can_resolve': mirror.get('state') == 'conflict',
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
        if space not in SPACE_CATEGORY or not _allowed_space(request.user, space):
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


@require_http_methods(['GET', 'PATCH', 'DELETE'])
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

    if request.method == 'DELETE':
        mirror = _mirror(resource)
        note_id = mirror.get('id')
        if note_id is not None:
            try:
                _delete_remote(ensure_user(resource.owner), note_id)
            except (NotesError, cloud.CloudError, ImproperlyConfigured) as exc:
                return JsonResponse({'ok': False, 'error': 'notes_delete_failed', 'detail': str(exc)}, status=503)
        workspace, project, title = resource.workspace, resource.project, resource.title
        resource.delete()
        KnowledgeActivity.objects.create(
            workspace=workspace, actor=request.user, project=project,
            action='note_deleted', detail={'title': title, 'surface': 'nextcloud_notes'},
        )
        return JsonResponse({'ok': True, 'deleted': True})

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
        if space not in SPACE_CATEGORY or not _allowed_space(request.user, space):
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
def native_note_resolve(request, resource_id):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    resource = _resource_for_user(request.user, resource_id)
    if not resource:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    if not can_edit(request.user, resource):
        return JsonResponse({'ok': False, 'error': 'permission_denied'}, status=403)
    if _mirror(resource).get('state') != 'conflict':
        return JsonResponse({'ok': False, 'error': 'note_not_in_conflict'}, status=409)

    winner = str(_body(request).get('winner') or '').strip().lower()
    if winner not in {'gravitas', 'nextcloud'}:
        return JsonResponse({'ok': False, 'error': 'invalid_winner'}, status=400)

    try:
        identity = ensure_user(resource.owner)
        remote = _get_remote(identity, _mirror(resource).get('id')) if _mirror(resource).get('id') else None
        if winner == 'gravitas':
            _force_update_remote(identity, resource, remote)
            KnowledgeActivity.objects.create(
                workspace=resource.workspace, actor=request.user, resource=resource, project=resource.project,
                action='note_conflict_resolved', detail={'winner': 'gravitas'},
            )
            return JsonResponse({'ok': True, 'winner': winner, 'item': _json(resource)})

        if remote is None:
            workspace, project, title = resource.workspace, resource.project, resource.title
            resource.delete()
            KnowledgeActivity.objects.create(
                workspace=workspace, actor=request.user, project=project,
                action='note_conflict_resolved', detail={'winner': 'nextcloud', 'remote_deleted': True, 'title': title},
            )
            return JsonResponse({'ok': True, 'winner': winner, 'deleted': True})
        target_space = _remote_space(remote)
        if not target_space or not _allowed_space(request.user, target_space):
            return JsonResponse({'ok': False, 'error': 'space_access_required'}, status=403)
        _pull_remote(resource, remote)
        KnowledgeActivity.objects.create(
            workspace=resource.workspace, actor=request.user, resource=resource, project=resource.project,
            action='note_conflict_resolved', detail={'winner': 'nextcloud'},
        )
        return JsonResponse({'ok': True, 'winner': winner, 'item': _json(resource)})
    except NotesConflict as exc:
        return JsonResponse({'ok': False, 'error': str(exc), 'item': _json(resource)}, status=409)
    except (NotesError, cloud.CloudError, ImproperlyConfigured) as exc:
        return JsonResponse({'ok': False, 'error': 'notes_resolution_failed', 'detail': str(exc)}, status=503)


@require_http_methods(['POST'])
def native_notes_sync(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    try:
        result = reconcile_notes(request.user)
    except Exception as exc:
        return JsonResponse({'ok': False, 'error': 'notes_sync_failed', 'detail': str(exc)}, status=503)
    return JsonResponse({'ok': True, **result})
