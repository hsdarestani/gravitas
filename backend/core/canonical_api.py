"""A project-scoped file browser; system content stays behind object ACLs."""
import json
from pathlib import PurePosixPath
from urllib.parse import unquote
from xml.etree import ElementTree
from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.db import transaction
from django.http import JsonResponse, HttpResponse
from django.views.decorators.http import require_http_methods
from . import cloud, nextcloud_bridge
from .canonical_models import CanonicalFile
from .canonical_projects import CanonicalConflict, ROOT, active, adopt_project, acl_object, apply, cache, dav_read, dav_write, decode, object_for, refresh_project, merge_content
from .models import ResearchProject
from .models import KnowledgeResource
from .platform_access import can_view, can_edit, can_manage, downloads_allowed


def body(request):
    data = json.loads(request.body or '{}')
    if not isinstance(data, dict):
        raise ValueError('invalid_json')
    return data


def clean_path(value):
    value = str(value or '')
    if value.startswith('/') or '\\' in value or any(part in {'..', '.'} for part in value.split('/')) or '\x00' in value:
        raise ValueError('invalid_path')
    return value.strip('/')


def managed_path(path):
    return path == 'project.md' or path == ROOT or path.startswith(ROOT + '/') or path == '06_Archive' or path.startswith('06_Archive/')


def _project(request, project_id, edit=False):
    project = ResearchProject.objects.filter(pk=project_id, archived=False).first()
    if not project or not request.user.is_authenticated or not (can_edit if edit else can_view)(request.user, project):
        raise PermissionError('project_access_required')
    return project


def error(exc):
    if isinstance(exc, CanonicalConflict):
        return JsonResponse({'ok': False, 'error': str(exc), 'conflict': exc.detail}, status=409)
    return JsonResponse({'ok': False, 'error': str(exc)}, status=403 if isinstance(exc, PermissionError) else 503 if isinstance(exc, (cloud.CloudError, ImproperlyConfigured)) else 400)


def listing(project, user, path):
    # Use the caller's DAV identity even though the index uses service DAV.
    # This preserves native ACLs for arbitrary attachments and user folders.
    identity = nextcloud_bridge.ensure_user(user)
    full = cloud.project_mountpoint(project) + ('/' + path if path else '')
    response = cloud._request('PROPFIND', cloud._dav_url(identity, full), auth=cloud._auth(identity), expected={207},
        headers={'Depth': '1', 'Content-Type': 'application/xml'}, data=b'<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/><d:getlastmodified/><oc:fileid/></d:prop></d:propfind>')
    root = ElementTree.fromstring(response.content)
    rows = []
    for node in root.findall('{DAV:}response'):
        href = unquote(node.findtext('{DAV:}href') or '').rstrip('/')
        name = href.rsplit('/', 1)[-1]
        if name == PurePosixPath(full).name:
            continue
        prop = node.find('.//{DAV:}prop')
        if prop is None:
            continue
        relative = (path + '/' if path else '') + name
        indexed = CanonicalFile.objects.filter(project=project, path=relative).first()
        if indexed:
            obj = object_for(indexed)
            if indexed.deleted or not obj or not can_view(user, acl_object(obj)):
                continue
        is_folder = prop.find('.//{DAV:}collection') is not None
        rows.append({'name': name, 'path': relative, 'folder': is_folder, 'etag': prop.findtext('{DAV:}getetag') or '',
                     'file_id': prop.findtext('{http://owncloud.org/ns}fileid') or '', 'size': prop.findtext('{DAV:}getcontentlength') or '',
                     'canonical': bool(indexed), 'editable': bool(indexed and obj and can_edit(user, acl_object(obj)))})
    return sorted(rows, key=lambda r: (not r['folder'], r['name'].lower()))


