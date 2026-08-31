import hashlib
import io
import json
import logging
import re
from pathlib import PurePosixPath
from urllib.parse import unquote, urlparse
from xml.etree import ElementTree

from django.utils import timezone

from . import cloud
from .models import KnowledgeResource, ResearchProject
from .nextcloud_bridge import ensure_user
from .space_models import NoteSpaceLink, ProjectSpaceLink, SpaceNode

logger = logging.getLogger(__name__)

SYSTEM_TAGS = {
    'space', 'subspace', 'category', 'project', 'subproject',
    'task', 'subtask', 'note', 'repository',
}
DEFAULT_SUBSPACES = ('Personal', 'Learning', 'Research')


class SpaceConflict(Exception):
    def __init__(self, path):
        self.path = path
        super().__init__('space_file_changed_in_nextcloud')


def filesystem_name(value):
    """Keep human titles intact; only normalize whitespace and unsafe separators."""
    name = re.sub(r'\s+', '_', str(value or '').strip())
    name = name.replace('/', '_').replace('\\', '_').replace('\x00', '')
    name = name.strip(' ._') or 'Untitled'
    return cloud.safe_filename(name)[:220]


def _sha(text):
    return 'sha256:' + hashlib.sha256(text.encode('utf-8')).hexdigest()


def _text_file(text):
    payload = io.BytesIO(text.encode('utf-8'))
    payload.content_type = 'text/markdown; charset=utf-8'
    return payload


def _remote_text(identity, path):
    if not cloud.path_exists(identity, path):
        return None
    response = cloud.download(identity, path)
    try:
        return response.content.decode('utf-8')
    finally:
        response.close()


def _safe_write(identity, path, text, previous_hash='', *, force=False):
    new_hash = _sha(text)
    remote = _remote_text(identity, path)
    if remote is not None:
        remote_hash = _sha(remote)
        if remote_hash == new_hash:
            return new_hash
        if not force and (not previous_hash or remote_hash != previous_hash):
            raise SpaceConflict(path)
    cloud.upload(identity, path, _text_file(text))
    return new_hash


def _meta_lines(kind, object_id, title, **extra):
    lines = [
        f'@{kind}',
        '---',
        f'gravitas_type: {kind}',
        f'gravitas_id: {object_id}',
        'title: ' + json.dumps(str(title), ensure_ascii=False),
    ]
    for key, value in extra.items():
        if value in (None, '', [], {}):
            continue
        lines.append(f'{key}: ' + json.dumps(value, ensure_ascii=False, default=str))
    lines.extend(['---', ''])
    return lines


def _root_markdown(user):
    title = 'Space'
    lines = _meta_lines('space', f'user-{user.pk}', title)
    lines.extend([
        '# Space',
        '',
        'Canonical Gravitas filesystem root for this user.',
        '',
        'Subspaces and categories are represented by a folder and a same-name Markdown sidecar.',
        '',
    ])
    return '\n'.join(lines)


def ensure_space_root(user, *, force=False):
    identity = ensure_user(user)
    cloud.make_folder(identity, 'Space')
    path = 'Space.md'
    text = _root_markdown(user)
    remote = _remote_text(identity, path)
    if remote is None:
        cloud.upload(identity, path, _text_file(text))
    elif force and _sha(remote) != _sha(text):
        cloud.upload(identity, path, _text_file(text))
    return identity


def _node_markdown(node):
    lines = _meta_lines(
        node.kind,
        node.pk,
        node.title,
        parent_id=node.parent_id,
        path=node.nextcloud_path,
        updated_at=node.updated_at.isoformat() if node.updated_at else '',
    )
    lines.extend([f'# {node.title}', '', f'Gravitas @{node.kind} metadata.', ''])
    return '\n'.join(lines)


