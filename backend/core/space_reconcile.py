import hashlib
import json
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import PurePosixPath

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from . import cloud
from .models import KnowledgeResource
from .nextcloud_bridge import ensure_user
from .platform_access import can_manage, content_type_for, policy_for
from .platform_api import _unique_slug, ensure_dual_workspaces
from .platform_models import ObjectPolicy, ResearchProjectProfile
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


def _bool_value(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value or '').strip().lower() in {'1', 'true', 'yes', 'on'}


def _date_value(value):
    if value in (None, ''):
        return None
    try:
        return datetime.strptime(str(value)[:10], '%Y-%m-%d').date()
    except ValueError as exc:
        raise ValueError('invalid_deadline') from exc


def _datetime_value(value):
    if value in (None, ''):
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('invalid_external_access_expiry') from exc
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def _decimal_value(value):
    if value in (None, ''):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError('invalid_budget') from exc


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

    # The caller has already verified manager permission. Record this exact
    # Nextcloud version as the accepted baseline before saving DB changes; the
    # DB→Nextcloud signal can then normalize the sidecar without a false conflict.
    link.content_hash = _hash(text)
    link.sync_state = 'synced'
    link.sync_error = ''
    link.last_synced_at = timezone.now()
    link.save(update_fields=['content_hash', 'sync_state', 'sync_error', 'last_synced_at', 'updated_at'])

    project = link.project
    project_changed = False
    if project.description != body:
        project.description = body
        project_changed = True

    profile, _ = ResearchProjectProfile.objects.get_or_create(project=project)
    changed_fields = []

    # Shared project metadata may be accepted only by a manager. Filesystem
    # placement itself is intentionally not read from Markdown because it is a
    # private per-user preference stored in ProjectSpaceLink.
    choice_fields = {
        'category': ('project_type', ResearchProjectProfile.Category.values),
        'visibility': ('visibility', ResearchProjectProfile.Visibility.values),
        'status': ('status', ResearchProjectProfile.Status.values),
        'confidentiality': ('confidentiality', ResearchProjectProfile.Confidentiality.values),
    }
    for field, (metadata_key, allowed) in choice_fields.items():
        if metadata_key not in metadata:
            continue
        value = str(metadata.get(metadata_key) or '').strip()
        if value not in allowed:
            continue
        if getattr(profile, field) != value:
            setattr(profile, field, value)
            changed_fields.append(field)

    for field in ('research_question', 'client_name', 'requester_name', 'requester_email', 'compensation_text'):
        if field not in metadata:
            continue
        limit = {'client_name': 220, 'requester_name': 220, 'requester_email': 254, 'compensation_text': 240}.get(field)
        value = str(metadata.get(field) or '').strip()
        if limit:
            value = value[:limit]
        if getattr(profile, field) != value:
            setattr(profile, field, value)
            changed_fields.append(field)

    if 'deadline' in metadata:
        value = _date_value(metadata.get('deadline'))
        if profile.deadline != value:
            profile.deadline = value
            changed_fields.append('deadline')

    if 'budget' in metadata:
        value = _decimal_value(metadata.get('budget'))
        if profile.budget != value:
            profile.budget = value
            changed_fields.append('budget')

    if 'currency' in metadata:
        value = str(metadata.get('currency') or 'EUR').strip()[:8] or 'EUR'
        if profile.currency != value:
            profile.currency = value
            changed_fields.append('currency')

    if 'required_skills' in metadata:
        raw = metadata.get('required_skills')
        if isinstance(raw, list):
            value = [str(item).strip() for item in raw if str(item).strip()]
        else:
            value = [item.strip() for item in str(raw or '').split(',') if item.strip()]
        if profile.required_skills != value:
            profile.required_skills = value
            changed_fields.append('required_skills')

    for field in ('application_open', 'secure_data_room', 'allow_public_links', 'allow_downloads'):
        if field not in metadata:
            continue
        value = _bool_value(metadata.get(field))
        if getattr(profile, field) != value:
            setattr(profile, field, value)
            changed_fields.append(field)

    if 'external_access_expires_at' in metadata:
        value = _datetime_value(metadata.get('external_access_expires_at'))
        if profile.external_access_expires_at != value:
            profile.external_access_expires_at = value
            changed_fields.append('external_access_expires_at')

    if (profile.visibility in {'community', 'public'} or profile.application_open) and not profile.public_slug:
        profile.public_slug = _unique_slug(ResearchProjectProfile, project.title, field='public_slug', max_length=220)
        changed_fields.append('public_slug')

    if changed_fields:
        profile.save(update_fields=list(dict.fromkeys(changed_fields + ['updated_at'])))

    # Keep the permission model consistent with the accepted project form state.
    policy = policy_for(project, create=True, created_by=project.owner)
    desired_visibility = ObjectPolicy.Visibility.PUBLIC if profile.visibility == 'public' else ObjectPolicy.Visibility.WORKSPACE
    policy_changed = False
    if policy.visibility != desired_visibility:
        policy.visibility = desired_visibility
        policy_changed = True
    if policy.allow_download != profile.allow_downloads:
        policy.allow_download = profile.allow_downloads
        policy_changed = True
    if policy.allow_reshare != profile.allow_public_links:
        policy.allow_reshare = profile.allow_public_links
        policy_changed = True
    if policy_changed:
        policy.save(update_fields=['visibility', 'allow_download', 'allow_reshare', 'updated_at'])

    if project_changed:
        project.save(update_fields=['description', 'updated_at'])
    elif changed_fields or policy_changed:
        # Touch the project to trigger the normalized DB→Nextcloud write for all
        # personal member placements after accepting the remote metadata.
        project.save(update_fields=['updated_at'])
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
    ).select_related('project__owner'):
        if not can_manage(request.user, link.project):
            link.sync_error = 'Only a project manager can accept shared project metadata from a personal Space file.'
            link.save(update_fields=['sync_error', 'updated_at'])
            skipped.append(link.metadata_path)
            continue
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
