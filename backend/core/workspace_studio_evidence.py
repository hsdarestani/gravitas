from datetime import date

from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_http_methods

from .models import Workspace, WorkspaceStudioCalendarNote, WorkspaceStudioNotebookImage, WorkspaceStudioProject
from .platform_access import can_edit, can_view
from .platform_runtime_v3 import core_role
from .workspace_studio_api import _body, _projects_for_workspace, error, studio_access


def calendar_notes(workspace, user):
    rows = WorkspaceStudioCalendarNote.objects.filter(workspace=workspace).filter(
        Q(author=user) | Q(visibility='team'),
    ).order_by('-date', '-pk')[:730]
    return [{'id': str(row.pk), 'actor': str(row.author_id), 'date': row.date, 'visibility': row.visibility,
             'text': row.text, 'pinned': row.pinned, 'updatedAt': row.updated_at.isoformat()} for row in rows]


@require_http_methods(['POST', 'PATCH', 'DELETE'])
@studio_access
def studio_calendar_note(request, workspace, note_id=None):
    user = request.user
    data = _body(request) or {}
    if note_id is None and request.method == 'POST':
        row = WorkspaceStudioCalendarNote(workspace=workspace, author=user)
    elif note_id is not None and request.method in ('PATCH', 'DELETE'):
        row = WorkspaceStudioCalendarNote.objects.select_for_update().filter(
            workspace=workspace, author=user, pk=note_id,
        ).first()
        if not row:
            return error('note_not_found', 404)
        if data.get('expected_updated_at') != row.updated_at.isoformat():
            return error('note_changed_elsewhere', 409)
    else:
        return error('invalid_calendar_note', 400)
    if request.method == 'DELETE':
        row.delete()
        return JsonResponse({'ok': True})
    try:
        day = date.fromisoformat(data['date'])
    except (KeyError, TypeError, ValueError):
        return error('invalid_calendar_note', 400)
    body, visibility, pinned = data.get('text'), data.get('visibility'), data.get('pinned', False)
    if not isinstance(body, str) or not 1 <= len(body.strip()) <= 2400 or visibility not in ('team', 'personal') or type(pinned) is not bool:
        return error('invalid_calendar_note', 400)
    if pinned and (visibility != 'team' or core_role(user, workspace) not in ('admin', 'owner')):
        return error('permission_denied', 403)
    row.date, row.text, row.visibility, row.pinned = day, body.strip(), visibility, pinned
    row.save()
    return JsonResponse({'ok': True, 'id': row.pk}, status=201 if note_id is None else 200)


def _image_type(content):
    if content.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if content.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if content.startswith((b'GIF87a', b'GIF89a')):
        return 'image/gif'
    if content.startswith(b'RIFF') and content[8:12] == b'WEBP':
        return 'image/webp'
    if content[4:12] in (b'ftypavif', b'ftypavis'):
        return 'image/avif'
    return ''


@require_http_methods(['GET', 'POST'])
@studio_access
def studio_notebook_image(request, workspace, image_id=None):
    user = request.user
    if request.method == 'GET' and image_id is not None:
        row = WorkspaceStudioNotebookImage.objects.select_related('project', 'project__workspace').filter(pk=image_id).first()
        if not row:
            return error('image_not_found', 404)
        if row.project_id:
            if not _projects_for_workspace(workspace).filter(pk=row.project_id).exists() or not can_view(user, row.project):
                return error('image_not_found', 404)
            personal = row.author_id == user.pk
            report = WorkspaceStudioProject.objects.filter(project_id=row.project_id).values_list('notebook', flat=True).first() or {}
            attached = any(block['id'] == str(row.pk) and block['type'] == 'image' for block in report.get('blocks', []))
            if not (personal or attached):
                return error('image_not_found', 404)
        elif row.author_id != user.pk:
            return error('image_not_found', 404)
        response = HttpResponse(bytes(row.content), content_type=row.mime_type)
        response['X-Content-Type-Options'] = 'nosniff'
        return response
    if request.method != 'POST' or image_id is not None:
        return error('invalid_image_request', 400)
    uploaded = request.FILES.get('file')
    if not uploaded or not 0 < uploaded.size <= 12 * 1024 * 1024:
        return error('invalid_image_size', 413)
    content = uploaded.read()
    mime_type = _image_type(content)
    if not mime_type:
        return error('invalid_image_format', 400)
    project, day = None, None
    if project_id := request.POST.get('project_id'):
        if not project_id.isdecimal() or len(project_id) > 15:
            return error('invalid_project', 400)
        project = _projects_for_workspace(workspace).select_for_update(of=('self',)).filter(pk=project_id, archived=False).first()
        if not project or not can_edit(user, project) or (project.owner_id != user.pk and core_role(user, workspace) not in ('admin', 'owner')):
            return error('project_not_found', 404)
        images = WorkspaceStudioNotebookImage.objects.filter(project=project)
    else:
        try:
            day = date.fromisoformat(request.POST.get('date', ''))
        except ValueError:
            return error('invalid_notebook_date', 400)
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        images = WorkspaceStudioNotebookImage.objects.filter(author=user, project__isnull=True, date=day)
    if images.count() >= 50:
        return error('notebook_image_limit', 409)
    image = images.create(author=user, project=project, date=day, filename=uploaded.name[:180], mime_type=mime_type, content=content)
    return JsonResponse({'ok': True, 'id': str(image.pk), 'filename': image.filename}, status=201)