@require_http_methods(['GET', 'POST'])
def project_files(request, project_id):
    try:
        project = _project(request, project_id, request.method == 'POST')
        if request.method == 'POST':
            data = body(request)
            if data.get('action') == 'adopt':
                adopt_project(project, request.user)
            else:
                path = clean_path(data.get('path'))
                if not path or managed_path(path):
                    raise ValueError('managed_path_use_project_surface')
                identity = nextcloud_bridge.ensure_user(request.user)
                full = cloud.project_mountpoint(project) + '/' + path
                if data.get('action') == 'folder':
                    cloud.make_folder(identity, full)
                elif data.get('action') == 'file':
                    parent = str(PurePosixPath(full).parent); cloud.make_folder(identity, parent)
                    content = str(data.get('content') or '')
                    if len(content.encode('utf-8')) > 1024 * 1024:
                        raise ValueError('file_too_large')
                    result = cloud._request('PUT', cloud._dav_url(identity, full), auth=cloud._auth(identity), expected={200, 201, 204, 412}, headers={'If-None-Match': '*'}, data=content.encode())
                    if result.status_code == 412:
                        raise ValueError('file_already_exists')
                elif data.get('action') == 'move':
                    if ROOT.startswith(path + '/'):
                        raise ValueError('managed_path_use_project_surface')
                    # A DAV rename must not orphan domain attachment references.
                    tracked = KnowledgeResource.objects.filter(project=project).exclude(storage_path='')
                    prefix = cloud.project_mountpoint(project) + '/'
                    if any(r.storage_path.removeprefix(prefix) == path or r.storage_path.removeprefix(prefix).startswith(path + '/') for r in tracked):
                        raise ValueError('referenced_attachment_use_resource_surface')
                    target = clean_path(data.get('target'))
                    if not target or managed_path(target) or ROOT.startswith(target + '/'):
                        raise ValueError('managed_path_use_project_surface')
                    etag = str(data.get('etag') or '')
                    if not etag:
                        raise ValueError('revision_required')
                    cloud.make_folder(identity, str(PurePosixPath(cloud.project_mountpoint(project) + '/' + target).parent))
                    result = cloud._request('MOVE', cloud._dav_url(identity, full), auth=cloud._auth(identity), expected={201, 204, 412},
                        headers={'Destination': cloud._dav_url(identity, cloud.project_mountpoint(project) + '/' + target), 'Overwrite': 'F', 'If-Match': etag})
                    if result.status_code == 412:
                        raise ValueError('move_conflict')
                else:
                    raise ValueError('unsupported_action')
        path = clean_path(request.GET.get('path', ''))
        return JsonResponse({'ok': True, 'path': path, 'root': cloud.project_mountpoint(project), 'enabled': active(project),
                             'can_edit': can_edit(request.user, project), 'can_manage': can_manage(request.user, project),
                             'items': listing(project, request.user, path), 'native_url': cloud.native_files_url(cloud.project_mountpoint(project) + ('/' + path if path else ''))})
    except (CanonicalConflict, PermissionError, ValueError, cloud.CloudError, ImproperlyConfigured, ValidationError) as exc:
        return error(exc)


@transaction.atomic
@require_http_methods(['GET', 'PUT'])
def project_file_content(request, project_id):
    try:
        project = _project(request, project_id, request.method == 'PUT')
        path = clean_path(request.GET.get('path', 'project.md'))
        file = CanonicalFile.objects.select_for_update().filter(project=project, path=path, deleted=False).first()
        obj = object_for(file) if file else None
        if file and (not obj or not can_view(request.user, acl_object(obj))):
            raise PermissionError('file_access_required')
        if not file:
            if request.method == 'PUT':
                raise ValueError('create_file_from_structure')
            identity = nextcloud_bridge.ensure_user(request.user)
            if not downloads_allowed(project):
                raise PermissionError('downloads_restricted')
            response = cloud.download(identity, cloud.project_mountpoint(project) + '/' + path)
            return HttpResponse(response.content, content_type=response.headers.get('Content-Type', 'application/octet-stream'))
        remote = dav_read(cloud.project_mountpoint(project) + '/' + path)
        if not remote:
            raise ValueError('canonical_file_missing')
        if request.method == 'GET':
            return JsonResponse({'ok': True, 'content': remote['content'], 'etag': remote['etag'], 'path': path,
                                 'can_edit': can_edit(request.user, acl_object(obj))})
        if not can_edit(request.user, acl_object(obj)):
            raise PermissionError('file_edit_required')
        if obj.__class__.__name__ == 'ProjectAuditEvent':
            raise PermissionError('audit_is_append_only')
        data = body(request)
        content = data.get('content')
        if not isinstance(content, str) or len(content.encode()) > 1024 * 1024:
            raise ValueError('invalid_content')
        expected = str(data.get('etag') or '')
        if not expected:
            raise ValueError('revision_required')
        base = file.revisions.filter(etag=expected).first()
        if expected != remote['etag']:
            # A client must use a real cached revision; its supplied base is
            # never trusted for conflict detection or explicit keep-mine.
            content_merged = merge_content(obj, base.content if base else '', content, remote['content']) if base else None
            if content_merged is None:
                raise CanonicalConflict(path, base.content if base else '', content, remote['content'], remote['etag'])
            content = content_merged
        decode(obj, content)
        cache(file, remote, request.user, 'before_save')
        from .canonical_journal import guarded_put
        saved = guarded_put(project, cloud.project_mountpoint(project) + '/' + path, content, remote['etag'])
        if not saved:
            latest = dav_read(cloud.project_mountpoint(project) + '/' + path) or {'content': '', 'etag': ''}
            raise CanonicalConflict(path, remote['content'], content, latest['content'], latest['etag'])
        apply(obj, content); cache(file, saved, request.user)
        return JsonResponse({'ok': True, 'content': saved['content'], 'etag': saved['etag'], 'path': path})
    except (CanonicalConflict, PermissionError, ValueError, cloud.CloudError, ImproperlyConfigured, ValidationError) as exc:
        transaction.set_rollback(True)
        return error(exc)
