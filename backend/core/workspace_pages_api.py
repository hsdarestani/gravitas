import hashlib
import json
import logging
import re
from pathlib import PurePosixPath

from django.conf import settings
from django.db.models import Q
from django.db import transaction
from django.db.models import Sum
from django.core.exceptions import ImproperlyConfigured
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import cloud
from .models import KnowledgeActivity, KnowledgeResource
from .platform_access import can_edit, can_view
from .space_fs import SpaceConflict, ensure_note_link, ensure_space_root
from .space_models import NoteSpaceLink, SpaceNode
from .space_moves import place_note, sync_note_moveaware
from .workspace_api import _plan, _resource_json, _storage_json, provision_personal_workspace


logger = logging.getLogger(__name__)


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400):
    return JsonResponse({'ok': False, 'error': code}, status=status)


def _blocks(resource):
    value = (resource.metadata or {}).get('ws_blocks')
    if isinstance(value, list):
        return value
    return [{'id': f'b-{resource.pk}-1', 'type': 'p', 'text': resource.body or ''}]


def _plain_text(blocks):
    return '\n\n'.join(str(block.get('text') or '') for block in blocks if isinstance(block, dict)).strip()


def _page_json(resource, *, include_blocks=True):
    metadata = resource.metadata or {}
    try:
        link = resource.space_link
    except NoteSpaceLink.DoesNotExist:
        link = None
    parent = metadata.get('ws_parent')
    if not parent and link:
        parent = str(link.parent_note_id) if link.parent_note_id else (f's-{link.category_id}' if link.category_id else None)
    return {
        'id': str(resource.pk), 'title': resource.title,
        'kind': metadata.get('ws_kind') or 'note', 'parent': parent,
        'space': metadata.get('ws_space') or 'research',
        'blocks': _blocks(resource) if include_blocks else [],
        'created': resource.created_at.isoformat(), 'updated': resource.updated_at.isoformat(),
        'bookmarked': bool(metadata.get('ws_bookmarked')),
        'journal_date': metadata.get('ws_journal_date'),
        'sync_state': link.sync_state if link else 'pending',
        'sync_error': link.sync_error if link else '',
    }


def _resource(user, page_id):
    try:
        pk = int(str(page_id).removeprefix('p-'))
    except (TypeError, ValueError):
        return None
    return KnowledgeResource.objects.select_related('workspace', 'project', 'owner').filter(
        Q(owner=user) | Q(workspace__owner=user) | Q(workspace__memberships__user=user),
        pk=pk, kind=KnowledgeResource.Kind.NOTE,
    ).distinct().first()


def _parent(user, raw):
    value = str(raw or '')
    if value.startswith('s-'):
        category = SpaceNode.objects.filter(pk=value[2:], owner=user, kind=SpaceNode.Kind.CATEGORY).first()
        if not category:
            raise ValueError('invalid_parent')
        return value, category, None
    if value:
        note = _resource(user, value)
        if not note or note.owner_id != user.pk:
            raise ValueError('invalid_parent')
        return str(note.pk), None, note
    return None, None, None


def _sync(resource, *, category=None, parent_note=None):
    """Perform a conflict-aware placement only when the request needs it.

    Ordinary create/edit saves are mirrored by space_signals' bounded worker
    after the database commit. Keeping them off this path is intentional: a
    user's keystroke or New note click must never wait for WebDAV. Explicit
    parent moves still use this synchronous helper because moving a remote
    path has conflict semantics that the request must report immediately.
    """
    try:
        if category is not None or parent_note is not None or not NoteSpaceLink.objects.filter(resource=resource).exists():
            return place_note(resource, category=category, parent_note=parent_note, attachments=True)
        return sync_note_moveaware(resource)
    except (cloud.CloudError, SpaceConflict, ValueError, ImproperlyConfigured):
        return NoteSpaceLink.objects.filter(resource=resource).first()


