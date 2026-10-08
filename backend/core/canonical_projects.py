"""File-first project content with existing database objects as typed projections.

The stable Team Folder is retained. Content lives in project.md and individual
Markdown/JSON files under 02_Working/Research. Stable domain IDs in filenames
and immutable headers retain every existing relation. Authorization stays in
platform_access; direct Nextcloud files receive the corresponding object ACL.

Adoption is explicit and fails closed. Existing projects remain on their current
storage contract until a verified backup, export, readback and ACL pass. Saves
use DAV conditions rather than comparing a hash followed by an unconditional
PUT. A revision cache enables conservative three-way merging. Conflicting
versions are returned to the caller; no force flag can silently overwrite.
"""
import contextvars
import difflib
import json
from contextlib import contextmanager
from pathlib import PurePosixPath
from django.apps import apps
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.utils import timezone
from . import cloud, nextcloud_bridge
from .canonical_models import CanonicalFile, CanonicalFileRevision, CanonicalProject
from .models import ResearchProject, KnowledgeResource
from .platform_access import can_edit, can_view, downloads_allowed
from .canonical_journal import journal_transaction

_suppressed = contextvars.ContextVar('canonical_import', default=False)
_pending = contextvars.ContextVar('canonical_pending', default=None)
ROOT = '02_Working/Research'
SPECS = {
    'ResearchProjectProfile': ('metadata', ('category', 'status', 'research_question', 'client_name', 'requester_name', 'requester_email', 'deadline', 'budget', 'currency', 'required_skills', 'compensation_text')),
    'KnowledgeResource': ('notes', ('title', 'description', 'body', 'source_url', 'metadata')),
    'OperatingTask': ('tasks', ('title', 'description', 'priority', 'status', 'due_date', 'definition_of_done', 'blocked_reason', 'completed_at')),
    'ProjectDiscussionMessage': ('discussions', ('body', 'resolved')),
    'ResearchExperiment': ('outputs', ('title', 'hypothesis', 'protocol', 'status', 'result_summary', 'metadata', 'started_at', 'completed_at')),
    'MindMap': ('mindmap', ('title', 'description')),
    'MindMapNode': ('mindmap/nodes', ('title', 'body', 'kind', 'x', 'y')),
    'MindMapEdge': ('mindmap/edges', ('relation', 'label')),
    'DocumentAnnotation': ('annotations', ('body', 'anchor', 'resolved')),
    'ProjectAuditEvent': ('activity', ('action', 'object_type', 'object_id', 'detail')),
}


class CanonicalConflict(Exception):
    def __init__(self, path, base, mine, remote, etag):
        self.detail = {'path': path, 'base': base, 'mine': mine, 'remote': remote, 'etag': etag}
        super().__init__('canonical_file_conflict')


@contextmanager
def suppress():
    token = _suppressed.set(True)
    try:
        yield
    finally:
        _suppressed.reset(token)


def project_for(obj):
    if isinstance(obj, ResearchProject):
        return obj
    if hasattr(obj, 'mind_map'):
        return obj.mind_map.project
    return getattr(obj, 'project', None)


def acl_object(obj):
    if hasattr(obj, 'mind_map'):
        return obj.mind_map
    if obj.__class__.__name__ in {'ResearchProjectProfile', 'ProjectDiscussionMessage', 'ResearchExperiment', 'ProjectAuditEvent'}:
        return obj.project
    return obj


def active(project):
    return bool(project and project.pk and CanonicalProject.objects.filter(project=project, enabled=True).exists())


def relative_path(obj):
    if isinstance(obj, ResearchProject):
        return 'project.md'
    name = obj.__class__.__name__
    folder = SPECS[name][0]
    ext = 'json'
    if name == 'KnowledgeResource':
        folder = {'note': 'notes', 'paper': 'sources', 'file': 'attachments', 'dataset': 'datasets'}[obj.kind]
        ext = 'md' if obj.kind == 'note' else 'json'
    return f'{ROOT}/{folder}/{name}-{obj.pk}/content.{ext}'


