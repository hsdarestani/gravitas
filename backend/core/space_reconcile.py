import hashlib
import json
from pathlib import PurePosixPath

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from . import cloud
from .models import KnowledgeResource
from .nextcloud_bridge import ensure_user
from .platform_api import ensure_dual_workspaces
from .space_fs import _remote_text, remote_markdown_files
from .space_models import NoteSpaceLink, ProjectSpaceLink, SpaceNode


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _hash(text):
    return 'sha256:' + hashlib.sha256(text.encode('utf-8')).hexdigest()


def _parse_markdown(text):
    lines = str(text or '').splitlines()
    tag = ''
    metadata = {}
    index = 0
    if lines and lines[0].strip().startswith('@'):
        tag = lines[0].strip()[1:].lower()
        index = 1
    if index < len(lines) and lines[index].strip() == '---':
        index += 1
        while index < len(lines) and lines[index].strip() != '---':
            line = lines[index]
            if ':' in line:
                key, value = line.split(':', 1)
                key, value = key.strip(), value.strip()
                try:
                    metadata[key] = json.loads(value)
                except (json.JSONDecodeError, TypeError):
                    metadata[key] = value.strip('"\'')
            index += 1
        if index < len(lines) and lines[index].strip() == '---':
            index += 1
    body_lines = lines[index:]
    while body_lines and not body_lines[0].strip():
        body_lines.pop(0)
    if body_lines and body_lines[0].lstrip().startswith('# '):
        body_lines.pop(0)
    while body_lines and not body_lines[0].strip():
        body_lines.pop(0)
    return tag, metadata, '\n'.join(body_lines).strip()


def _accept_note(link, identity):
    text = _remote_text(identity, link.note_path)
    if text is None:
        return False
    tag, metadata, body = _parse_markdown(text)
    if tag and tag != 'note':
        return False
    # Record the accepted remote hash first. The post-save DB→Nextcloud sync may
    # regenerate metadata timestamps; with this hash it is an authorized update,
    # not another conflict.
    link.content_hash = _hash(text)
    link.sync_state = 'synced'
    link.sync_error = ''
    link.last_synced_at = timezone.now()
    link.save(update_fields=['content_hash', 'sync_state', 'sync_error', 'last_synced_at', 'updated_at'])
    resource = link.resource
    changed = False
    if resource.body != body:
        resource.body = body
        changed = True
    remote_description = str(metadata.get('description') or '').strip()
    if remote_description and resource.description != remote_description:
        resource.description = remote_description
        changed = True
    if changed:
        resource.save(update_fields=['body', 'description', 'updated_at'])
    return True


def _accept_project(link, identity):
    text = _remote_text(identity, link.metadata_path)
    if text is None:
        return False
    tag, metadata, body = _parse_markdown(text)
    if tag and tag != 'project':
        return False
    link.content_hash = _hash(text)
    link.sync_state = 'synced'
    link.sync_error = ''
    link.last_synced_at = timezone.now()
    link.save(update_fields=['content_hash', 'sync_state', 'sync_error', 'last_synced_at', 'updated_at'])
    project = link.project
    changed = False
    if project.description != body:
        project.description = body
        changed = True
    profile = getattr(project, 'platform_profile', None)
    profile_changed = []
    if profile:
        for field in ('research_question', 'client_name', 'status', 'visibility', 'confidentiality'):
            if field not in metadata:
                continue
            value = str(metadata.get(field) or '').strip()
            model_field = profile._meta.get_field(field)
            choices = {choice[0] for choice in getattr(model_field, 'choices', [])}
            if choices and value not in choices:
                continue
            if getattr(profile, field) != value:
                setattr(profile, field, value)
                profile_changed.append(field)
        if profile_changed:
            profile.save(update_fields=profile_changed + ['updated_at'])
    if changed:
        project.save(update_fields=['description', 'updated_at'])
    return True


def _remote_note_context(user, path):
    parent_path = str(PurePosixPath(path).parent)
    parent_note = NoteSpaceLink.objects.filter(
        resource__owner=user, attachments_path=parent_path,
    ).select_related('resource').first()
    if parent_note:
        return parent_note.resource.workspace, parent_note.resource.project, None, parent_note.resource
    project_link = ProjectSpaceLink.objects.filter(
        user=user, folder_path=parent_path,
    ).select_related('project__workspace').first()
    if project_link:
        return project_link.project.workspace, project_link.project, None, None
    category = SpaceNode.objects.filter(
        owner=user, kind=SpaceNode.Kind.CATEGORY, nextcloud_path=parent_path,
    ).first()
    workspace = ensure_dual_workspaces(user)['personal']
    return workspace, None, category, None


