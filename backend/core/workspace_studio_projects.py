"""Project lifecycle for Studio over canonical ResearchProject records."""

import re
from datetime import date

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import (
    ProjectMembership, ResearchProject, Workspace, WorkspaceMembership,
    WorkspaceStudioCanvas, WorkspaceStudioNotebook, WorkspaceStudioPreferences, WorkspaceStudioProject,
)
from .operating_models import OperatingProcess, OperatingTask, WorkStatus
from .platform_access import access_batch, can_edit, can_view, policy_for
from .platform_api import _audit, ensure_project_folder_structure
from .platform_models import ObjectPolicy, ResearchProjectProfile, WorkspaceProfile
from .platform_runtime_v3 import _canonical_workspace, core_role
from .workspace_studio_api import _body, _projects_for_workspace, error, studio_access


def _text(value, limit, required=False):
    return isinstance(value, str) and len(value) <= limit and (not required or bool(value.strip()))


def _valid_kpis(items):
    return isinstance(items, list) and len(items) <= 80 and all(
        isinstance(item, dict) and set(item) <= {'id', 'label', 'target', 'result', 'direction', 'measuredAt'}
        and _text(item.get('id'), 80, True) and re.fullmatch(r'[a-zA-Z0-9-]+', item['id'])
        and _text(item.get('label'), 90, True) and _text(item.get('target'), 140, True)
        and _text(item.get('result', ''), 160)
        and item.get('direction', '') in ('', 'min', 'max')
        and _text(item.get('measuredAt', ''), 40)
        for item in items
    ) and len({item['id'] for item in items}) == len(items)


def _project_scope(user, workspace, project):
    return project and can_view(user, project) and can_edit(user, project) and core_role(user, workspace) is not None


def _project_json(project, studio):
    return {
        'outcome': studio.outcome or ('done' if project.archived else 'active'),
        'kpis': studio.kpis, 'draft_report': studio.report or None,
        'completions': studio.completions, 'revision': studio.revision,
    }


@require_http_methods(['POST', 'PATCH'])
@studio_access
@transaction.atomic
def studio_project(request, workspace, project_id=None):
    data = _body(request) or {}
    action = data.get('action')
    user = request.user
    admin = core_role(user, workspace) in ('owner', 'admin')
    if request.method == 'POST' and project_id is None and action == 'create':
        if not admin:
            return error('permission_denied', 403)
        return _create_project(request, workspace, data)
    if request.method != 'PATCH' or project_id is None:
        return error('invalid_project_action', 400)
    project = _projects_for_workspace(workspace).select_for_update(of=('self',)).filter(pk=project_id).first()
    if not _project_scope(user, workspace, project):
        return error('project_not_found', 404)
    studio, _ = WorkspaceStudioProject.objects.get_or_create(project=project)
    if type(data.get('revision')) is not int or data['revision'] != studio.revision:
        return error('project_changed_elsewhere', 409)
    if action == 'edit':
        if project.archived or not (admin or project.owner_id == user.pk):
            return error('permission_denied', 403)
        if not _text(data.get('title'), 220, True) or not _text(data.get('description', ''), 6000):
            return error('invalid_project_fields', 400)
        if data.get('owner_id') != project.owner_id:
            return error('project_owner_change_requires_native_transfer', 400)
        project.title = data['title'].strip()
        project.description = data.get('description', '').strip()
        project.save(update_fields=('title', 'description', 'updated_at'))
    elif action == 'kpis' and not project.archived:
        if not (admin or project.owner_id == user.pk):
            return error('permission_denied', 403)
        if not _valid_kpis(data.get('kpis')):
            return error('invalid_project_kpis', 400)
        studio.kpis = data['kpis']
    elif action == 'report' and not project.archived:
        if project.owner_id != user.pk:
            return error('permission_denied', 403)
        if not _text(data.get('body'), 6000, True):
            return error('closing_report_required', 400)
        studio.report = {'author': str(user.pk), 'body': data['body'].strip(), 'updatedAt': timezone.now().isoformat()}
    elif action in ('done', 'failed', 'reopen'):
        if not (admin or project.owner_id == user.pk):
            return error('permission_denied', 403)
        if action == 'reopen':
            if not project.archived:
                return error('invalid_project_state', 409)
            studio.outcome = ''
            project.archived = False
        else:
            if project.archived:
                return error('invalid_project_state', 409)
            if action == 'done':
                if studio.report.get('author') != str(project.owner_id):
                    return error('closing_report_required', 409)
                if project.operating_tasks.filter(workflow_state='pending').exclude(status=WorkStatus.ARCHIVED).exists():
                    return error('workflow_approval_required', 409)
                report = studio.report
            else:
                if not _text(data.get('body'), 6000, True):
                    return error('closing_report_required', 400)
                report = {'author': str(user.pk), 'body': data['body'].strip(), 'updatedAt': timezone.now().isoformat()}
            studio.completions.append({
                **report, 'outcome': action, 'closedBy': str(user.pk), 'closedAt': timezone.now().isoformat(),
                'kpis': studio.kpis, 'tasksAtClose': [], 'doneCount': None, 'totalCount': None,
            })
            studio.report = {}
            studio.outcome = action
            project.archived = True
        project.save(update_fields=('archived', 'updated_at'))
    else:
        return error('invalid_project_action', 400)
    studio.revision += 1
    studio.save()
    _audit(project, user, f'studio_project_{action}', project)
    return JsonResponse({'ok': True, 'id': project.pk, 'revision': studio.revision})


