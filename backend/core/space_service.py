import hashlib
import io
import re
import tempfile
from pathlib import PurePosixPath
from urllib.parse import unquote
from xml.etree import ElementTree

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from . import cloud
from .models import KnowledgeResource, StoragePlan
from .platform_api import _project_profile
from .space_models import NoteSpacePlacement, ProjectSpacePlacement, SpaceNode
from .workspace_api import provision_personal_workspace


SYSTEM_TAGS = {
    '@space', '@subspace', '@category', '@project', '@subproject',
    '@task', '@subtask', '@note', '@repository',
}
DEFAULT_SUBSPACES = ('Personal', 'Learning', 'Research')


def storage_name(title):
    value = re.sub(r'\s+', '_', str(title or '').strip())
    value = value.replace('/', '_').replace('\\', '_')
    return cloud.safe_filename(value)


def _plan(user):
    plan, _ = StoragePlan.objects.get_or_create(
        user=user,
        defaults={'tier': 'free', 'quota_bytes': settings.GRAVITAS_DEFAULT_QUOTA_BYTES},
    )
    return plan


def identity_for(user):
    return cloud.ensure_identity(user, _plan(user).quota_bytes)


def _hash(text):
    return hashlib.sha256(str(text).encode('utf-8')).hexdigest()


def _put_text(identity, path, text):
    payload = io.BytesIO(str(text).encode('utf-8'))
    payload.content_type = 'text/markdown; charset=utf-8'
    cloud.upload(identity, path, payload)
    return _hash(text)


def _read_text(identity, path):
    response = cloud.download(identity, path)
    try:
        return response.content.decode('utf-8')
    finally:
        response.close()


def _root_markdown(user):
    return (
        '@space\n\n'
        '# Space\n\n'
        f'Owner: {user.get_full_name() or user.email}\n'
        'Root: Space/\n\n'
        'This folder is the canonical Gravitas knowledge space for this account.\n'
    )


def _node_markdown(node):
    tag = '@subspace' if node.kind == SpaceNode.Kind.SUBSPACE else '@category'
    parent = node.parent.title if node.parent else 'Space'
    return (
        f'{tag}\n\n'
        f'<!-- gravitas:space-node:{node.pk} -->\n'
        f'# {node.title}\n\n'
        f'Type: {node.kind}\n'
        f'Parent: {parent}\n'
        f'Path: {node.folder_path}/\n'
    )


def _project_markdown(project):
    placement = project.space_placement
    profile = _project_profile(project)
    lines = [
        '@project', '',
        f'<!-- gravitas:project:{project.pk} -->',
        f'# {project.title}', '',
        f'Project ID: {project.pk}',
        f'Parent Category: {placement.parent.title}',
        f'Project Type: {profile.category}',
        f'Status: {profile.status}',
        f'Visibility: {profile.visibility}',
        f'Confidentiality: {profile.confidentiality}',
        f'Deadline: {profile.deadline.isoformat() if profile.deadline else ""}',
        f'Data Room: {cloud.project_mountpoint(project)}',
        '',
        '## Research question',
        profile.research_question or '',
        '',
        '## Description',
        project.description or '',
        '',
    ]
    return '\n'.join(lines)


def _note_markdown(resource):
    placement = resource.space_placement
    lines = [
        '@note', '',
        f'<!-- gravitas:note:{resource.pk} -->',
        f'# {resource.title}', '',
    ]
    if resource.description:
        lines += [f'> {resource.description}', '']
    lines += [resource.body or '', '']
    if placement.attachments_path:
        lines += [f'Attachments: {placement.attachments_path}/', '']
    return '\n'.join(lines)


def ensure_space_root(user):
    identity = identity_for(user)
    cloud.make_folder(identity, 'Space')
    root_text = _root_markdown(user)
    _put_text(identity, 'Space.md', root_text)
    return identity


def _paths_for_node(parent, title):
    name = storage_name(title)
    base = parent.folder_path if parent else 'Space'
    return name, f'{base}/{name}', f'{base}/{name}.md'


def create_space_node(user, title, kind, parent=None, *, sync=True):
    kind = str(kind or '').strip().lower()
    if kind not in SpaceNode.Kind.values:
        raise ValueError('invalid_space_node_type')
    if parent and parent.owner_id != user.pk:
        raise ValueError('invalid_parent')
    if kind == SpaceNode.Kind.SUBSPACE and parent is not None:
        raise ValueError('subspace_must_be_top_level')
    if kind == SpaceNode.Kind.CATEGORY and parent is None:
        raise ValueError('category_parent_required')
    name, folder_path, markdown_path = _paths_for_node(parent, title)
    node, created = SpaceNode.objects.get_or_create(
        owner=user,
        parent=parent,
        storage_name=name,
        defaults={
            'kind': kind,
            'title': str(title).strip(),
            'folder_path': folder_path,
            'markdown_path': markdown_path,
        },
    )
    if not created and node.kind != kind:
        raise ValueError('space_name_already_used')
    if sync:
        sync_space_node(node)
    return node