def sync_node(node, *, force=False):
    identity = ensure_space_root(node.owner)
    cloud.make_folder(identity, node.nextcloud_path)
    metadata_path = node.nextcloud_path + '.md'
    try:
        node.content_hash = _safe_write(identity, metadata_path, _node_markdown(node), node.content_hash, force=force)
        node.sync_state = 'synced'
        node.sync_error = ''
    except SpaceConflict:
        node.sync_state = 'conflict'
        node.sync_error = 'Nextcloud copy changed; confirmation is required before overwrite.'
        node.save(update_fields=['sync_state', 'sync_error', 'updated_at'])
        raise
    except cloud.CloudError as exc:
        node.sync_state = 'pending'
        node.sync_error = str(exc)[:240]
        node.save(update_fields=['sync_state', 'sync_error', 'updated_at'])
        raise
    node.save(update_fields=['content_hash', 'sync_state', 'sync_error', 'updated_at'])
    return node


def create_node(user, title, kind, parent=None, *, sync=True):
    if kind not in SpaceNode.Kind.values:
        raise ValueError('invalid_space_node_type')
    if kind == SpaceNode.Kind.SUBSPACE and parent is not None:
        raise ValueError('subspace_must_be_top_level')
    if kind == SpaceNode.Kind.CATEGORY:
        if parent is None or parent.owner_id != user.pk:
            raise ValueError('category_parent_required')
        if parent.kind not in {SpaceNode.Kind.SUBSPACE, SpaceNode.Kind.CATEGORY}:
            raise ValueError('invalid_category_parent')
    name = filesystem_name(title)
    parent_path = parent.nextcloud_path if parent else 'Space'
    path = f'{parent_path}/{name}'
    node, created = SpaceNode.objects.get_or_create(
        owner=user,
        nextcloud_path=path,
        defaults={
            'parent': parent,
            'kind': kind,
            'title': str(title).strip()[:220],
            'filesystem_name': name,
        },
    )
    if not created and (node.kind != kind or node.parent_id != (parent.pk if parent else None)):
        raise ValueError('space_path_already_used')
    if sync:
        sync_node(node)
    return node


def ensure_defaults(user, *, sync=True):
    nodes = {}
    ensure_space_root(user)
    for title in DEFAULT_SUBSPACES:
        path = f'Space/{filesystem_name(title)}'
        node, _ = SpaceNode.objects.get_or_create(
            owner=user,
            nextcloud_path=path,
            defaults={
                'kind': SpaceNode.Kind.SUBSPACE,
                'title': title,
                'filesystem_name': filesystem_name(title),
            },
        )
        nodes[title.lower()] = node
        if sync and node.sync_state != 'conflict':
            try:
                sync_node(node)
            except (SpaceConflict, cloud.CloudError):
                logger.warning('Could not sync default subspace %s for user %s', title, user.pk)
    personal_notes_path = f"{nodes['personal'].nextcloud_path}/Notes"
    notes, _ = SpaceNode.objects.get_or_create(
        owner=user,
        nextcloud_path=personal_notes_path,
        defaults={
            'parent': nodes['personal'],
            'kind': SpaceNode.Kind.CATEGORY,
            'title': 'Notes',
            'filesystem_name': 'Notes',
        },
    )
    research_projects_path = f"{nodes['research'].nextcloud_path}/Projects"
    projects, _ = SpaceNode.objects.get_or_create(
        owner=user,
        nextcloud_path=research_projects_path,
        defaults={
            'parent': nodes['research'],
            'kind': SpaceNode.Kind.CATEGORY,
            'title': 'Projects',
            'filesystem_name': 'Projects',
        },
    )
    for item in (notes, projects):
        if sync and item.sync_state != 'conflict':
            try:
                sync_node(item)
            except (SpaceConflict, cloud.CloudError):
                logger.warning('Could not sync default category %s for user %s', item.title, user.pk)
    nodes['notes'] = notes
    nodes['projects'] = projects
    return nodes