def _import_remote_note(user, identity, item):
    path = item['path']
    text = _remote_text(identity, path)
    if text is None:
        return None
    tag, metadata, body = _parse_markdown(text)
    if tag != 'note':
        return None
    workspace, project, category, parent_note = _remote_note_context(user, path)
    title = str(metadata.get('title') or PurePosixPath(path).stem.replace('_', ' ')).strip()[:240]
    if not title:
        title = 'Untitled note'
    attachments_path = str(PurePosixPath(path).with_suffix(''))
    has_attachments = cloud.path_exists(identity, attachments_path)
    with transaction.atomic():
        resource = KnowledgeResource.objects.create(
            workspace=workspace,
            project=project,
            owner=user,
            kind=KnowledgeResource.Kind.NOTE,
            title=title,
            description='',
            body=body,
        )
        NoteSpaceLink.objects.create(
            resource=resource,
            category=category,
            parent_note=parent_note,
            note_path=path,
            attachments_path=attachments_path if has_attachments else '',
            content_hash=_hash(text),
            sync_state='synced',
            sync_error='',
            last_synced_at=timezone.now(),
        )
    return resource


@require_POST
def reconcile_space_from_nextcloud(request):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    data = _body(request)
    if not data.get('confirmed'):
        return _error('confirmation_required', 409)
    try:
        identity = ensure_user(request.user)
    except cloud.CloudError:
        return _error('cloud_unavailable', 503)

    updated, imported, skipped, errors = [], [], [], []
    for link in NoteSpaceLink.objects.filter(
        resource__owner=request.user, sync_state='conflict',
    ).select_related('resource'):
        try:
            if _accept_note(link, identity):
                updated.append(link.note_path)
            else:
                skipped.append(link.note_path)
        except Exception as exc:
            errors.append({'path': link.note_path, 'error': str(exc)[:160]})

    for link in ProjectSpaceLink.objects.filter(
        user=request.user, sync_state='conflict',
    ).select_related('project'):
        try:
            if _accept_project(link, identity):
                updated.append(link.metadata_path)
            else:
                skipped.append(link.metadata_path)
        except Exception as exc:
            errors.append({'path': link.metadata_path, 'error': str(exc)[:160]})

    # Folder sidecars are structural metadata. Accept their current hash so a
    # user-edited sidecar no longer blocks sync; structural moves/renames still
    # go through the explicit Space APIs where paths can be validated safely.
    for node in SpaceNode.objects.filter(owner=request.user, sync_state='conflict'):
        path = node.nextcloud_path + '.md'
        try:
            text = _remote_text(identity, path)
            if text is None:
                skipped.append(path)
                continue
            node.content_hash = _hash(text)
            node.sync_state = 'synced'
            node.sync_error = ''
            node.save(update_fields=['content_hash', 'sync_state', 'sync_error', 'updated_at'])
            updated.append(path)
        except Exception as exc:
            errors.append({'path': path, 'error': str(exc)[:160]})

    try:
        remote = remote_markdown_files(request.user)
        known = set(NoteSpaceLink.objects.filter(resource__owner=request.user).values_list('note_path', flat=True))
        known.update(ProjectSpaceLink.objects.filter(user=request.user).values_list('metadata_path', flat=True))
        known.update(node.nextcloud_path + '.md' for node in SpaceNode.objects.filter(owner=request.user))
        known.add('Space.md')
        for item in remote:
            if item['path'] in known or item.get('type') != 'note':
                continue
            try:
                resource = _import_remote_note(request.user, identity, item)
                if resource:
                    imported.append({'path': item['path'], 'resource_id': resource.pk, 'title': resource.title})
            except Exception as exc:
                errors.append({'path': item['path'], 'error': str(exc)[:160]})
    except cloud.CloudError as exc:
        errors.append({'path': 'Space/', 'error': str(exc)[:160]})

    return JsonResponse({
        'ok': not errors,
        'updated': updated,
        'imported': imported,
        'skipped': skipped,
        'errors': errors,
    }, status=207 if errors else 200)