def _create_project(request, workspace, data, private=False):
    user = request.user
    title, description, kpis = data.get('title'), data.get('description', ''), data.get('kpis', [])
    if not _text(title, 160 if private else 220, True) or not _text(description, 6000) or not _valid_kpis(kpis):
        return error('invalid_project_fields', 400)
    try:
        start = date.fromisoformat(data['start_date'])
    except (KeyError, TypeError, ValueError):
        return error('invalid_canvas_start_date', 400)
    owner_id, process_id = data.get('owner_id'), data.get('process_id')
    if type(owner_id) is not int or (process_id is not None and type(process_id) is not int):
        return error('invalid_project_fields', 400)
    member = WorkspaceMembership.objects.filter(workspace=workspace, user_id=owner_id, user__is_active=True).select_related('user').first()
    process = OperatingProcess.objects.filter(workspace=workspace, pk=process_id, active=True).first()
    if not member or (process_id and not process):
        return error('invalid_project_fields', 400)
    target = _canonical_workspace(WorkspaceProfile.Purpose.RESEARCH, workspace.organization)
    if not target:
        return error('research_workspace_required', 409)
    Workspace.objects.select_for_update().get(pk=workspace.pk)
    if _projects_for_workspace(workspace).filter(title__iexact=title.strip()).exists():
        return error('project_name_exists', 409)
    project = ResearchProject.objects.create(workspace=target, owner=member.user, title=title.strip(), description=description.strip())
    ProjectMembership.objects.create(project=project, user=member.user, role=ProjectMembership.Role.OWNER)
    if user.pk != member.user_id:
        ProjectMembership.objects.create(project=project, user=user, role=ProjectMembership.Role.EDITOR)
    ResearchProjectProfile.objects.create(project=project, status='active', nextcloud_root=f'GRV-{project.pk:06d}', visibility='private')
    policy_for(project, create=True, created_by=user, default_visibility=ObjectPolicy.Visibility.PRIVATE if private else ObjectPolicy.Visibility.WORKSPACE)
    ensure_project_folder_structure(project, user)
    WorkspaceStudioProject.objects.create(project=project, process=process, kpis=kpis)
    WorkspaceStudioCanvas.objects.create(project=project, canvas={'start_date': start.isoformat()})
    if data.get('template') and not _materialize_template(workspace, project, user, data['template'], data.get('duration')):
        transaction.set_rollback(True)
        return error('invalid_workflow_template', 400)
    _audit(project, user, 'studio_project_created', project)
    return JsonResponse({'ok': True, 'id': project.pk}, status=201)


