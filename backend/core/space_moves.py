import io
from pathlib import PurePosixPath
from urllib.parse import unquote, urlparse
from xml.etree import ElementTree

from django.db import transaction

from . import cloud
from .space_fs import (
    SpaceConflict,
    _remote_text,
    _sha,
    ensure_defaults,
    ensure_note_link,
    ensure_project_link,
    filesystem_name,
    sync_node,
    sync_note,
    sync_project,
)
from .space_models import NoteSpaceLink, ProjectSpaceLink, SpaceManagedItem, SpaceNode


def _replace_prefix(value, old, new):
    value = str(value or '')
    if value == old:
        return new
    prefix = old.rstrip('/') + '/'
    if value.startswith(prefix):
        return new.rstrip('/') + '/' + value[len(prefix):]
    return value


def _assert_remote_clean(identity, path, previous_hash, *, force=False):
    remote = _remote_text(identity, path)
    if remote is None:
        return
    remote_hash = _sha(remote)
    if force:
        return
    if not previous_hash or remote_hash != previous_hash:
        raise SpaceConflict(path)


def _propfind_tree(identity, path):
    response = cloud._request(
        'PROPFIND', cloud._dav_url(identity, path), auth=cloud._auth(identity),
        expected={207, 404}, headers={'Depth': 'infinity'},
    )
    if response.status_code == 404:
        return []
    try:
        root = ElementTree.fromstring(response.content)
    except ElementTree.ParseError as exc:
        raise cloud.CloudError('Invalid cloud folder response') from exc
    marker = f'/remote.php/dav/files/{identity.username}/'
    entries = []
    for item in root.findall('{DAV:}response'):
        href = item.findtext('{DAV:}href') or ''
        decoded = unquote(urlparse(href).path)
        if marker not in decoded:
            continue
        item_path = decoded.split(marker, 1)[1].strip('/')
        prop = item.find('.//{DAV:}prop')
        resource_type = prop.find('{DAV:}resourcetype') if prop is not None else None
        is_collection = resource_type is not None and resource_type.find('{DAV:}collection') is not None
        entries.append((item_path, is_collection))
    return entries


def _copy_delete_tree(identity, old_path, new_path):
    entries = _propfind_tree(identity, old_path)
    if not entries:
        return
    old_prefix = old_path.rstrip('/')
    folders = []
    files = []
    for item_path, is_collection in entries:
        relative = item_path[len(old_prefix):].lstrip('/') if item_path.startswith(old_prefix) else ''
        target = new_path if not relative else f'{new_path}/{relative}'
        (folders if is_collection else files).append((item_path, target))
    for _source, target in sorted(folders, key=lambda pair: pair[1].count('/')):
        cloud.make_folder(identity, target)
    for source, target in files:
        upstream = cloud.download(identity, source)
        try:
            payload = io.BytesIO(upstream.content)
            payload.content_type = upstream.headers.get('Content-Type', 'application/octet-stream')
            cloud.upload(identity, target, payload)
        finally:
            upstream.close()
    cloud.delete(identity, old_path)


def move_remote(identity, old_path, new_path, *, folder=False):
    """Move a Nextcloud path with real WebDAV MOVE and a safe fallback.

    Nextcloud natively supports MOVE. The fallback exists because a few reverse
    proxies can time out a long recursive MOVE; files use the existing bounded
    copy/delete helper and folders are copied recursively before deleting source.
    """
    old_path = str(old_path or '').strip('/')
    new_path = str(new_path or '').strip('/')
    if not old_path or old_path == new_path or not cloud.path_exists(identity, old_path):
        return False
    if cloud.path_exists(identity, new_path):
        raise cloud.CloudError('Destination already exists')
    parent = str(PurePosixPath(new_path).parent)
    if parent and parent != '.':
        cloud.make_folder(identity, parent)
    try:
        cloud._request(
            'MOVE', cloud._dav_url(identity, old_path), auth=cloud._auth(identity),
            expected={201, 204},
            headers={'Destination': cloud._dav_url(identity, new_path), 'Overwrite': 'F'},
        )
    except cloud.CloudError:
        if folder:
            _copy_delete_tree(identity, old_path, new_path)
        else:
            cloud.move(identity, old_path, new_path)
    return True