def _project_markdown(project):
    profile = getattr(project, 'platform_profile', None)
    extra = {
        'workspace_id': project.workspace_id,
        'owner_id': project.owner_id,
        'project_type': getattr(profile, 'category', ''),
        'visibility': getattr(profile, 'visibility', ''),
        'status': getattr(profile, 'status', ''),
        'research_question': getattr(profile, 'research_question', ''),
        'client_name': getattr(profile, 'client_name', ''),
        'deadline': getattr(profile, 'deadline', None),
        'confidentiality': getattr(profile, 'confidentiality', ''),
        'updated_at': project.updated_at.isoformat() if project.updated_at else '',
    }
    lines = _meta_lines('project', project.pk, project.title, **extra)
    lines.extend([f'# {project.title}', '', project.description or '', ''])
    return '\n'.join(lines)


def ensure_project_link(project, category=None, *, sync=False, force=False):
    defaults = ensure_defaults(project.owner, sync=False)
    category = category or defaults['projects']
    if category.owner_id != project.owner_id or category.kind != SpaceNode.Kind.CATEGORY:
        raise ValueError('invalid_project_category')
    name = filesystem_name(project.title)
    folder_path = f'{category.nextcloud_path}/{name}'
    metadata_path = folder_path + '.md'
    link, _ = ProjectSpaceLink.objects.get_or_create(
        project=project,
        defaults={
            'category': category,
            'folder_path': folder_path,
            'metadata_path': metadata_path,
        },
    )
    if link.category_id != category.pk or link.folder_path != folder_path or link.metadata_path != metadata_path:
        link.category = category
        link.folder_path = folder_path
        link.metadata_path = metadata_path
        link.sync_state = 'pending'
        link.sync_error = ''
        link.save(update_fields=['category', 'folder_path', 'metadata_path', 'sync_state', 'sync_error', 'updated_at'])
    if sync:
        sync_project(project, force=force)
    return link


def sync_project(project, *, force=False):
    link = ensure_project_link(project, sync=False)
    identity = ensure_space_root(project.owner)
    cloud.make_folder(identity, link.folder_path)
    try:
        link.content_hash = _safe_write(identity, link.metadata_path, _project_markdown(project), link.content_hash, force=force)
        link.sync_state = 'synced'
        link.sync_error = ''
        link.last_synced_at = timezone.now()
    except SpaceConflict:
        link.sync_state = 'conflict'
        link.sync_error = 'Nextcloud project metadata changed; confirm overwrite or reconcile first.'
        link.save(update_fields=['sync_state', 'sync_error', 'updated_at'])
        raise
    except cloud.CloudError as exc:
        link.sync_state = 'pending'
        link.sync_error = str(exc)[:240]
        link.save(update_fields=['sync_state', 'sync_error', 'updated_at'])
        raise
    link.save(update_fields=['content_hash', 'sync_state', 'sync_error', 'last_synced_at', 'updated_at'])
    return link


def _note_markdown(resource):
    lines = _meta_lines(
        'note',
        resource.pk,
        resource.title,
        project_id=resource.project_id,
        parent_note_id=getattr(getattr(resource, 'space_link', None), 'parent_note_id', None),
        updated_at=resource.updated_at.isoformat() if resource.updated_at else '',
    )
    lines.extend([f'# {resource.title}', '', resource.body or resource.description or '', ''])
    return '\n'.join(lines)


def _note_base_path(resource, category=None, parent_note=None):
    if parent_note:
        parent_link = ensure_note_link(parent_note, sync=False, attachments=True)
        return parent_link.attachments_path
    if resource.project_id:
        project_link = ensure_project_link(resource.project, sync=False)
        return project_link.folder_path
    defaults = ensure_defaults(resource.owner, sync=False)
    chosen = category or defaults['notes']
    if chosen.owner_id != resource.owner_id or chosen.kind != SpaceNode.Kind.CATEGORY:
        raise ValueError('invalid_note_category')
    return chosen.nextcloud_path