def ensure_default_space(user):
    ensure_space_root(user)
    nodes = {}
    for title in DEFAULT_SUBSPACES:
        nodes[title.lower()] = create_space_node(user, title, SpaceNode.Kind.SUBSPACE)
    defaults = (
        ('personal_notes', nodes['personal'], 'Notes'),
        ('learning_notes', nodes['learning'], 'Notes'),
        ('research_projects', nodes['research'], 'Projects'),
        ('research_notes', nodes['research'], 'Notes'),
    )
    for key, parent, title in defaults:
        nodes[key] = create_space_node(user, title, SpaceNode.Kind.CATEGORY, parent)
    return nodes


def sync_space_node(node):
    identity = ensure_space_root(node.owner)
    cloud.make_folder(identity, node.folder_path)
    text = _node_markdown(node)
    digest = _put_text(identity, node.markdown_path, text)
    node.sync_state = SpaceNode.SyncState.SYNCED
    node.sync_hash = digest
    node.last_synced_at = timezone.now()
    node.save(update_fields=['sync_state', 'sync_hash', 'last_synced_at', 'updated_at'])
    return node


def default_category(user, purpose='notes'):
    nodes = ensure_default_space(user)
    return nodes['research_projects'] if purpose == 'projects' else nodes['personal_notes']


def place_project(project, parent=None):
    parent = parent or default_category(project.owner, 'projects')
    if parent.owner_id != project.owner_id or parent.kind != SpaceNode.Kind.CATEGORY:
        raise ValueError('project_parent_must_be_category')
    name = storage_name(project.title)
    folder_path = f'{parent.folder_path}/{name}'
    markdown_path = f'{parent.folder_path}/{name}.md'
    placement, created = ProjectSpacePlacement.objects.get_or_create(
        project=project,
        defaults={
            'owner': project.owner,
            'parent': parent,
            'storage_name': name,
            'folder_path': folder_path,
            'markdown_path': markdown_path,
        },
    )
    if not created and (placement.parent_id != parent.pk or placement.storage_name != name):
        # Preserve nested note data by only relocating an empty project shell.
        if NoteSpacePlacement.objects.filter(project=project).exists():
            parent = placement.parent
            name = placement.storage_name
            folder_path = placement.folder_path
            markdown_path = placement.markdown_path
        else:
            identity = identity_for(project.owner)
            try:
                if cloud.path_exists(identity, placement.markdown_path):
                    cloud.delete(identity, placement.markdown_path)
                if cloud.path_exists(identity, placement.folder_path):
                    cloud.delete(identity, placement.folder_path)
            except cloud.CloudError:
                pass
            placement.parent = parent
            placement.storage_name = name
            placement.folder_path = folder_path
            placement.markdown_path = markdown_path
    placement.sync_state = SpaceNode.SyncState.PENDING
    placement.save()
    sync_project(project)
    return placement


def sync_project(project):
    placement = getattr(project, 'space_placement', None)
    if placement is None:
        placement = place_project(project)
        return placement
    identity = ensure_space_root(placement.owner)
    cloud.make_folder(identity, placement.folder_path)
    text = _project_markdown(project)
    digest = _put_text(identity, placement.markdown_path, text)
    placement.sync_state = SpaceNode.SyncState.SYNCED
    placement.sync_hash = digest
    placement.last_synced_at = timezone.now()
    placement.save(update_fields=['sync_state', 'sync_hash', 'last_synced_at', 'updated_at'])
    return placement


def _note_parent_path(resource, *, space_parent=None, project=None, parent_note=None):
    if parent_note:
        if parent_note.owner_id != resource.owner_id:
            raise ValueError('invalid_parent_note')
        return parent_note.attachments_path
    if project:
        placement = getattr(project, 'space_placement', None) or place_project(project)
        return placement.folder_path
    parent = space_parent or default_category(resource.owner, 'notes')
    if parent.owner_id != resource.owner_id:
        raise ValueError('invalid_space_parent')
    return parent.folder_path