def _move_pair(identity, old_folder, new_folder, old_file, new_file):
    moved_folder = False
    moved_file = False
    try:
        moved_folder = move_remote(identity, old_folder, new_folder, folder=True)
        moved_file = move_remote(identity, old_file, new_file, folder=False)
    except Exception:
        if moved_file:
            try:
                move_remote(identity, new_file, old_file, folder=False)
            except Exception:
                pass
        if moved_folder:
            try:
                move_remote(identity, new_folder, old_folder, folder=True)
            except Exception:
                pass
        raise


def _rewrite_related_paths(user, old_prefix, new_prefix):
    for node in SpaceNode.objects.filter(owner=user, nextcloud_path__startswith=old_prefix + '/'):
        node.nextcloud_path = _replace_prefix(node.nextcloud_path, old_prefix, new_prefix)
        node.sync_state = 'pending'
        node.save(update_fields=['nextcloud_path', 'sync_state', 'updated_at'])
    for link in ProjectSpaceLink.objects.filter(user=user, folder_path__startswith=old_prefix + '/'):
        link.folder_path = _replace_prefix(link.folder_path, old_prefix, new_prefix)
        link.metadata_path = _replace_prefix(link.metadata_path, old_prefix, new_prefix)
        link.sync_state = 'pending'
        link.save(update_fields=['folder_path', 'metadata_path', 'sync_state', 'updated_at'])
    for link in NoteSpaceLink.objects.filter(resource__owner=user):
        changed = False
        new_note = _replace_prefix(link.note_path, old_prefix, new_prefix)
        new_attachments = _replace_prefix(link.attachments_path, old_prefix, new_prefix) if link.attachments_path else ''
        if new_note != link.note_path:
            link.note_path = new_note
            changed = True
        if new_attachments != link.attachments_path:
            link.attachments_path = new_attachments
            changed = True
        if changed:
            link.sync_state = 'pending'
            link.save(update_fields=['note_path', 'attachments_path', 'sync_state', 'updated_at'])
    for item in SpaceManagedItem.objects.filter(owner=user):
        changed = False
        new_file = _replace_prefix(item.file_path, old_prefix, new_prefix)
        new_folder = _replace_prefix(item.folder_path, old_prefix, new_prefix)
        if new_file != item.file_path:
            item.file_path = new_file
            changed = True
        if new_folder != item.folder_path:
            item.folder_path = new_folder
            changed = True
        if changed:
            item.sync_state = 'pending'
            item.save(update_fields=['file_path', 'folder_path', 'sync_state', 'updated_at'])


def move_node(node, *, title=None, parent=None, force=False):
    title = str(title if title is not None else node.title).strip()[:220]
    if not title:
        raise ValueError('title_required')
    if node.kind == SpaceNode.Kind.SUBSPACE:
        if parent is not None:
            raise ValueError('subspace_must_be_top_level')
        new_parent_path = 'Space'
    else:
        parent = parent if parent is not None else node.parent
        if not parent or parent.owner_id != node.owner_id or parent.kind not in {SpaceNode.Kind.SUBSPACE, SpaceNode.Kind.CATEGORY}:
            raise ValueError('invalid_category_parent')
        cursor = parent
        while cursor:
            if cursor.pk == node.pk:
                raise ValueError('space_cycle_not_allowed')
            cursor = cursor.parent
        new_parent_path = parent.nextcloud_path
    new_name = filesystem_name(title)
    new_path = f'{new_parent_path}/{new_name}'
    old_path = node.nextcloud_path
    if new_path == old_path and title == node.title and (parent.pk if parent else None) == node.parent_id:
        return node
    if SpaceNode.objects.filter(owner=node.owner, nextcloud_path=new_path).exclude(pk=node.pk).exists():
        raise ValueError('space_path_already_used')
    identity = ensure_defaults(node.owner, sync=False) and __import__('core.nextcloud_bridge', fromlist=['ensure_user']).ensure_user(node.owner)
    _assert_remote_clean(identity, old_path + '.md', node.content_hash, force=force)
    _move_pair(identity, old_path, new_path, old_path + '.md', new_path + '.md')
    with transaction.atomic():
        node.title = title
        node.filesystem_name = new_name
        node.parent = parent
        node.nextcloud_path = new_path
        node.sync_state = 'pending'
        node.sync_error = ''
        node.save(update_fields=['title', 'filesystem_name', 'parent', 'nextcloud_path', 'sync_state', 'sync_error', 'updated_at'])
        _rewrite_related_paths(node.owner, old_path, new_path)
    sync_node(node, force=True)
    for descendant in SpaceNode.objects.filter(owner=node.owner, nextcloud_path__startswith=new_path + '/'):
        try:
            sync_node(descendant, force=True)
        except cloud.CloudError:
            descendant.sync_state = 'pending'
            descendant.save(update_fields=['sync_state', 'updated_at'])
    return node