def ensure_note_link(resource, category=None, parent_note=None, *, attachments=False, sync=False, force=False):
    if resource.kind != KnowledgeResource.Kind.NOTE:
        raise ValueError('resource_is_not_note')
    if parent_note:
        if parent_note.kind != KnowledgeResource.Kind.NOTE or parent_note.owner_id != resource.owner_id or parent_note.pk == resource.pk:
            raise ValueError('invalid_parent_note')
    base = _note_base_path(resource, category=category, parent_note=parent_note)
    name = filesystem_name(resource.title)
    note_path = f'{base}/{name}.md'
    attachments_path = f'{base}/{name}' if (attachments or parent_note or hasattr(resource, 'space_link') and resource.space_link.attachments_path) else ''
    defaults = ensure_defaults(resource.owner, sync=False)
    chosen_category = category or (getattr(getattr(resource, 'space_link', None), 'category', None))
    if chosen_category is None and not resource.project_id and not parent_note:
        chosen_category = defaults['notes']
    link, _ = NoteSpaceLink.objects.get_or_create(
        resource=resource,
        defaults={
            'category': chosen_category,
            'parent_note': parent_note,
            'note_path': note_path,
            'attachments_path': attachments_path,
        },
    )
    changed = False
    for field, value in (
        ('category', chosen_category),
        ('parent_note', parent_note),
        ('note_path', note_path),
    ):
        old_id = getattr(link, field + '_id', None) if field in {'category', 'parent_note'} else None
        new_id = getattr(value, 'pk', None) if field in {'category', 'parent_note'} else None
        if (field in {'category', 'parent_note'} and old_id != new_id) or (field == 'note_path' and link.note_path != value):
            setattr(link, field, value)
            changed = True
    if attachments and not link.attachments_path:
        link.attachments_path = f'{base}/{name}'
        changed = True
    if changed:
        link.sync_state = 'pending'
        link.sync_error = ''
        link.save()
    if sync:
        sync_note(resource, force=force)
    return link


def sync_note(resource, *, force=False):
    link = ensure_note_link(resource, sync=False)
    identity = ensure_space_root(resource.owner)
    parent = str(PurePosixPath(link.note_path).parent)
    if parent and parent != '.':
        cloud.make_folder(identity, parent)
    if link.attachments_path:
        cloud.make_folder(identity, link.attachments_path)
    try:
        link.content_hash = _safe_write(identity, link.note_path, _note_markdown(resource), link.content_hash, force=force)
        link.sync_state = 'synced'
        link.sync_error = ''
        link.last_synced_at = timezone.now()
    except SpaceConflict:
        link.sync_state = 'conflict'
        link.sync_error = 'Nextcloud note changed; confirm overwrite or reconcile before syncing.'
        link.save(update_fields=['sync_state', 'sync_error', 'updated_at'])
        raise
    except cloud.CloudError as exc:
        link.sync_state = 'pending'
        link.sync_error = str(exc)[:240]
        link.save(update_fields=['sync_state', 'sync_error', 'updated_at'])
        raise
    link.save(update_fields=['content_hash', 'sync_state', 'sync_error', 'last_synced_at', 'updated_at'])
    return link


def _tag_from_text(text):
    for line in str(text or '').splitlines()[:30]:
        line = line.strip().lower()
        if line.startswith('@') and line[1:] in SYSTEM_TAGS:
            return line[1:]
        if line.startswith('gravitas_type:'):
            value = line.split(':', 1)[1].strip().lower()
            if value in SYSTEM_TAGS:
                return value
    return ''