def place_note(resource, *, space_parent=None, project=None, parent_note=None):
    if resource.kind != KnowledgeResource.Kind.NOTE:
        raise ValueError('resource_is_not_note')
    project = project or resource.project
    base = _note_parent_path(resource, space_parent=space_parent, project=project, parent_note=parent_note)
    name = storage_name(resource.title)
    markdown_path = f'{base}/{name}.md'
    attachments_path = f'{base}/{name}'
    placement, created = NoteSpacePlacement.objects.get_or_create(
        resource=resource,
        defaults={
            'owner': resource.owner,
            'space_parent': None if project or parent_note else (space_parent or default_category(resource.owner, 'notes')),
            'project': project,
            'parent_note': parent_note,
            'storage_name': name,
            'markdown_path': markdown_path,
            'attachments_path': attachments_path,
        },
    )
    if not created:
        placement.space_parent = None if project or parent_note else (space_parent or placement.space_parent or default_category(resource.owner, 'notes'))
        placement.project = project
        placement.parent_note = parent_note
        # Keep an established path when the title changes if nested data exists.
        if not placement.children.exists() and not cloud.path_exists(identity_for(resource.owner), placement.attachments_path):
            placement.storage_name = name
            placement.markdown_path = markdown_path
            placement.attachments_path = attachments_path
    placement.sync_state = SpaceNode.SyncState.PENDING
    placement.save()
    sync_note(resource)
    return placement


def sync_note(resource):
    placement = getattr(resource, 'space_placement', None)
    if placement is None:
        placement = place_note(resource)
        return placement
    identity = ensure_space_root(placement.owner)
    text = _note_markdown(resource)
    digest = _put_text(identity, placement.markdown_path, text)
    placement.sync_state = SpaceNode.SyncState.SYNCED
    placement.sync_hash = digest
    placement.last_synced_at = timezone.now()
    placement.save(update_fields=['sync_state', 'sync_hash', 'last_synced_at', 'updated_at'])
    return placement


def ensure_note_attachment_folder(resource):
    placement = getattr(resource, 'space_placement', None) or place_note(resource)
    identity = ensure_space_root(placement.owner)
    cloud.make_folder(identity, placement.attachments_path)
    return placement, identity


def upload_note_attachment(resource, uploaded_file):
    placement, identity = ensure_note_attachment_folder(resource)
    filename = cloud.safe_filename(uploaded_file.name)
    path = f'{placement.attachments_path}/{filename}'
    if cloud.path_exists(identity, path):
        raise ValueError('attachment_exists')
    cloud.upload(identity, path, uploaded_file)
    return {'name': filename, 'path': path, 'size': uploaded_file.size}


def _list_dir(identity, path):
    body = (
        '<?xml version="1.0" encoding="utf-8" ?>'
        '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/></d:prop></d:propfind>'
    )
    response = cloud._request(
        'PROPFIND', cloud._dav_url(identity, path), auth=cloud._auth(identity),
        expected={207, 404}, headers={'Depth': '1', 'Content-Type': 'application/xml'}, data=body,
    )
    if response.status_code == 404:
        return []
    root = ElementTree.fromstring(response.content)
    prefix = f'/remote.php/dav/files/{identity.username}/'
    entries = []
    clean_root = str(path).strip('/')
    for item in root.findall('{DAV:}response'):
        href = unquote(item.findtext('{DAV:}href') or '')
        index = href.find(prefix)
        if index < 0:
            continue
        relative = href[index + len(prefix):].strip('/')
        if not relative or relative == clean_root:
            continue
        is_dir = item.find('.//{DAV:}resourcetype/{DAV:}collection') is not None
        etag = item.findtext('.//{DAV:}getetag') or ''
        entries.append({'path': relative, 'is_dir': is_dir, 'etag': etag.strip('"')})
    return entries


def walk_markdown(user, *, max_items=500, max_depth=10):
    identity = ensure_space_root(user)
    found, queue = [], [('Space', 0)]
    seen = set()
    while queue and len(found) < max_items:
        path, depth = queue.pop(0)
        if path in seen or depth > max_depth:
            continue
        seen.add(path)
        for entry in _list_dir(identity, path):
            if entry['is_dir']:
                queue.append((entry['path'], depth + 1))
            elif entry['path'].lower().endswith('.md'):
                found.append(entry)
                if len(found) >= max_items:
                    break
    if cloud.path_exists(identity, 'Space.md'):
        found.insert(0, {'path': 'Space.md', 'is_dir': False, 'etag': ''})
    return found


def markdown_type(text):
    for line in str(text or '').splitlines()[:12]:
        token = line.strip().split()[0] if line.strip() else ''
        if token in SYSTEM_TAGS:
            return token[1:]
    return 'markdown'


def parse_note_markdown(text):
    title = ''
    lines = str(text or '').splitlines()
    body_start = 0
    for index, line in enumerate(lines):
        if line.startswith('# '):
            title = line[2:].strip()
            body_start = index + 1
            break
    body_lines = []
    for line in lines[body_start:]:
        stripped = line.strip()
        if stripped.startswith('<!-- gravitas:') or stripped.startswith('Attachments:'):
            continue
        if not body_lines and (not stripped or stripped.startswith('> ')):
            continue
        body_lines.append(line)
    return title or 'Untitled note', '\n'.join(body_lines).strip()