@require_http_methods(['GET', 'POST'])
def workspace_pages(request):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    if request.method == 'GET':
        folders = []
        for item in SpaceNode.objects.filter(owner=request.user).select_related('parent'):
            folders.append({
                'id': f's-{item.pk}', 'title': item.title, 'kind': 'folder',
                'parent': f's-{item.parent_id}' if item.parent_id else None,
                'space': 'research', 'phantom': False, 'sync_state': item.sync_state,
            })
        notes = KnowledgeResource.objects.filter(
            owner=request.user, kind=KnowledgeResource.Kind.NOTE,
        ).select_related('space_link')
        summary = request.GET.get('summary') in {'1', 'true', 'yes'}
        pages = [_page_json(item, include_blocks=not summary) for item in notes]
        nodes = folders + [{key: page.get(key) for key in ('id', 'title', 'kind', 'parent', 'space')} | {'phantom': False} for page in pages]
        return JsonResponse({'ok': True, 'nodes': nodes, 'pages': pages})

    data = _body(request)
    title = str(data.get('title') or '').strip()[:240]
    if not title:
        return _error('title_required')
    try:
        parent, category, parent_note = _parent(request.user, data.get('parent'))
    except ValueError as exc:
        return _error(str(exc))
    blocks = data.get('blocks') if isinstance(data.get('blocks'), list) else [
        {'id': f'b-new-1', 'type': 'p', 'text': ''},
    ]
    workspace = provision_personal_workspace(request.user)
    kind = str(data.get('kind') or 'note')[:20]
    journal_date = str(data.get('journal_date') or '')[:10] or None
    if kind == 'journal' and journal_date:
        existing = KnowledgeResource.objects.filter(
            owner=request.user, kind=KnowledgeResource.Kind.NOTE,
            metadata__ws_kind='journal', metadata__ws_journal_date=journal_date,
        ).first()
        if existing:
            return JsonResponse({'ok': True, 'page': _page_json(existing)})
    metadata = {
        'ws_blocks': blocks, 'ws_kind': kind,
        'ws_parent': parent, 'ws_space': str(data.get('space') or 'research')[:20],
        'ws_journal_date': journal_date,
    }
    resource = KnowledgeResource.objects.create(
        workspace=workspace, owner=request.user, kind=KnowledgeResource.Kind.NOTE,
        title=title, body=_plain_text(blocks), metadata=metadata,
    )
    KnowledgeActivity.objects.create(
        workspace=workspace, actor=request.user, resource=resource,
        action='note_created', detail={'title': title},
    )
    # Creation is durable as soon as the DB commit succeeds. The post-save
    # worker mirrors it to Space/Nextcloud without extending this request.
    # A requested parent/category remains in metadata and is resolved by that
    # worker; no WebDAV call is allowed on the New note path.
    link = NoteSpaceLink.objects.filter(resource=resource).first()
    payload = _page_json(resource)
    if link:
        payload['sync_state'], payload['sync_error'] = link.sync_state, link.sync_error
    return JsonResponse({'ok': True, 'page': payload}, status=201)


@require_http_methods(['GET', 'PATCH'])
def workspace_page_detail(request, page_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    resource = _resource(request.user, page_id)
    if not resource or not can_view(request.user, resource):
        return _error('not_found', 404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'page': _page_json(resource)})
    if not can_edit(request.user, resource):
        return _error('permission_denied', 403)
    data = _body(request)
    metadata = dict(resource.metadata or {})
    if 'title' in data:
        title = str(data.get('title') or '').strip()[:240]
        if not title:
            return _error('title_required')
        resource.title = title
    if isinstance(data.get('blocks'), list):
        metadata['ws_blocks'] = data['blocks']
        resource.body = _plain_text(data['blocks'])
    category = parent_note = None
    parent_changed = 'parent' in data
    if parent_changed:
        try:
            parent, category, parent_note = _parent(request.user, data.get('parent'))
        except ValueError as exc:
            return _error(str(exc))
        metadata['ws_parent'] = parent
    if 'bookmarked' in data:
        metadata['ws_bookmarked'] = bool(data['bookmarked'])
    resource.metadata = metadata
    resource.save(update_fields=['title', 'body', 'metadata', 'updated_at'])
    KnowledgeActivity.objects.create(
        workspace=resource.workspace, actor=request.user, resource=resource,
        project=resource.project, action='note_edited', detail={'title': resource.title},
    )
    # Body/title/bookmark saves return immediately; the post-save worker keeps
    # Nextcloud in sync. Parent moves remain synchronous so remote-path
    # conflicts are handled before we claim the move succeeded.
    link = _sync(resource, category=category, parent_note=parent_note) if parent_changed else NoteSpaceLink.objects.filter(resource=resource).first()
    payload = _page_json(resource)
    if link:
        payload['sync_state'], payload['sync_error'] = link.sync_state, link.sync_error
    return JsonResponse({'ok': True, 'page': payload})


