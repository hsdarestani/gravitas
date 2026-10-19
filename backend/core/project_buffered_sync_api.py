"""Buffered edit -> explicit push for adopted canonical Nextcloud files.

Edits first persist in a user-private server buffer, not the live DAV file.
A push checks the immutable base ETag, attempts only conservative three-way
merging, then uses the existing conditional DAV journal and revision cache.
Conflicts never overwrite external work. An explicit user merge rebases a
draft against the specific ETag seen in the conflict response.
"""
import json

from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from . import cloud
from .canonical_api import error as canonical_error
from .canonical_journal import journal_transaction, guarded_put
from .canonical_models import CanonicalFile
from .canonical_projects import (
    CanonicalConflict, active, acl_object, apply, cache, dav_read,
    decode, merge_content, object_for,
)
from .models import ResearchProject
from .platform_access import can_edit, can_view
from .project_next_phase_models import ProjectBufferedDraft

MAX_EDIT = 256 * 1024


def _error(code, status=400, **details):
    return JsonResponse({'ok': False, 'error': code, **details}, status=status)


def _json(request):
    if len(request.body) > MAX_EDIT * 2:
        return None
    try:
        data = json.loads(request.body.decode('utf-8') or '{}')
    except (UnicodeDecodeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _scope(request, project_id, file_id=None):
    if not request.user.is_authenticated:
        return None, None, None
    project = ResearchProject.objects.filter(pk=project_id, archived=False).first()
    if not project or not can_edit(request.user, project) or not active(project):
        return None, None, None
    if file_id is None:
        return project, None, None
    file = CanonicalFile.objects.filter(project=project, pk=file_id, deleted=False).first()
    obj = object_for(file) if file else None
    if not file or not obj or not can_edit(request.user, acl_object(obj)):
        return project, None, None
    if obj.__class__.__name__ == 'ProjectAuditEvent':
        return project, None, None
    return project, file, obj


def _remote(project, file):
    return dav_read(cloud.project_mountpoint(project) + '/' + file.path)


def _serialize(draft):
    return {'id': draft.pk, 'file_id': draft.file_id, 'base_etag': draft.base_etag,
            'content': draft.content, 'revision': draft.revision,
            'updated_at': draft.updated_at.isoformat()}


@require_http_methods(['GET'])
def project_draft_files(request, project_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project, _, _ = _scope(request, project_id)
    if not project:
        return _error('not_found', 404)
    files = []
    for file in CanonicalFile.objects.filter(project=project, deleted=False).order_by('path')[:300]:
        obj = object_for(file)
        if obj and obj.__class__.__name__ != 'ProjectAuditEvent' and can_edit(request.user, acl_object(obj)):
            drafts = file.buffered_drafts.filter(user=request.user)
            files.append({'id': file.pk, 'path': file.path, 'has_draft': drafts.exists()})
    return JsonResponse({'ok': True, 'files': files[:100],
                         'storage': 'private_server_buffer', 'push': 'explicit'})


@require_http_methods(['GET', 'POST', 'PATCH', 'DELETE'])
def project_draft(request, project_id, file_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project, file, obj = _scope(request, project_id, file_id)
    if not file:
        return _error('not_found', 404)
    if request.method == 'POST':
        existing = ProjectBufferedDraft.objects.filter(file=file, user=request.user).first()
        if existing:
            return JsonResponse({'ok': True, 'draft': _serialize(existing), 'path': file.path})
        try:
            remote = _remote(project, file)
        except (ValueError, cloud.CloudError, ImproperlyConfigured) as exc:
            return canonical_error(exc)
        if not remote or not remote.get('etag'):
            return _error('remote_revision_unavailable', 503)
        if len(remote['content'].encode('utf-8')) > MAX_EDIT:
            return _error('file_too_large', 413)
        with transaction.atomic():
            draft, _ = ProjectBufferedDraft.objects.get_or_create(
                file=file, user=request.user,
                defaults={'base_etag': remote['etag'], 'base_content': remote['content'],
                          'content': remote['content']},
            )
        return JsonResponse({'ok': True, 'draft': _serialize(draft), 'path': file.path})
    if request.method == 'GET':
        draft = ProjectBufferedDraft.objects.filter(file=file, user=request.user).first()
        if not draft:
            return _error('draft_not_found', 404)
        return JsonResponse({'ok': True, 'draft': _serialize(draft), 'path': file.path})
    if request.method == 'DELETE':
        ProjectBufferedDraft.objects.filter(file=file, user=request.user).delete()
        return JsonResponse({'ok': True})
    data = _json(request)
    if data is None:
        return _error('invalid_payload')
    expected = data.get('revision')
    content = data.get('content')
    if type(expected) is not int or not isinstance(content, str) or len(content.encode('utf-8')) > MAX_EDIT:
        return _error('invalid_draft')
    # Canonical metadata and object identity cannot be changed by a draft.
    try:
        decode(obj, content)
    except (ValueError, TypeError, ValidationError) as exc:
        return _error('invalid_canonical_content')
    with transaction.atomic():
        draft = ProjectBufferedDraft.objects.select_for_update().filter(file=file, user=request.user).first()
        if not draft:
            return _error('draft_not_found', 404)
        if draft.revision != expected:
            return _error('draft_revision_conflict', 409, draft=_serialize(draft))
        # Optional manual resolution needs an exact remote revision. The user
        # supplies the merged content but not the new base snapshot.
        resolving = data.get('resolve_against_etag')
        if resolving is not None:
            try:
                remote = _remote(project, file)
            except (ValueError, cloud.CloudError, ImproperlyConfigured) as exc:
                return canonical_error(exc)
            if not remote or not resolving or remote['etag'] != resolving:
                return _error('remote_changed_again', 409)
            draft.base_content, draft.base_etag = remote['content'], remote['etag']
        draft.content = content
        draft.revision += 1
        draft.save()
    return JsonResponse({'ok': True, 'draft': _serialize(draft)})


@journal_transaction
@require_http_methods(['POST'])
def project_draft_push(request, project_id, file_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project, file, obj = _scope(request, project_id, file_id)
    if not file:
        return _error('not_found', 404)
    data = _json(request)
    if data is None or type(data.get('revision')) is not int:
        return _error('revision_required')
    draft = ProjectBufferedDraft.objects.select_for_update().filter(file=file, user=request.user).first()
    if not draft:
        return _error('draft_not_found', 404)
    if draft.revision != data['revision']:
        return _error('draft_revision_conflict', 409, draft=_serialize(draft))
    file = CanonicalFile.objects.select_for_update().get(pk=file.pk)
    try:
        remote = _remote(project, file)
        if not remote or not remote.get('etag'):
            return _error('remote_revision_unavailable', 503)
        output = draft.content
        if draft.base_etag != remote['etag']:
            output = merge_content(obj, draft.base_content, draft.content, remote['content'])
            if output is None:
                return _error('remote_conflict', 409, conflict={
                    'base': draft.base_content, 'mine': draft.content,
                    'remote': remote['content'], 'etag': remote['etag'],
                    'path': file.path,
                })
        decode(obj, output)
        cache(file, remote, request.user, 'before_buffer_push')
        saved = guarded_put(project, cloud.project_mountpoint(project) + '/' + file.path, output, remote['etag'])
        if not saved:
            latest = _remote(project, file)
            transaction.set_rollback(True)
            return _error('remote_conflict', 409, conflict={
                'base': draft.base_content, 'mine': draft.content,
                'remote': latest['content'] if latest else '',
                'etag': latest['etag'] if latest else '', 'path': file.path,
            })
        apply(obj, saved['content'])
        cache(file, saved, request.user, 'buffered_push')
        draft.delete()
        return JsonResponse({'ok': True, 'pushed': True, 'etag': saved['etag'],
                             'content': saved['content'], 'path': file.path})
    except (CanonicalConflict, PermissionError, ValueError, cloud.CloudError,
            ImproperlyConfigured, ValidationError) as exc:
        transaction.set_rollback(True)
        return canonical_error(exc)
