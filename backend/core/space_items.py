from django.db import transaction
from django.utils import timezone

from . import cloud
from .nextcloud_bridge import ensure_user
from .space_fs import SpaceConflict, _meta_lines, _remote_text, _safe_write, _sha, ensure_defaults, filesystem_name
from .space_models import SpaceManagedItem, SpaceNode
from .space_moves import move_remote, sync_project_moveaware


MANAGED_KINDS = set(SpaceManagedItem.Kind.values)
_UNSET = object()


def _item_base(owner, *, project=None, category=None, parent=None):
    if parent:
        if parent.owner_id != owner.pk:
            raise ValueError('invalid_managed_parent')
        return parent.folder_path, None, parent.project, parent
    if project:
        link = sync_project_moveaware(project, owner)
        return link.folder_path, None, project, None
    if category:
        if category.owner_id != owner.pk or category.kind != SpaceNode.Kind.CATEGORY:
            raise ValueError('invalid_managed_category')
        return category.nextcloud_path, category, None, None
    defaults = ensure_defaults(owner, sync=False)
    return defaults['projects'].nextcloud_path, defaults['projects'], None, None


def item_markdown(item):
    lines = _meta_lines(
        item.kind, item.pk, item.title,
        project_id=item.project_id,
        category_id=item.category_id,
        parent_id=item.parent_id,
        metadata=item.metadata,
        updated_at=item.updated_at.isoformat() if item.updated_at else '',
    )
    lines.extend([f'# {item.title}', '', item.body or '', ''])
    return '\n'.join(lines)


def sync_item(item, *, force=False):
    identity = ensure_user(item.owner)
    cloud.make_folder(identity, item.folder_path)
    try:
        item.content_hash = _safe_write(identity, item.file_path, item_markdown(item), item.content_hash, force=force)
        item.sync_state = 'synced'
        item.sync_error = ''
        item.last_synced_at = timezone.now()
    except SpaceConflict:
        item.sync_state = 'conflict'
        item.sync_error = 'Nextcloud managed Markdown changed; confirm overwrite or reconcile first.'
        item.save(update_fields=['sync_state', 'sync_error', 'updated_at'])
        raise
    except cloud.CloudError as exc:
        item.sync_state = 'pending'
        item.sync_error = str(exc)[:240]
        item.save(update_fields=['sync_state', 'sync_error', 'updated_at'])
        raise
    item.save(update_fields=['content_hash', 'sync_state', 'sync_error', 'last_synced_at', 'updated_at'])
    return item


def create_item(owner, *, kind, title, body='', metadata=None, project=None, category=None, parent=None, sync=True):
    kind = str(kind or '').lower()
    if kind not in MANAGED_KINDS:
        raise ValueError('invalid_managed_item_type')
    title = str(title or '').strip()[:240]
    if not title:
        raise ValueError('title_required')
    if kind == SpaceManagedItem.Kind.SUBTASK and not parent:
        raise ValueError('subtask_parent_required')
    if parent and kind == SpaceManagedItem.Kind.SUBTASK and parent.kind not in {SpaceManagedItem.Kind.TASK, SpaceManagedItem.Kind.SUBTASK}:
        raise ValueError('invalid_subtask_parent')
    base, category, project, parent = _item_base(owner, project=project, category=category, parent=parent)
    name = filesystem_name(title)
    file_path = f'{base}/{name}.md'
    folder_path = f'{base}/{name}'
    if SpaceManagedItem.objects.filter(owner=owner, file_path=file_path).exists():
        raise ValueError('managed_item_path_already_used')
    item = SpaceManagedItem.objects.create(
        owner=owner,
        project=project,
        category=category,
        parent=parent,
        kind=kind,
        title=title,
        body=str(body or ''),
        metadata=metadata if isinstance(metadata, dict) else {},
        file_path=file_path,
        folder_path=folder_path,
    )
    if sync:
        sync_item(item)
    return item