def known_markdown(user):
    rows = [{
        'type': 'space', 'title': 'Space', 'path': 'Space.md', 'editable': False,
        'sync_state': 'synced', 'object_id': None,
    }]
    for node in SpaceNode.objects.filter(owner=user).select_related('parent'):
        rows.append({
            'type': node.kind, 'title': node.title, 'path': node.markdown_path,
            'editable': False, 'sync_state': node.sync_state, 'object_id': node.pk,
        })
    for placement in ProjectSpacePlacement.objects.filter(owner=user).select_related('project', 'parent'):
        rows.append({
            'type': 'project', 'title': placement.project.title, 'path': placement.markdown_path,
            'editable': False, 'sync_state': placement.sync_state, 'object_id': placement.project_id,
            'project_id': placement.project_id,
        })
    for placement in NoteSpacePlacement.objects.filter(owner=user).select_related('resource', 'project', 'parent_note'):
        rows.append({
            'type': 'note', 'title': placement.resource.title, 'path': placement.markdown_path,
            'editable': True, 'sync_state': placement.sync_state, 'object_id': placement.resource_id,
            'project_id': placement.project_id, 'parent_note_id': placement.parent_note_id,
            'attachments_path': placement.attachments_path,
        })
    return sorted(rows, key=lambda item: item['path'].lower())


def sync_all_to_cloud(user):
    ensure_default_space(user)
    for node in SpaceNode.objects.filter(owner=user):
        sync_space_node(node)
    for placement in ProjectSpacePlacement.objects.filter(owner=user).select_related('project'):
        sync_project(placement.project)
    for placement in NoteSpacePlacement.objects.filter(owner=user).select_related('resource'):
        sync_note(placement.resource)
    return known_markdown(user)


def review_cloud_changes(user, *, confirm=False):
    identity = ensure_space_root(user)
    known = {item['path']: item for item in known_markdown(user)}
    note_by_path = {
        p.markdown_path: p for p in NoteSpacePlacement.objects.filter(owner=user).select_related('resource')
    }
    changes = []
    for item in walk_markdown(user):
        path = item['path']
        try:
            text = _read_text(identity, path)
        except cloud.CloudError:
            continue
        digest = _hash(text)
        row = known.get(path)
        if row and row['type'] == 'note':
            placement = note_by_path[path]
            if placement.sync_hash and digest == placement.sync_hash:
                continue
            title, body = parse_note_markdown(text)
            change = {'path': path, 'type': 'note', 'action': 'update', 'title': title, 'requires_confirmation': True}
            if confirm:
                placement.resource.title = title
                placement.resource.body = body
                placement.resource.save(update_fields=['title', 'body', 'updated_at'])
                placement.sync_hash = digest
                placement.sync_state = SpaceNode.SyncState.SYNCED
                placement.last_synced_at = timezone.now()
                placement.save(update_fields=['sync_hash', 'sync_state', 'last_synced_at', 'updated_at'])
                change['applied'] = True
            changes.append(change)
            continue
        if row:
            # Structural markdown can describe DB entities. Never silently rewrite
            # those entities from a file edit; surface the change for user review.
            changes.append({'path': path, 'type': row['type'], 'action': 'review', 'requires_confirmation': True, 'applied': False})
            continue
        kind = markdown_type(text)
        change = {'path': path, 'type': kind, 'action': 'import', 'requires_confirmation': True, 'applied': False}
        if confirm and kind == 'note':
            title, body = parse_note_markdown(text)
            parent_dir = str(PurePosixPath(path).parent)
            node = SpaceNode.objects.filter(owner=user, folder_path=parent_dir).first()
            project_placement = ProjectSpacePlacement.objects.filter(owner=user, folder_path=parent_dir).select_related('project').first()
            parent_note = NoteSpacePlacement.objects.filter(owner=user, attachments_path=parent_dir).first()
            workspace = project_placement.project.workspace if project_placement else provision_personal_workspace(user)
            resource = KnowledgeResource.objects.create(
                workspace=workspace,
                project=project_placement.project if project_placement else None,
                owner=user,
                kind=KnowledgeResource.Kind.NOTE,
                title=title,
                body=body,
                metadata={'imported_from_nextcloud': True},
            )
            placement = NoteSpacePlacement.objects.create(
                resource=resource, owner=user,
                space_parent=node if not project_placement and not parent_note else None,
                project=project_placement.project if project_placement else None,
                parent_note=parent_note,
                storage_name=PurePosixPath(path).stem,
                markdown_path=path,
                attachments_path=f'{parent_dir}/{PurePosixPath(path).stem}',
                sync_state=SpaceNode.SyncState.SYNCED,
                sync_hash=digest,
                last_synced_at=timezone.now(),
            )
            change.update({'applied': True, 'resource_id': resource.pk})
        changes.append(change)
    return changes