def encode(obj):
    if isinstance(obj, ResearchProject):
        header = {'schema': 1, 'type': 'ResearchProject', 'id': obj.pk, 'fields': {'title': obj.title}}
        return '<!-- gravitas:' + json.dumps(header, ensure_ascii=False, sort_keys=True) + ' -->\n' + obj.description
    name = obj.__class__.__name__
    payload = {'schema': 1, 'type': name, 'id': obj.pk, 'project_id': project_for(obj).pk,
               'fields': {field: getattr(obj, field) for field in SPECS[name][1]}}
    if name == 'KnowledgeResource':
        payload['kind'] = obj.kind
        payload['attachment_path'] = obj.storage_path
        if obj.kind == 'note':
            payload['fields'].pop('body')
            return '<!-- gravitas:' + json.dumps(payload, cls=DjangoJSONEncoder, ensure_ascii=False, sort_keys=True) + ' -->\n' + obj.body
    return json.dumps(payload, cls=DjangoJSONEncoder, ensure_ascii=False, sort_keys=True, indent=2) + '\n'


def decode(obj, content):
    if isinstance(obj, ResearchProject):
        if content.startswith('<!-- gravitas:'):
            header, sep, body = content.partition('\n')
            if not sep or not header.endswith(' -->'):
                raise ValueError('invalid_project_header')
            data = json.loads(header[len('<!-- gravitas:'):-len(' -->')])
            if not isinstance(data, dict) or data.get('schema') != 1 or data.get('type') != 'ResearchProject' or data.get('id') != obj.pk or not isinstance(data.get('fields'), dict) or set(data['fields']) != {'title'} or not isinstance(data['fields']['title'], str):
                raise ValueError('canonical_identity_changed')
            title = obj._meta.get_field('title').clean(data['fields']['title'], obj)
            return {'title': title, 'description': body}
        # Existing plain Markdown remains valid without rewriting its title.
        return {'description': content}
    name = obj.__class__.__name__
    if name == 'KnowledgeResource' and obj.kind == 'note':
        header, sep, body = content.partition('\n')
        if not sep or not header.startswith('<!-- gravitas:') or not header.endswith(' -->'):
            raise ValueError('invalid_canonical_note_header')
        data = json.loads(header[len('<!-- gravitas:'):-len(' -->')])
        if not isinstance(data, dict) or not isinstance(data.get('fields'), dict):
            raise ValueError('invalid_canonical_note_header')
        data.get('fields', {})['body'] = body
    else:
        data = json.loads(content)
    if not isinstance(data, dict) or data.get('schema') != 1 or data.get('id') != obj.pk or data.get('type') != name or data.get('project_id') != project_for(obj).pk:
        raise ValueError('canonical_identity_changed')
    if name == 'KnowledgeResource' and (data.get('kind') != obj.kind or data.get('attachment_path') != obj.storage_path):
        raise ValueError('canonical_ownership_or_attachment_changed')
    fields = data.get('fields')
    if not isinstance(fields, dict) or set(fields) != set(SPECS[name][1]):
        raise ValueError('invalid_canonical_fields')
    for field, value in fields.items():
        obj._meta.get_field(field).clean(value, obj)
    return fields


def dav_read(path, etag=None):
    response = cloud._request('GET', cloud._admin_dav_url(path), auth=cloud._admin_auth(), expected={200, 304, 404},
                              headers={'Accept-Encoding': 'identity', **({'If-None-Match': etag} if etag else {})})
    if response.status_code == 404:
        return None
    if response.status_code == 304:
        return {'unchanged': True}
    if len(response.content) > 4 * 1024 * 1024:
        raise ValueError('canonical_file_too_large')
    return {'content': response.content.decode('utf-8'), 'etag': response.headers.get('ETag') or response.headers.get('OC-ETag', ''),
            'file_id': response.headers.get('OC-FileId', '')}


def dav_write(path, content, etag=None):
    parent = str(PurePosixPath(path).parent)
    if not etag:
        cloud.admin_make_folder(parent)
    response = cloud._request('PUT', cloud._admin_dav_url(path), auth=cloud._admin_auth(), expected={200, 201, 204, 412},
                              headers={'Accept-Encoding': 'identity', **({'If-Match': etag} if etag else {'If-None-Match': '*'})}, data=content.encode('utf-8'))
    if response.status_code == 412:
        return None
    result = dav_read(path)
    if not result or result['content'] != content or not result['etag']:
        raise cloud.CloudError('canonical_write_readback_failed')
    return result