def update_item(item, *, title=None, body=None, metadata=None, project=_UNSET, category=_UNSET, parent=_UNSET, force=False):
    new_title = str(title if title is not None else item.title).strip()[:240]
    if not new_title:
        raise ValueError('title_required')
    target_parent = item.parent if parent is _UNSET else parent
    target_project = item.project if project is _UNSET else project
    target_category = item.category if category is _UNSET else category
    if target_parent:
        target_project = None
        target_category = None
    elif target_project:
        target_category = None
    base, target_category, target_project, target_parent = _item_base(
        item.owner, project=target_project, category=target_category, parent=target_parent,
    )
    if item.kind == SpaceManagedItem.Kind.SUBTASK and not target_parent:
        raise ValueError('subtask_parent_required')
    if item.kind == SpaceManagedItem.Kind.SUBTASK and target_parent.kind not in {SpaceManagedItem.Kind.TASK, SpaceManagedItem.Kind.SUBTASK}:
        raise ValueError('invalid_subtask_parent')
    if target_parent:
        cursor = target_parent
        while cursor:
            if cursor.pk == item.pk:
                raise ValueError('managed_item_cycle_not_allowed')
            cursor = cursor.parent
    name = filesystem_name(new_title)
    new_file = f'{base}/{name}.md'
    new_folder = f'{base}/{name}'
    if SpaceManagedItem.objects.filter(owner=item.owner, file_path=new_file).exclude(pk=item.pk).exists():
        raise ValueError('managed_item_path_already_used')

    if new_file != item.file_path or new_folder != item.folder_path:
        identity = ensure_user(item.owner)
        remote = _remote_text(identity, item.file_path)
        if remote is not None and not force and (not item.content_hash or _sha(remote) != item.content_hash):
            raise SpaceConflict(item.file_path)
        old_file, old_folder = item.file_path, item.folder_path
        moved_folder = move_remote(identity, old_folder, new_folder, folder=True)
        try:
            move_remote(identity, old_file, new_file, folder=False)
        except Exception:
            if moved_folder:
                try:
                    move_remote(identity, new_folder, old_folder, folder=True)
                except Exception:
                    pass
            raise
        with transaction.atomic():
            item.file_path = new_file
            item.folder_path = new_folder
            for child in SpaceManagedItem.objects.filter(owner=item.owner, file_path__startswith=old_folder + '/'):
                child.file_path = new_folder + child.file_path[len(old_folder):]
                child.folder_path = new_folder + child.folder_path[len(old_folder):]
                child.sync_state = 'pending'
                child.save(update_fields=['file_path', 'folder_path', 'sync_state', 'updated_at'])

    item.title = new_title
    item.parent = target_parent
    item.project = target_project
    item.category = target_category
    if body is not None:
        item.body = str(body)
    if metadata is not None:
        item.metadata = metadata if isinstance(metadata, dict) else {}
    item.sync_state = 'pending'
    item.sync_error = ''
    item.save()
    return sync_item(item, force=True if force else False)


def delete_item(item):
    identity = ensure_user(item.owner)
    if SpaceManagedItem.objects.filter(parent=item).exists():
        raise ValueError('managed_item_has_children')
    if cloud.path_exists(identity, item.file_path):
        cloud.delete(identity, item.file_path)
    if cloud.path_exists(identity, item.folder_path):
        if not cloud.folder_is_empty(identity, item.folder_path):
            raise ValueError('managed_item_folder_not_empty')
        cloud.delete(identity, item.folder_path)
    item.delete()


def item_json(item):
    return {
        'id': item.pk,
        'kind': item.kind,
        'tag': '@' + item.kind,
        'title': item.title,
        'body': item.body,
        'metadata': item.metadata,
        'project_id': item.project_id,
        'category_id': item.category_id,
        'parent_id': item.parent_id,
        'file_path': item.file_path,
        'folder_path': item.folder_path,
        'sync_state': item.sync_state,
        'sync_error': item.sync_error,
        'last_synced_at': item.last_synced_at.isoformat() if item.last_synced_at else None,
    }


def accept_remote_item(item, text, *, remote_path=None):
    from .space_reconcile import _parse_markdown

    tag, metadata, body = _parse_markdown(text)
    if tag != item.kind:
        raise ValueError('managed_item_type_mismatch')
    title = str(metadata.get('title') or item.title).strip()[:240] or item.title
    item.title = title
    item.body = body
    remote_metadata = metadata.get('metadata')
    if isinstance(remote_metadata, dict):
        item.metadata = remote_metadata
    item.content_hash = _sha(text)
    item.sync_state = 'synced'
    item.sync_error = ''
    item.last_synced_at = timezone.now()
    if remote_path and remote_path != item.file_path:
        item.file_path = remote_path
        item.folder_path = remote_path[:-3] if remote_path.endswith('.md') else remote_path.rsplit('.', 1)[0]
    item.save()
    return item
