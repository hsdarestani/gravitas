import json
from pathlib import PurePosixPath

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from . import cloud
from .models import KnowledgeResource, ResearchProject
from .nextcloud_bridge import ensure_user
from .platform_access import can_manage
from .space_fs import _remote_text, _sha, remote_markdown_files
from .space_items import accept_remote_item
from .space_models import NoteSpaceLink, ProjectSpaceLink, SpaceManagedItem, SpaceNode
from .space_moves import _rewrite_related_paths, adopt_node_remote_path, sync_note_moveaware, sync_project_moveaware
from .space_reconcile import _accept_note, _accept_project, _import_remote_note, _parse_markdown, _remote_note_context


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _int_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _remote_folder_for_sidecar(path):
    return path[:-3] if str(path).lower().endswith('.md') else str(path)


def _adopt_project_path(user, identity, link, remote_path):
    folder_path = _remote_folder_for_sidecar(remote_path)
    parent_path = str(PurePosixPath(folder_path).parent)
    category = SpaceNode.objects.filter(owner=user, kind=SpaceNode.Kind.CATEGORY, nextcloud_path=parent_path).first()
    if not category:
        raise ValueError('remote_project_category_not_indexed')
    if not cloud.path_exists(identity, folder_path):
        raise ValueError('remote_project_folder_missing')
    old_folder = link.folder_path
    with transaction.atomic():
        link.category = category
        link.folder_path = folder_path
        link.metadata_path = remote_path
        link.sync_state = 'pending'
        link.sync_error = ''
        link.save(update_fields=['category', 'folder_path', 'metadata_path', 'sync_state', 'sync_error', 'updated_at'])
        if old_folder != folder_path:
            _rewrite_related_paths(user, old_folder, folder_path)
    return link


def _adopt_note_path(user, identity, link, remote_path):
    workspace, project, category, parent_note = _remote_note_context(user, remote_path)
    del workspace
    old_folder = link.attachments_path
    attachments_path = _remote_folder_for_sidecar(remote_path)
    if not cloud.path_exists(identity, attachments_path):
        attachments_path = ''
    with transaction.atomic():
        link.category = category
        link.parent_note = parent_note
        link.note_path = remote_path
        link.attachments_path = attachments_path
        link.sync_state = 'pending'
        link.sync_error = ''
        link.save()
        resource = link.resource
        if resource.project_id != (project.pk if project else None):
            resource.project = project
            resource.save(update_fields=['project', 'updated_at'])
        if old_folder and attachments_path and old_folder != attachments_path:
            _rewrite_related_paths(user, old_folder, attachments_path)
    return link


def _managed_context(user, path):
    parent_path = str(PurePosixPath(path).parent)
    parent = SpaceManagedItem.objects.filter(owner=user, folder_path=parent_path).first()
    if parent:
        return {'parent': parent, 'project': None, 'category': None}
    project_link = ProjectSpaceLink.objects.filter(user=user, folder_path=parent_path).select_related('project').first()
    if project_link:
        return {'parent': None, 'project': project_link.project, 'category': None}
    category = SpaceNode.objects.filter(owner=user, kind=SpaceNode.Kind.CATEGORY, nextcloud_path=parent_path).first()
    if category:
        return {'parent': None, 'project': None, 'category': category}
    return None


def _import_managed(user, identity, remote, text, tag, metadata, body):
    context = _managed_context(user, remote['path'])
    if not context:
        raise ValueError('remote_managed_parent_not_indexed')
    folder_path = _remote_folder_for_sidecar(remote['path'])
    title = str(metadata.get('title') or PurePosixPath(remote['path']).stem.replace('_', ' ')).strip()[:240]
    item = SpaceManagedItem.objects.create(
        owner=user,
        project=context['project'],
        category=context['category'],
        parent=context['parent'],
        kind=tag,
        title=title or 'Untitled',
        body=body,
        metadata=metadata.get('metadata') if isinstance(metadata.get('metadata'), dict) else {},
        file_path=remote['path'],
        folder_path=folder_path,
        content_hash=_sha(text),
        sync_state='synced',
        sync_error='',
        last_synced_at=timezone.now(),
    )
    if not cloud.path_exists(identity, folder_path):
        cloud.make_folder(identity, folder_path)
    return item