def merge_text(base, mine, remote):
    if mine == base or mine == remote:
        return remote
    if remote == base:
        return mine
    original = base.splitlines(keepends=True)
    def edits(value):
        target = value.splitlines(keepends=True)
        return [(i, j, target[a:b]) for op, i, j, a, b in difflib.SequenceMatcher(None, original, target, autojunk=False).get_opcodes() if op != 'equal']
    left, right = edits(mine), edits(remote)
    for a, b, _ in left:
        for c, d, _ in right:
            # Adjacent edits, especially insertion at a boundary, are kept
            # conservative rather than pretending they have a safe ordering.
            if max(a, c) <= min(b, d):
                return None
    merged = list(original)
    for i, j, value in sorted(left + right, reverse=True):
        merged[i:j] = value
    return ''.join(merged)


def merge_content(obj, base, mine, remote):
    if mine == base or mine == remote:
        return remote
    if remote == base:
        return mine
    if isinstance(obj, ResearchProject) or isinstance(obj, KnowledgeResource) and obj.kind == 'note':
        return merge_text(base, mine, remote)
    try:
        b, m, r = (decode(obj, value) for value in (base, mine, remote))
        fields = {}
        for key in b:
            if m[key] == b[key] or m[key] == r[key]:
                fields[key] = r[key]
            elif r[key] == b[key]:
                fields[key] = m[key]
            else:
                return None
        data = json.loads(mine); data['fields'] = fields
        return json.dumps(data, cls=DjangoJSONEncoder, ensure_ascii=False, sort_keys=True, indent=2) + '\n'
    except (ValueError, TypeError, ValidationError):
        return None


def apply(obj, content):
    fields = decode(obj, content)
    with suppress():
        for field, value in fields.items():
            setattr(obj, field, obj._meta.get_field(field).to_python(value))
        obj.full_clean(exclude=['source_url'] if isinstance(obj, KnowledgeResource) else [])
        obj.save()


def cache(file, remote, actor=None, source='gravitas'):
    if file.base_content != remote['content'] or file.etag != remote['etag']:
        CanonicalFileRevision.objects.create(file=file, etag=remote['etag'], content=remote['content'], actor=actor, source=source)
    file.base_content, file.etag = remote['content'], remote['etag']
    file.file_id = remote.get('file_id') or file.file_id
    file.save()


def file_acl(obj, path):
    project = project_for(obj)
    boundary = acl_object(obj)
    visibility = nextcloud_bridge._visibility(boundary)
    roles = nextcloud_bridge._acl_user_roles(boundary, project, visibility)
    # Audit content can mention restricted child objects. Keep its files
    # manager-only until a per-event content redaction policy is available.
    if obj.__class__.__name__ == 'ProjectAuditEvent':
        roles = {nextcloud_bridge.ensure_user(u).username: 'manage' for u in nextcloud_bridge._manager_users(project)}
        visibility = 'specific'
    from .canonical_journal import _batch, RecoveryRequired
    from .canonical_acl import desired_rules
    batch = _batch.get()
    if not batch:
        raise RecoveryRequired('canonical_acl_requires_transaction')
    batch.acl(project, cloud.project_mountpoint(project) + '/' + path,
              desired_rules(cloud.project_group_id(project), roles, visibility, cloud.canonical_native_groups(project).values()))


@transaction.atomic
def export_object(obj, actor=None, adopting=False):
    project = project_for(obj)
    if _suppressed.get() or not project or (not adopting and not active(project)):
        return
    path = relative_path(obj)
    file, created = CanonicalFile.objects.get_or_create(project=project, path=path,
        defaults={'object_type': obj.__class__.__name__, 'object_id': obj.pk})
    file = CanonicalFile.objects.select_for_update().get(pk=file.pk)
    parent = str(PurePosixPath(path).parent)
    if path != 'project.md':
        cloud.admin_make_folder(cloud.project_mountpoint(project) + '/' + parent)
        file_acl(obj, parent)
    mine = encode(obj)
    full = cloud.project_mountpoint(project) + '/' + path
    remote = dav_read(full)
    etag = remote['etag'] if remote else None
    if remote and not etag:
        raise cloud.CloudError('canonical_revision_missing')
    if created and remote and remote['content'] != mine:
        raise CanonicalConflict(path, '', mine, remote['content'], etag)
    if not created and remote and etag != file.etag:
        merged = merge_content(obj, file.base_content, mine, remote['content'])
        if merged is None:
            raise CanonicalConflict(path, file.base_content, mine, remote['content'], etag)
        decode(obj, merged)  # Validate before touching remote content.
        mine = merged
    elif not created and not remote:
        # External deletes are an explicit conflict, never recreation from DB.
        raise CanonicalConflict(path, file.base_content, mine, '', '')
    if not remote or remote['content'] != mine:
        # Keep the old revision before PUT, including edits made externally.
        if remote:
            cache(file, remote, actor, 'before_save')
        from .canonical_journal import guarded_put
        remote = guarded_put(project, full, mine, etag)
        if remote is None:
            latest = dav_read(full) or {'content': '', 'etag': ''}
            raise CanonicalConflict(path, file.base_content, mine, latest['content'], latest['etag'])
    cache(file, remote, actor)
    # Any merged remote change must also be reflected in the database cache.
    if encode(obj) != mine:
        apply(obj, mine)
    return file