@require_http_methods(['PATCH'])
@studio_access
def studio_preferences(request, workspace):
    showroom = (_body(request) or {}).get('showroom')
    if not isinstance(showroom, dict) or len(showroom) > 300 or any(
        not re.fullmatch(r'(signal|owner|area):[a-zA-Z0-9-]{1,80}', key)
        or not isinstance(value, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', value)
        for key, value in showroom.items()
    ):
        return error('invalid_showroom_preferences', 400)
    WorkspaceStudioPreferences.objects.update_or_create(user=request.user, defaults={'showroom': showroom})
    return JsonResponse({'ok': True})


def _valid_blocks(blocks, task_ids):
    if not isinstance(blocks, list) or len(blocks) > 250:
        return False
    used = set()
    for block in blocks:
        if not isinstance(block, dict):
            return False
        key, kind = block.get('id'), block.get('type')
        if not _text(key, 80, True) or not re.fullmatch(r'[a-zA-Z0-9-]+', key) or key in used:
            return False
        used.add(key)
        if kind in ('heading', 'text', 'note'):
            valid = set(block) <= {'id', 'type', 'text'} and _text(block.get('text', ''), 120 if kind == 'heading' else 6000)
        elif kind == 'task':
            valid = set(block) == {'id', 'type', 'task'} and isinstance(block['task'], str) and block['task'] in task_ids
        elif kind == 'checklist':
            items = block.get('items')
            valid = set(block) == {'id', 'type', 'items'} and isinstance(items, list) and len(items) <= 100 and all(
                isinstance(item, dict) and set(item) == {'text', 'done'} and _text(item['text'], 180) and type(item['done']) is bool
                for item in items
            )
        else:
            valid = False
        if not valid:
            return False
    return True


@require_http_methods(['PATCH'])
@studio_access
@transaction.atomic
def studio_notebook(request, workspace):
    data = _body(request) or {}
    blocks, revision, project_id = data.get('blocks'), data.get('revision'), data.get('project_id')
    if type(revision) is not int:
        return error('invalid_notebook_revision', 400)
    user = request.user
    if project_id is not None:
        if type(project_id) is not int:
            return error('invalid_project', 400)
        project = _projects_for_workspace(workspace).select_for_update(of=('self',)).filter(pk=project_id, archived=False).first()
        if not _project_scope(user, workspace, project) or (project.owner_id != user.pk and core_role(user, workspace) not in ('admin', 'owner')):
            return error('project_not_found', 404)
        entry, _ = WorkspaceStudioProject.objects.get_or_create(project=project)
        actual = entry.notebook.get('revision', 0)
    else:
        try:
            day = date.fromisoformat(data['date'])
        except (KeyError, TypeError, ValueError):
            return error('invalid_notebook_date', 400)
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        entry, _ = WorkspaceStudioNotebook.objects.get_or_create(user=user, date=day)
        actual = entry.revision
    if revision != actual:
        return error('notebook_changed_elsewhere', 409)
    tasks = list(OperatingTask.objects.filter(workspace=workspace).filter(project_id=project_id) if project_id
                 else OperatingTask.objects.filter(workspace=workspace))
    with access_batch(user, tasks):
        visible = {str(task.pk) for task in tasks if can_view(user, task) and (not task.project_id or can_view(user, task.project))}
    if not _valid_blocks(blocks, visible):
        return error('invalid_notebook_block', 400)
    if project_id:
        entry.notebook = {'blocks': blocks, 'revision': actual + 1, 'updatedAt': timezone.now().isoformat()}
        entry.save(update_fields=['notebook'])
    else:
        entry.blocks = blocks
        entry.revision += 1
        entry.save()
    return JsonResponse({'ok': True, 'revision': actual + 1})


@require_http_methods(['POST'])
@studio_access
@transaction.atomic
def studio_project_note(request, workspace, project_id):
    from .models import KnowledgeResource

    user = request.user
    project = _projects_for_workspace(workspace).filter(pk=project_id, archived=False).first()
    if not project or not can_view(user, project):
        return error('project_not_found', 404)
    from .platform_access import can_comment
    if not can_comment(user, project):
        return error('permission_denied', 403)
    data = _body(request) or {}
    body, parent_id = data.get('body'), data.get('parent_id')
    if not _text(body, 1500, True) or (parent_id is not None and type(parent_id) is not int):
        return error('invalid_note', 400)
    if parent_id:
        parent = project.resources.filter(pk=parent_id, kind=KnowledgeResource.Kind.NOTE, metadata__studio_note=True).first()
        if not parent or not can_view(user, parent):
            return error('note_not_found', 404)
    note = KnowledgeResource.objects.create(
        workspace=project.workspace, project=project, owner=user, kind=KnowledgeResource.Kind.NOTE,
        title='Project discussion · ' + body.strip().splitlines()[0][:100], body=body.strip(),
        metadata={'studio_note': True, 'studio_parent_id': parent_id},
    )
    from .platform_access import INHERIT_VISIBILITY
    policy_for(note, create=True, created_by=user, default_visibility=INHERIT_VISIBILITY)
    _audit(project, user, 'studio_project_note', note)
    return JsonResponse({'ok': True, 'id': note.pk}, status=201)


def _project_notes(user, projects):
    from collections import defaultdict
    from .models import KnowledgeResource

    notes = list(KnowledgeResource.objects.filter(
        project_id__in=projects, kind=KnowledgeResource.Kind.NOTE, metadata__studio_note=True,
    ).select_related('project', 'owner').order_by('created_at', 'pk'))
    result = defaultdict(list)
    with access_batch(user, notes):
        visible = {note.pk for note in notes if can_view(user, note)}
        for note in notes:
            if note.pk in visible:
                parent_id = note.metadata.get('studio_parent_id')
                result[note.project_id].append({
                    'id': str(note.pk), 'actor': str(note.owner_id), 'body': note.body,
                    'at': note.created_at.isoformat(), 'mentions': [],
                    'parentId': str(parent_id) if type(parent_id) is int and parent_id in visible else None,
                })
    return result


@require_http_methods(['PATCH'])
@studio_access
@transaction.atomic
def studio_result(request, workspace, result_id):
    from decimal import Decimal, InvalidOperation
    from .models import WorkspaceStudioCheckIn, WorkspaceStudioResultLink
    from .operating_models import KeyResult, OperatingMilestone

    result = KeyResult.objects.select_for_update().filter(pk=result_id, objective__workspace=workspace).first()
    if not result:
        return error('key_result_not_found', 404)
    user = request.user
    admin = core_role(user, workspace) in ('owner', 'admin')
    if not (admin or user.pk in (result.owner_id, result.objective.owner_id)):
        return error('permission_denied', 403)
    data = _body(request) or {}
    action = data.get('action')
    if action == 'check_in':
        text = data.get('note', '')
        if not _text(text, 1600):
            return error('invalid_check_in', 400)
        try:
            value = Decimal(str(data.get('value')))
            baseline = None if data.get('baseline') is None else Decimal(str(data['baseline']))
            if any(not number.is_finite() or not 0 <= number < 10**12 or number.as_tuple().exponent < -4
                   for number in (value, baseline) if number is not None):
                raise InvalidOperation
        except (InvalidOperation, ValueError):
            return error('invalid_check_in', 400)
        result.current_value = value
        result.baseline_value = baseline
        result.save(update_fields=('current_value', 'baseline_value', 'updated_at'))
        WorkspaceStudioCheckIn.objects.create(result=result, actor=user, value=value, note=text.strip())
    elif action in ('link', 'unlink'):
        project_id, milestone_id = data.get('project_id'), data.get('milestone_id')
        if type(project_id) is not int or (milestone_id is not None and type(milestone_id) is not int):
            return error('invalid_link', 400)
        project = _projects_for_workspace(workspace).filter(pk=project_id).first()
        if not project or not can_view(user, project):
            return error('project_not_found', 404)
        if milestone_id and not OperatingMilestone.objects.filter(workspace=workspace, project=project, pk=milestone_id).exists():
            return error('milestone_not_found', 404)
        fields = {'result':result, 'project':project, 'milestone_id':milestone_id}
        if action == 'link':
            WorkspaceStudioResultLink.objects.get_or_create(**fields)
        else:
            WorkspaceStudioResultLink.objects.filter(**fields).delete()
    else:
        return error('invalid_result_action', 400)
    return JsonResponse({'ok': True})


@require_http_methods(['POST', 'PATCH'])
@studio_access
@transaction.atomic
def studio_idea(request, workspace, idea_id=None):
    import json
    from .models import WorkspaceStudioIdea

    data = _body(request) or {}
    action = data.get('action')
    user = request.user
    admin = core_role(user, workspace) in ('owner', 'admin')
    if idea_id is None and request.method == 'POST' and action == 'create':
        response = _create_project(request, workspace, {
            'title': data.get('title'), 'description': data.get('body', ''), 'owner_id': user.pk,
            'start_date': timezone.localdate().isoformat(),
        }, private=True)
        if response.status_code != 201:
            return response
        project_id = json.loads(response.content)['id']
        entry = WorkspaceStudioIdea.objects.create(
            workspace=workspace, author=user, title=data['title'].strip(), body=data.get('body', '').strip(), project_id=project_id,
        )
        return JsonResponse({'ok': True, 'id': entry.pk, 'project_id': project_id}, status=201)
    if request.method != 'PATCH' or idea_id is None:
        return error('invalid_idea_action', 400)
    entry = WorkspaceStudioIdea.objects.select_for_update(of=('self',)).select_related('project', 'process').filter(
        workspace=workspace, pk=idea_id,
    ).first()
    if not entry or not entry.project_id or not can_view(user, entry.project):
        return error('idea_not_found', 404)
    Workspace.objects.select_for_update().get(pk=workspace.pk)
    project = ResearchProject.objects.select_for_update().get(pk=entry.project_id)
    if action == 'note':
        from .platform_access import can_comment
        if not can_comment(user, project) or not _text(data.get('body'), 1600, True) or len(entry.notes) >= 300:
            return error('invalid_idea_note', 400)
        entry.notes.append({'author':str(user.pk), 'body':data['body'].strip(), 'at':timezone.now().isoformat()})
    elif action == 'edit' and not entry.promoted_at and not project.archived:
        if not (admin or entry.author_id == user.pk):
            return error('permission_denied', 403)
        if not _text(data.get('title'), 160, True) or not _text(data.get('body', ''), 6000):
            return error('invalid_idea_fields', 400)
        entry.title, entry.body = data['title'].strip(), data.get('body', '').strip()
        project.title, project.description = entry.title, entry.body
        project.save(update_fields=['title', 'description', 'updated_at'])
    elif action == 'refer' and not entry.referred_at and not project.archived:
        if not (admin or entry.author_id == user.pk):
            return error('permission_denied', 403)
        process_id = data.get('process_id')
        process = OperatingProcess.objects.filter(workspace=workspace, active=True, pk=process_id).first() if type(process_id) is int else None
        if not process or not process.owner_id or not WorkspaceMembership.objects.filter(workspace=workspace, user_id=process.owner_id).exists():
            return error('invalid_idea_destination', 400)
        ProjectMembership.objects.get_or_create(project=project, user_id=process.owner_id, defaults={'role':ProjectMembership.Role.EDITOR})
        entry.process, entry.referred_at = process, timezone.now()
    elif action == 'promote' and entry.referred_at and not entry.promoted_at and not project.archived:
        if not entry.process or not entry.process.owner_id or not (admin or user.pk == entry.process.owner_id) or not can_edit(user, project):
            return error('permission_denied', 403)
        if not _text(data.get('title'), 160, True):
            return error('invalid_project_fields', 400)
        title = data['title'].strip()
        if _projects_for_workspace(workspace).filter(title__iexact=title).exclude(pk=project.pk).exists():
            return error('project_name_exists', 409)
        lead = entry.process.owner_id
        if project.owner_id != lead:
            prior = ProjectMembership.objects.filter(project=project, user_id=project.owner_id, role=ProjectMembership.Role.OWNER).first()
            if prior:
                prior.role = ProjectMembership.Role.EDITOR
                prior.save(update_fields=['role'])
            ProjectMembership.objects.update_or_create(project=project, user_id=lead, defaults={'role':ProjectMembership.Role.OWNER})
        project.title, project.owner_id = title, lead
        project.save(update_fields=['title', 'owner', 'updated_at'])
        studio, _ = WorkspaceStudioProject.objects.get_or_create(project=project)
        studio.process = entry.process
        studio.revision += 1
        studio.save(update_fields=['process', 'revision'])
        entry.promoted_at = timezone.now()
    elif action == 'promote' and entry.promoted_at:
        return JsonResponse({'ok': True, 'id': entry.pk, 'project_id': entry.project_id})
    else:
        return error('invalid_idea_action', 400)
    entry.save()
    _audit(project, user, f'studio_idea_{action}', project)
    return JsonResponse({'ok': True, 'id': entry.pk, 'project_id': entry.project_id})


@require_http_methods(['POST'])
@studio_access
@transaction.atomic
def studio_review(request, workspace, project_id):
    from .workspace_studio_api import _predecessors
    from .studio_canvas import incomplete_project_handoff
    from .task_board_api import _log

    user = request.user
    data = _body(request) or {}
    if not _text(data.get('findings'), 1500, True):
        return error('review_findings_required', 400)
    project = _projects_for_workspace(workspace).filter(pk=project_id, archived=False).first()
    if not project or not can_view(user, project):
        return error('project_not_found', 404)
    rows = list(OperatingTask.objects.filter(workspace=workspace, project=project)
                .order_by('pk').select_for_update())
    Workspace.objects.select_for_update().get(pk=workspace.pk)
    layout = WorkspaceStudioCanvas.objects.select_for_update().filter(project=project).first()
    loop = next((entry for entry in layout.canvas.get('loops', []) if entry['id']==data.get('id')), None) if layout else None
    if not loop or type(data.get('revision')) is not int or data['revision'] != layout.revision:
        return error('canvas_changed_elsewhere', 409)
    by_id = {str(task.pk):task for task in rows}
    review = by_id.get(loop['from'])
    if not review or not can_edit(user, review) or review.status != WorkStatus.ACTIVE or loop['count'] >= loop['target']:
        return error('review_pass_unavailable', 409)
    parents = _predecessors(workspace, rows)
    if (any(status != WorkStatus.DONE for status in parents[review.pk].values())
            or incomplete_project_handoff(review) or review.checklist_items.filter(is_completed=False).exists()):
        return error('review_task_not_ready', 409)

    def walk(start, edges):
        pending, visited = [start], set()
        while pending:
            identity = pending.pop()
            if identity not in visited:
                visited.add(identity)
                pending.extend(edges.get(identity, []))
        return visited

    inward = {str(task_pk): [str(key) for key in parents[task_pk] if str(key) in by_id] for task_pk in parents}
    outward = {}
    for target, sources in inward.items():
        for source in sources:
            outward.setdefault(source, []).append(target)
    sequence = walk(loop['from'], inward) & walk(loop['to'], outward)
    if not sequence or any(
        not can_view(user, by_id[key]) or not can_edit(user, by_id[key])
        or by_id[key].workflow_state or by_id[key].workflow_position is not None
        or not by_id[key].studio_duration_days or by_id[key].status == WorkStatus.ARCHIVED for key in sequence
    ):
        return error('review_path_unavailable', 409)
    for key in sequence:
        item = by_id[key]
        item.status = WorkStatus.ACTIVE if key == loop['to'] else WorkStatus.READY
        item.completed_at = None
        item.save(update_fields=['status','completed_at','updated_at'])
        item.checklist_items.update(is_completed=False, completed_at=None)
        _log(request,item,'studio_review_returned',{'review_task_id':review.pk})
    loop['count'] += 1
    layout.revision += 1
    layout.save(update_fields=['canvas','revision'])
    review.board_comments.create(author=user, body=f"Pass {loop['count']}/{loop['target']}\n{data['findings'].strip()}")
    return JsonResponse({'ok': True, 'task_id': int(loop['to'])})


@require_http_methods(['PATCH'])
@studio_access
@transaction.atomic
def studio_profile(request, workspace, user_id=None):
    from django.contrib.auth import get_user_model

    actor = request.user
    role = core_role(actor, workspace)
    data = _body(request) or {}
    if user_id is None:
        target = actor
        allowed = {'name','pronouns','gender','color','photo'}
    else:
        if role not in ('owner', 'admin'):
            return error('permission_denied', 403)
        membership = WorkspaceMembership.objects.select_for_update().filter(workspace=workspace, user_id=user_id).select_related('user').first()
        if not membership:
            return error('member_not_found', 404)
        target = membership.user
        allowed = {'name','handle','roleTitle','color','role'}
        access = data.get('role')
        if access not in (None, 'admin', 'member'):
            return error('invalid_member_role', 400)
        if access and membership.role != access:
            if role != 'owner' or membership.role == 'owner' or target.pk == actor.pk:
                return error('permission_denied', 403)
            membership.role = access
            membership.save(update_fields=['role'])
    if set(data) - allowed:
        transaction.set_rollback(True)
        return error('invalid_profile', 400)
    lengths = {'name':80,'pronouns':40,'gender':60,'roleTitle':120,'handle':60}
    for key, limit in lengths.items():
        if key in data and not _text(data[key], limit, key in ('name','handle')):
            transaction.set_rollback(True)
            return error('invalid_profile', 400)
    if ('color' in data and (not isinstance(data['color'],str) or not re.fullmatch(r'#[a-fA-F0-9]{6}',data['color']))
            or ('handle' in data and not re.fullmatch(r'[a-z0-9-]+',data['handle']))):
        transaction.set_rollback(True)
        return error('invalid_profile', 400)
    if 'photo' in data and data['photo'] not in (None, ''):
        from base64 import b64decode
        from binascii import Error
        value = data['photo']
        if not _text(value, 256000) or not re.fullmatch(r'data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+',value):
            return error('invalid_profile_photo', 400)
        try:
            b64decode(value.split(',',1)[1], validate=True)
        except Error:
            return error('invalid_profile_photo', 400)
    get_user_model().objects.select_for_update().get(pk=target.pk)
    preferences, _ = WorkspaceStudioPreferences.objects.get_or_create(user=target)
    preferences.profile = {**preferences.profile, **{key:value for key,value in data.items() if key!='role'}}
    preferences.save(update_fields=['profile'])
    return JsonResponse({'ok': True})


@require_http_methods(['POST'])
@studio_access
@transaction.atomic
def studio_template(request, workspace):
    from .models import WorkspaceStudioTemplate
    from .workspace_studio_api import _predecessors

    data = _body(request) or {}
    user = request.user
    if not _text(data.get('name'), 120, True) or not _text(data.get('description', ''), 1600):
        return error('invalid_workflow_template', 400)
    project_id = data.get('project_id')
    if type(project_id) is not int:
        return error('invalid_project', 400)
    project = _projects_for_workspace(workspace).filter(pk=project_id, archived=False).first()
    if not _project_scope(user, workspace, project):
        return error('project_not_found', 404)
    candidates = list(OperatingTask.objects.filter(workspace=workspace,project=project).exclude(
        status=WorkStatus.ARCHIVED).select_related('project','workspace').order_by('board_order','pk'))
    with access_batch(user, candidates):
        rows = [task for task in candidates if can_view(user, task)]
    if not 1 <= len(rows) <= 120:
        return error('invalid_workflow_template_size', 400)
    ids = {str(task.pk) for task in rows}
    predecessors = _predecessors(workspace, rows)
    canvas = getattr(project, 'studio_layout', None)
    canvas = canvas.canvas if canvas else {}
    positions = canvas.get('positions', {})
    snapshot = {
        'tasks': [{'id':str(task.pk),'title':task.title,'description':task.description,'icon':'circle',
                   'durationDays':task.studio_duration_days,'dod':[task.definition_of_done],
                   'checklist':list(task.checklist_items.values_list('title',flat=True)),
                   'importance':5,'idea':task.status==WorkStatus.DRAFT,
                   **positions.get(str(task.pk),{'x':100,'y':100})} for task in rows],
        'edges': [[str(source),str(target)] for target,sources in predecessors.items()
                  for source in sources if str(source) in ids],
        'groups': [group for group in canvas.get('groups',[]) if set(group['members']) <= ids],
        'frames': canvas.get('frames',[]),
        'layoutArrows': [],
        'loops': [{**loop,'count':0} for loop in canvas.get('loops',[]) if {loop['from'],loop['to']} <= ids],
    }
    template, created = WorkspaceStudioTemplate.objects.get_or_create(
        workspace=workspace, author=user, name=data['name'].strip(),
        defaults={'description':data.get('description','').strip(),'snapshot':snapshot},
    )
    if not created:
        return error('template_name_exists', 409)
    return JsonResponse({'ok':True,'id':f'saved-{template.pk}'}, status=201)


def _materialize_template(workspace, project, author, template, duration):
    from .operating_models import OperatingTaskPredecessor
    import re

    if type(duration) is not int or not 1 <= duration <= 3650:
        return False
    if not isinstance(template, str):
        return False
    saved = re.fullmatch(r'saved-(\d+)',template)
    if saved:
        from .models import WorkspaceStudioTemplate
        stored = WorkspaceStudioTemplate.objects.filter(pk=saved[1],workspace=workspace,author=author).first()
        if not stored:
            return False
        snapshot = stored.snapshot
    else:
        from .task_workflows import TEMPLATES
        definition = TEMPLATES.get(template)
        if not definition or not definition['steps']:
            return False
        steps = definition['steps']
        snapshot = {'tasks':[{'id':str(i),'title':step,'dod':[step]} for i,step in enumerate(steps)],
                    'edges':[[str(i),str(i+1)] for i in range(len(steps)-1)],'frames':[],'groups':[],'loops':[]}
    by_id = {}
    for item in snapshot['tasks']:
        task = OperatingTask.objects.create(
            workspace=workspace, project=project, owner_id=project.owner_id, title=item['title'],
            description=item.get('description',''), definition_of_done='\n'.join(item.get('dod',[])),
            status=WorkStatus.DRAFT if item.get('idea') else WorkStatus.READY, studio_duration_days=item.get('durationDays') or duration,
        )
        by_id[item['id']] = task
        for position, title in enumerate(item.get('checklist',[]), start=1):
            task.checklist_items.create(title=title,position=position,created_by=author)
    for source,target in snapshot['edges']:
        OperatingTaskPredecessor.objects.create(task=by_id[target],predecessor=by_id[source])
    canvas = project.studio_layout
    canvas.canvas.update({
        'positions': {str(by_id[item['id']].pk):{'x':item['x'],'y':item['y']} for item in snapshot['tasks'] if 'x' in item},
        'frames':snapshot['frames'],
        'groups':[{**group,'members':[str(by_id[member].pk) for member in group['members']]} for group in snapshot['groups']],
        'loops':[{**loop,'from':str(by_id[loop['from']].pk),'to':str(by_id[loop['to']].pk)} for loop in snapshot['loops']],
    })
    canvas.save(update_fields=['canvas'])
    return True


def meeting_records(workspace, project_ids, task_ids, idea_ids):
    from .models import WorkspaceStudioMeetingSeries
    from .operating_models import OperatingMeeting

    def references(refs):
        allowed = {'task':task_ids, 'workflow':project_ids, 'idea':idea_ids}
        return [ref for ref in refs if int(ref.split(':')[1]) in allowed.get(ref.split(':')[0], ())]

    meetings = OperatingMeeting.objects.filter(workspace=workspace).select_related('studio_details')
    result = []
    for meeting in meetings:
        details = getattr(meeting, 'studio_details', None)
        studio_key = (f'weekly:{details.series_id}:{details.slot.isoformat()}'
                      if details and details.series_id and details.slot else str(meeting.pk))
        result.append({
            'id':studio_key, 'real_id':meeting.pk, 'title':meeting.title, 'scheduled_for':meeting.scheduled_for,
            'duration_minutes':meeting.duration_minutes, 'owner':{'id':meeting.owner_id},
            'notes':meeting.notes, 'status':meeting.status, 'seriesId':str(details.series_id) if details and details.series_id else '',
            'agenda':details.agenda if details else [], 'refs':references(details.references) if details else [],
            'followups':references(details.followups) if details else [], 'pinnedNote':bool(details and details.pinned),
        })
    series = [
        {'id':str(row.pk),'firstId':f'weekly:{row.pk}:{row.start.isoformat()}','start':row.start.isoformat(),
         'endDate':row.end.isoformat() if row.end else '', **row.defaults,
         'refs':references(row.defaults.get('refs', []))}
        for row in WorkspaceStudioMeetingSeries.objects.filter(first__workspace=workspace)
    ]
    return result, series


@require_http_methods(['PATCH'])
@studio_access
@transaction.atomic
def studio_meeting_series(request, workspace, series_id):
    from .models import WorkspaceStudioMeetingSeries

    series = WorkspaceStudioMeetingSeries.objects.select_for_update().filter(pk=series_id,first__workspace=workspace).first()
    if not series:
        return error('series_not_found', 404)
    if int(series.defaults['owner']) != request.user.pk and core_role(request.user, workspace) not in ('admin','owner'):
        return error('permission_denied',403)
    raw = (_body(request) or {}).get('end_date')
    try:
        end = date.fromisoformat(raw) if raw else None
    except (ValueError, TypeError):
        return error('invalid_series_end',400)
    if end and end < series.start:
        return error('invalid_series_end',400)
    series.end=end
    series.save(update_fields=['end'])
    return JsonResponse({'ok':True})


def studio_meeting_record(workspace, key):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from .models import WorkspaceStudioMeetingDetails, WorkspaceStudioMeetingSeries
    from .operating_models import OperatingMeeting

    if str(key).isdecimal():
        return OperatingMeeting.objects.select_for_update().filter(workspace=workspace,pk=key).first()
    match = re.fullmatch(r'weekly:(\d+):(\d{4}-\d{2}-\d{2})',str(key))
    if not match:
        return None
    try:
        slot = date.fromisoformat(match[2])
    except ValueError:
        return None
    series = WorkspaceStudioMeetingSeries.objects.select_for_update().filter(pk=match[1],first__workspace=workspace).first()
    if not series:
        return None
    entry = WorkspaceStudioMeetingDetails.objects.filter(series=series,slot=slot).select_related('meeting').first()
    if entry:
        return entry.meeting
    if slot < series.start or (slot-series.start).days % 7 or (series.end and slot > series.end):
        return None
    defaults = series.defaults
    moment = datetime.fromisoformat(f"{slot.isoformat()}T{defaults['time']}").replace(tzinfo=ZoneInfo('Asia/Tehran'))
    meeting = OperatingMeeting.objects.create(
        workspace=workspace, owner_id=int(defaults['owner']), title=defaults['title'],
        scheduled_for=moment, duration_minutes=defaults['duration'], kind=OperatingMeeting.Kind.WEEKLY,
    )
    WorkspaceStudioMeetingDetails.objects.create(
        meeting=meeting, series=series, slot=slot, agenda=[{'text':text,'done':False} for text in defaults['agenda']],
        references=defaults['refs'],
    )
    return meeting


def meeting_visible_reference(workspace, user, ref):
    from .models import WorkspaceStudioIdea

    match = re.fullmatch(r'(task|workflow|idea):(\d+)',ref) if isinstance(ref,str) else None
    if not match:
        return False
    kind, identity = match.groups()
    if kind == 'task':
        item = OperatingTask.objects.filter(workspace=workspace,pk=identity).first()
        return bool(item and can_view(user,item) and (not item.project_id or can_view(user,item.project)))
    if kind == 'idea':
        idea = WorkspaceStudioIdea.objects.filter(workspace=workspace,pk=identity).select_related('project').first()
        return bool(idea and idea.project and can_view(user,idea.project))
    project = _projects_for_workspace(workspace).filter(pk=identity).first()
    return bool(project and can_view(user,project))