def place_project(project, user, category=None, *, force=False):
    defaults = ensure_defaults(user, sync=False)
    existing = ProjectSpaceLink.objects.filter(project=project, user=user).select_related('category').first()
    category = category or (existing.category if existing else defaults['projects'])
    if category.owner_id != user.pk or category.kind != SpaceNode.Kind.CATEGORY:
        raise ValueError('invalid_project_category')
    desired_folder = f'{category.nextcloud_path}/{filesystem_name(project.title)}'
    desired_file = desired_folder + '.md'
    if existing is None:
        link = ensure_project_link(project, user=user, category=category, sync=False)
        return sync_project(project, user=user, force=force)
    if existing.folder_path != desired_folder or existing.metadata_path != desired_file:
        from .nextcloud_bridge import ensure_user
        identity = ensure_user(user)
        _assert_remote_clean(identity, existing.metadata_path, existing.content_hash, force=force)
        old_folder, old_file = existing.folder_path, existing.metadata_path
        _move_pair(identity, old_folder, desired_folder, old_file, desired_file)
        with transaction.atomic():
            existing.category = category
            existing.folder_path = desired_folder
            existing.metadata_path = desired_file
            existing.sync_state = 'pending'
            existing.sync_error = ''
            existing.save(update_fields=['category', 'folder_path', 'metadata_path', 'sync_state', 'sync_error', 'updated_at'])
            _rewrite_related_paths(user, old_folder, desired_folder)
    return sync_project(project, user=user, force=True if force else False)


def sync_project_moveaware(project, user, *, force=False):
    link = ProjectSpaceLink.objects.filter(project=project, user=user).select_related('category').first()
    category = link.category if link else None
    return place_project(project, user, category, force=force)


def _note_destination(resource, category=None, parent_note=None, existing=None, attachments=False):
    if parent_note:
        parent_link = ensure_note_link(parent_note, sync=False, attachments=True)
        base = parent_link.attachments_path
        category = None
    elif resource.project_id:
        base = sync_project_moveaware(resource.project, resource.owner).folder_path
        category = None
    else:
        defaults = ensure_defaults(resource.owner, sync=False)
        category = category or (existing.category if existing else defaults['notes'])
        if category.owner_id != resource.owner_id or category.kind != SpaceNode.Kind.CATEGORY:
            raise ValueError('invalid_note_category')
        base = category.nextcloud_path
    name = filesystem_name(resource.title)
    note_path = f'{base}/{name}.md'
    wants_folder = attachments or bool(parent_note) or bool(existing and existing.attachments_path)
    folder_path = f'{base}/{name}' if wants_folder else ''
    return category, note_path, folder_path