def object_for(file):
    if not file.object_type or file.object_type not in {'ResearchProject', *SPECS}:
        return None
    obj = apps.get_model('core', file.object_type).objects.filter(pk=file.object_id).first()
    return obj if obj and project_for(obj).pk == file.project_id else None


@transaction.atomic
def refresh_file(file, user=None):
    file = CanonicalFile.objects.select_for_update().get(pk=file.pk)
    obj = object_for(file)
    if not obj or user and not can_view(user, acl_object(obj)):
        return
    remote = dav_read(cloud.project_mountpoint(file.project) + '/' + file.path, file.etag)
    if remote is None:
        raise CanonicalConflict(file.path, file.base_content, encode(obj), '', '')
    if remote.get('unchanged'):
        return
    if not remote['etag']:
        raise cloud.CloudError('canonical_revision_missing')
    decode(obj, remote['content'])
    apply(obj, remote['content'])
    cache(file, remote, source='nextcloud')


@transaction.atomic
def refresh_project(project, user=None):
    if not active(project):
        return
    CanonicalProject.objects.select_for_update().get(project=project)
    from .canonical_journal import recover_project
    recover_project(project)
    for file in CanonicalFile.objects.filter(project=project, deleted=False).select_related('project'):
        refresh_file(file, user)


def project_objects(project):
    yield project
    for name in SPECS:
        model = apps.get_model('core', name)
        query = {'mind_map__project': project} if name in {'MindMapNode', 'MindMapEdge'} else {'project': project}
        yield from model.objects.filter(**query).order_by('pk')


@journal_transaction
def adopt_project(project, actor):
    from .platform_access import can_manage
    if not can_manage(actor, project):
        raise PermissionError('project_manage_required')
    if not getattr(settings, 'GRAVITAS_CANONICAL_ADOPTION_ENABLED', False):
        raise ValueError('canonical_adoption_pending_operational_validation')
    state, _ = CanonicalProject.objects.get_or_create(project=project)
    state = CanonicalProject.objects.select_for_update().get(pk=state.pk)
    if state.enabled:
        refresh_project(project, actor)
        return state
    nextcloud_bridge.ensure_project_space(project)
    from .canonical_journal import recover_project
    recover_project(project)
    stamp = timezone.now().strftime('%Y%m%dT%H%M%S%f')
    backup_path = cloud.project_mountpoint(project) + '/06_Archive/CanonicalMigration/' + stamp + '.json'
    objects = list(project_objects(project))
    backup = json.dumps([{'type': o.__class__.__name__, 'id': o.pk, 'content': encode(o)} for o in objects], ensure_ascii=False)
    # Backup folder is service-only BEFORE content is written, preventing an
    # intermediate inherited folder from exposing restricted note bodies.
    cloud.admin_make_folder(str(PurePosixPath(backup_path).parent))
    from .canonical_acl import protect_service_folder
    protect_service_folder(project, '06_Archive/CanonicalMigration')
    if not dav_write(backup_path, backup):
        raise cloud.CloudError('migration_backup_failed')
    for obj in objects:
        path = relative_path(obj)
        cloud.admin_make_folder(cloud.project_mountpoint(project) + '/' + str(PurePosixPath(path).parent))
        # Deny inherited access before the first write; replace with exact ACL
        # only after successful file content/readback validation.
        if path != 'project.md':
            protect_service_folder(project, str(PurePosixPath(path).parent))
        export_object(obj, actor, adopting=True)
    if CanonicalFile.objects.filter(project=project, deleted=False).count() != len(objects):
        raise ValueError('migration_count_mismatch')
    state.enabled, state.activated_at, state.migration_backup_path = True, timezone.now(), backup_path
    state.last_error = ''; state.save()
    return state