def _reconcile_node(user, identity, remote, tag, metadata):
    node_id = _int_id(metadata.get('gravitas_id'))
    if not node_id:
        return None
    node = SpaceNode.objects.filter(pk=node_id, owner=user, kind=tag).first()
    if not node:
        return None
    remote_folder = _remote_folder_for_sidecar(remote['path'])
    title = str(metadata.get('title') or '').strip()[:220] or PurePosixPath(remote_folder).name.replace('_', ' ')
    if not cloud.path_exists(identity, remote_folder):
        raise ValueError('remote_space_folder_missing')
    if node.nextcloud_path != remote_folder or node.title != title:
        adopt_node_remote_path(node, remote_folder, title=title)
    text = _remote_text(identity, remote['path']) or ''
    node.content_hash = _sha(text)
    node.sync_state = 'synced'
    node.sync_error = ''
    node.save(update_fields=['content_hash', 'sync_state', 'sync_error', 'updated_at'])
    return node


@require_POST
def reconcile_space_complete(request):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    if not _body(request).get('confirmed'):
        return _error('confirmation_required', 409)
    try:
        identity = ensure_user(request.user)
        remote_files = remote_markdown_files(request.user)
    except cloud.CloudError:
        return _error('cloud_unavailable', 503)

    updated = []
    imported = []
    skipped = []
    errors = []

    for remote in remote_files:
        path = remote['path']
        if path == 'Space.md':
            continue
        try:
            text = _remote_text(identity, path)
            if text is None:
                skipped.append(path)
                continue
            tag, metadata, body = _parse_markdown(text)
            if tag in {SpaceNode.Kind.SUBSPACE, SpaceNode.Kind.CATEGORY}:
                node = _reconcile_node(request.user, identity, remote, tag, metadata)
                if node:
                    updated.append(path)
                else:
                    skipped.append(path)
                continue

            if tag == 'project':
                project_id = _int_id(metadata.get('gravitas_id'))
                project = ResearchProject.objects.filter(pk=project_id).first() if project_id else None
                if not project:
                    skipped.append(path)
                    continue
                link = ProjectSpaceLink.objects.filter(project=project, user=request.user).select_related('category').first()
                if not link:
                    skipped.append(path)
                    continue
                if not can_manage(request.user, project):
                    skipped.append(path)
                    continue
                if link.metadata_path != path:
                    _adopt_project_path(request.user, identity, link, path)
                title = str(metadata.get('title') or '').strip()[:220]
                if title and title != project.title:
                    project.title = title
                    project.save(update_fields=['title', 'updated_at'])
                    link.refresh_from_db()
                if _accept_project(link, identity):
                    sync_project_moveaware(project, request.user, force=True)
                    updated.append(path)
                continue

            if tag == 'note':
                note_id = _int_id(metadata.get('gravitas_id'))
                resource = KnowledgeResource.objects.filter(pk=note_id, owner=request.user, kind=KnowledgeResource.Kind.NOTE).first() if note_id else None
                if resource:
                    link = NoteSpaceLink.objects.filter(resource=resource).select_related('resource', 'category', 'parent_note').first()
                    if not link:
                        skipped.append(path)
                        continue
                    if link.note_path != path:
                        _adopt_note_path(request.user, identity, link, path)
                    title = str(metadata.get('title') or '').strip()[:240]
                    if title and title != resource.title:
                        resource.title = title
                        resource.save(update_fields=['title', 'updated_at'])
                        link.refresh_from_db()
                    if _accept_note(link, identity):
                        sync_note_moveaware(resource, force=True)
                        updated.append(path)
                else:
                    resource = _import_remote_note(request.user, identity, remote)
                    if resource:
                        imported.append({'path': path, 'type': 'note', 'id': resource.pk, 'title': resource.title})
                    else:
                        skipped.append(path)
                continue

            if tag in SpaceManagedItem.Kind.values:
                item_id = _int_id(metadata.get('gravitas_id'))
                item = SpaceManagedItem.objects.filter(pk=item_id, owner=request.user).first() if item_id else None
                if item:
                    context = _managed_context(request.user, path)
                    if not context:
                        raise ValueError('remote_managed_parent_not_indexed')
                    item.parent = context['parent']
                    item.project = context['project']
                    item.category = context['category']
                    accept_remote_item(item, text, remote_path=path)
                    updated.append(path)
                else:
                    item = _import_managed(request.user, identity, remote, text, tag, metadata, body)
                    imported.append({'path': path, 'type': tag, 'id': item.pk, 'title': item.title})
                continue

            skipped.append(path)
        except Exception as exc:
            errors.append({'path': path, 'error': str(exc)[:180]})

    return JsonResponse({
        'ok': not errors,
        'updated': updated,
        'imported': imported,
        'skipped': skipped,
        'errors': errors,
    }, status=207 if errors else 200)