@require_http_methods(['GET'])
def workspace_page_backlinks(request, page_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    target = _resource(request.user, page_id)
    if not target or not can_view(request.user, target):
        return _error('not_found', 404)

    title = target.title.strip()
    pattern = re.compile(r'\[\[\s*' + re.escape(title) + r'\s*\]\]', re.IGNORECASE)
    candidates = KnowledgeResource.objects.select_related('workspace', 'project', 'owner').filter(
        Q(owner=request.user) | Q(workspace__owner=request.user) | Q(workspace__memberships__user=request.user),
        kind=KnowledgeResource.Kind.NOTE,
    ).exclude(pk=target.pk).distinct()
    links = []
    for resource in candidates:
        if not can_view(request.user, resource):
            continue
        for block in _blocks(resource):
            text = str(block.get('text') or '') if isinstance(block, dict) else ''
            match = pattern.search(text)
            if not match:
                continue
            start = max(0, match.start() - 48)
            excerpt = text[start:match.end() + 72].strip()
            if start:
                excerpt = '…' + excerpt
            if match.end() + 72 < len(text):
                excerpt += '…'
            links.append({'id': str(resource.pk), 'title': resource.title, 'excerpt': excerpt})
            break
    return JsonResponse({'ok': True, 'links': links})


@require_http_methods(['POST'])
def workspace_page_attachment(request, page_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    note = _resource(request.user, page_id)
    if not note or not can_view(request.user, note):
        return _error('not_found', 404)
    if not can_edit(request.user, note):
        return _error('permission_denied', 403)
    uploaded = request.FILES.get('file')
    if not uploaded:
        return _error('file_required')
    if uploaded.size <= 0 or uploaded.size > settings.GRAVITAS_MAX_UPLOAD_BYTES:
        return _error('file_size_invalid', 413)

    filename = cloud.safe_filename(uploaded.name)
    try:
        link = ensure_note_link(note, attachments=True, sync=False)
        identity = ensure_space_root(note.owner)
        cloud.make_folder(identity, link.attachments_path)
    except (cloud.CloudError, ValueError, ImproperlyConfigured):
        logger.exception('Could not prepare attachment folder for note %s', note.pk)
        return _error('cloud_unavailable', 503)

    storage_path = f'{link.attachments_path}/{filename}'
    if KnowledgeResource.objects.filter(owner=note.owner, storage_path__iexact=storage_path).exists():
        return _error('file_exists', 409)

    with transaction.atomic():
        plan = _plan(note.owner, lock=True)
        used = KnowledgeResource.objects.filter(owner=note.owner).aggregate(total=Sum('file_size'))['total'] or 0
        if used + uploaded.size > plan.quota_bytes:
            return _error('quota_exceeded', 413)
        resource = KnowledgeResource.objects.create(
            workspace=note.workspace, project=note.project, owner=note.owner,
            kind=KnowledgeResource.Kind.FILE, title=filename, original_name=filename,
            mime_type=(uploaded.content_type or 'application/octet-stream')[:160],
            file_size=uploaded.size, ingestion_status='pending', storage_path=storage_path,
            metadata={'extension': PurePosixPath(filename).suffix.lower(), 'ws_parent_page': str(note.pk)},
        )

    try:
        digest = hashlib.sha256()
        uploaded.seek(0)
        for chunk in uploaded.chunks():
            digest.update(chunk)
        uploaded.seek(0)
        cloud.upload(identity, storage_path, uploaded)
    except Exception:
        resource.delete()
        logger.exception('Cloud attachment upload failed for note %s', note.pk)
        return _error('cloud_unavailable', 503)

    resource.checksum = f'sha256:{digest.hexdigest()}'
    resource.save(update_fields=['checksum', 'updated_at'])
    KnowledgeActivity.objects.create(
        workspace=note.workspace, actor=request.user, resource=resource, project=note.project,
        action='file_uploaded', detail={'title': filename, 'parent_note_id': note.pk},
    )
    return JsonResponse({
        'ok': True, 'item': _resource_json(resource, True, request.user, True),
        'storage': _storage_json(note.owner),
    }, status=201)