def remote_markdown_files(user, *, max_files=500):
    identity = ensure_space_root(user)
    response = cloud._request(
        'PROPFIND',
        cloud._dav_url(identity, 'Space'),
        auth=cloud._auth(identity),
        expected={207, 404},
        headers={'Depth': 'infinity'},
    )
    if response.status_code == 404:
        return []
    try:
        root = ElementTree.fromstring(response.content)
    except ElementTree.ParseError as exc:
        raise cloud.CloudError('Invalid Space file listing') from exc
    paths = []
    marker = f'/remote.php/dav/files/{identity.username}/'
    for item in root.findall('{DAV:}response'):
        href = item.findtext('{DAV:}href') or ''
        decoded = unquote(urlparse(href).path)
        if marker not in decoded:
            continue
        path = decoded.split(marker, 1)[1].strip('/')
        if path.lower().endswith('.md') and (path == 'Space.md' or path.startswith('Space/')):
            paths.append(path)
        if len(paths) >= max_files:
            break
    result = []
    for path in sorted(set(paths)):
        try:
            text = _remote_text(identity, path) or ''
        except cloud.CloudError:
            text = ''
        result.append({
            'path': path,
            'type': _tag_from_text(text) or 'markdown',
            'title': PurePosixPath(path).stem.replace('_', ' '),
            'hash': _sha(text) if text else '',
        })
    return result


def notes_index(user, *, include_remote=False):
    ensure_defaults(user, sync=False)
    known = [{
        'type': 'space', 'tag': '@space', 'title': 'Space', 'path': 'Space.md',
        'sync_state': 'synced' if cloud.path_exists(ensure_user(user), 'Space.md') else 'pending',
        'source': 'system',
    }]
    for node in SpaceNode.objects.filter(owner=user).select_related('parent'):
        known.append({
            'type': node.kind, 'tag': '@' + node.kind, 'title': node.title,
            'path': node.nextcloud_path + '.md', 'sync_state': node.sync_state,
            'source': 'space', 'id': node.pk,
        })
    for link in ProjectSpaceLink.objects.filter(project__owner=user).select_related('project', 'category'):
        known.append({
            'type': 'project', 'tag': '@project', 'title': link.project.title,
            'path': link.metadata_path, 'sync_state': link.sync_state,
            'source': 'project', 'id': link.project_id,
        })
    for link in NoteSpaceLink.objects.filter(resource__owner=user, resource__kind='note').select_related('resource', 'parent_note'):
        known.append({
            'type': 'note', 'tag': '@note', 'title': link.resource.title,
            'path': link.note_path, 'sync_state': link.sync_state,
            'source': 'note', 'id': link.resource_id,
            'parent_note_id': link.parent_note_id,
            'attachments_path': link.attachments_path,
        })
    known_paths = {item['path'] for item in known}
    remote = []
    if include_remote:
        remote = [item for item in remote_markdown_files(user) if item['path'] not in known_paths]
        for item in remote:
            item.update({'tag': '@' + item['type'] if item['type'] in SYSTEM_TAGS else '', 'sync_state': 'unindexed', 'source': 'nextcloud'})
    return sorted(known + remote, key=lambda item: (item['path'].lower(), item['type']))


def sync_all(user, *, force=False):
    defaults = ensure_defaults(user, sync=False)
    conflicts = []
    errors = []
    for node in SpaceNode.objects.filter(owner=user):
        try:
            sync_node(node, force=force)
        except SpaceConflict as exc:
            conflicts.append(exc.path)
        except cloud.CloudError as exc:
            errors.append(str(exc))
    for project in ResearchProject.objects.filter(owner=user, archived=False).select_related('workspace'):
        try:
            ensure_project_link(project, defaults['projects'], sync=True, force=force)
        except SpaceConflict as exc:
            conflicts.append(exc.path)
        except (cloud.CloudError, ValueError) as exc:
            errors.append(str(exc))
    for resource in KnowledgeResource.objects.filter(owner=user, kind='note').select_related('project'):
        try:
            ensure_note_link(resource, sync=True, force=force)
        except SpaceConflict as exc:
            conflicts.append(exc.path)
        except (cloud.CloudError, ValueError) as exc:
            errors.append(str(exc))
    return {
        'ok': not errors and not conflicts,
        'conflicts': sorted(set(conflicts)),
        'errors': errors[:20],
        'items': notes_index(user, include_remote=True),
    }
