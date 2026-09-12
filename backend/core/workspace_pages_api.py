import json

from django.db.models import Q
from django.core.exceptions import ImproperlyConfigured
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import cloud
from .models import KnowledgeActivity, KnowledgeResource
from .platform_access import can_edit, can_view
from .space_fs import SpaceConflict
from .space_models import NoteSpaceLink, SpaceNode
from .space_moves import place_note, sync_note_moveaware
from .workspace_api import provision_personal_workspace


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


def _page_json(resource):
    metadata = resource.metadata or {}
    link = NoteSpaceLink.objects.filter(resource=resource).first()
    parent = metadata.get('ws_parent')
    if not parent and link:
        parent = str(link.parent_note_id) if link.parent_note_id else (f's-{link.category_id}' if link.category_id else None)
    return {
        'id': str(resource.pk), 'title': resource.title,
        'kind': metadata.get('ws_kind') or 'note', 'parent': parent,
        'space': metadata.get('ws_space') or 'research', 'blocks': _blocks(resource),
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
        Q(workspace__owner=user) | Q(workspace__memberships__user=user),
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
        )
        pages = [_page_json(item) for item in notes]
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
    metadata = {
        'ws_blocks': blocks, 'ws_kind': str(data.get('kind') or 'note')[:20],
        'ws_parent': parent, 'ws_space': str(data.get('space') or 'research')[:20],
        'ws_journal_date': str(data.get('journal_date') or '')[:10] or None,
    }
    resource = KnowledgeResource.objects.create(
        workspace=workspace, owner=request.user, kind=KnowledgeResource.Kind.NOTE,
        title=title, body=_plain_text(blocks), metadata=metadata,
    )
    KnowledgeActivity.objects.create(
        workspace=workspace, actor=request.user, resource=resource,
        action='note_created', detail={'title': title},
    )
    link = _sync(resource, category=category, parent_note=parent_note)
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
    if 'parent' in data:
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
    link = _sync(resource, category=category, parent_note=parent_note)
    payload = _page_json(resource)
    if link:
        payload['sync_state'], payload['sync_error'] = link.sync_state, link.sync_error
    return JsonResponse({'ok': True, 'page': payload})