def place_note(resource, *, category=None, parent_note=None, attachments=False, force=False):
    existing = NoteSpaceLink.objects.filter(resource=resource).select_related('category', 'parent_note').first()
    if parent_note is None and existing:
        parent_note = existing.parent_note
    if category is None and existing and not parent_note and not resource.project_id:
        category = existing.category
    if parent_note:
        if parent_note.owner_id != resource.owner_id or parent_note.pk == resource.pk:
            raise ValueError('invalid_parent_note')
        cursor = parent_note
        while cursor:
            if cursor.pk == resource.pk:
                raise ValueError('note_cycle_not_allowed')
            link = NoteSpaceLink.objects.filter(resource=cursor).select_related('parent_note').first()
            cursor = link.parent_note if link else None
    category, desired_file, desired_folder = _note_destination(
        resource, category=category, parent_note=parent_note, existing=existing, attachments=attachments,
    )
    if existing is None:
        ensure_note_link(resource, category=category, parent_note=parent_note, attachments=attachments, sync=False)
        return sync_note(resource, force=force)
    if existing.note_path != desired_file or existing.attachments_path != desired_folder:
        from .nextcloud_bridge import ensure_user
        identity = ensure_user(resource.owner)
        _assert_remote_clean(identity, existing.note_path, existing.content_hash, force=force)
        old_file, old_folder = existing.note_path, existing.attachments_path
        moved_file = move_remote(identity, old_file, desired_file, folder=False)
        moved_folder = False
        try:
            if old_folder and desired_folder:
                moved_folder = move_remote(identity, old_folder, desired_folder, folder=True)
            elif old_folder and not desired_folder:
                if not cloud.folder_is_empty(identity, old_folder):
                    raise ValueError('note_attachments_folder_not_empty')
                cloud.delete(identity, old_folder)
            elif desired_folder:
                cloud.make_folder(identity, desired_folder)
        except Exception:
            if moved_file:
                try:
                    move_remote(identity, desired_file, old_file, folder=False)
                except Exception:
                    pass
            if moved_folder:
                try:
                    move_remote(identity, desired_folder, old_folder, folder=True)
                except Exception:
                    pass
            raise
        with transaction.atomic():
            existing.category = category
            existing.parent_note = parent_note
            existing.note_path = desired_file
            existing.attachments_path = desired_folder
            existing.sync_state = 'pending'
            existing.sync_error = ''
            existing.save()
            if old_folder and desired_folder:
                _rewrite_related_paths(resource.owner, old_folder, desired_folder)
    return sync_note(resource, force=True if force else False)


def sync_note_moveaware(resource, *, force=False):
    existing = NoteSpaceLink.objects.filter(resource=resource).select_related('category', 'parent_note').first()
    return place_note(
        resource,
        category=existing.category if existing else None,
        parent_note=existing.parent_note if existing else None,
        attachments=bool(existing and existing.attachments_path),
        force=force,
    )


def adopt_node_remote_path(node, remote_folder_path, *, title=None):
    remote_folder_path = str(remote_folder_path or '').strip('/')
    if not remote_folder_path.startswith('Space/'):
        raise ValueError('invalid_remote_space_path')
    parent_path = str(PurePosixPath(remote_folder_path).parent)
    if node.kind == SpaceNode.Kind.SUBSPACE:
        if parent_path != 'Space':
            raise ValueError('subspace_must_be_top_level')
        parent = None
    else:
        parent = SpaceNode.objects.filter(owner=node.owner, nextcloud_path=parent_path).first()
        if not parent or parent.kind not in {SpaceNode.Kind.SUBSPACE, SpaceNode.Kind.CATEGORY}:
            raise ValueError('remote_parent_not_indexed')
    old_path = node.nextcloud_path
    with transaction.atomic():
        node.parent = parent
        node.nextcloud_path = remote_folder_path
        node.filesystem_name = PurePosixPath(remote_folder_path).name
        if title:
            node.title = str(title).strip()[:220]
        node.sync_state = 'pending'
        node.save(update_fields=['parent', 'nextcloud_path', 'filesystem_name', 'title', 'sync_state', 'updated_at'])
        if old_path != remote_folder_path:
            _rewrite_related_paths(node.owner, old_path, remote_folder_path)
    return node
