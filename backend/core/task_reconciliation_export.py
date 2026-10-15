"""Read-only, organization-scoped evidence for task reconciliation.

This is a snapshot of DB projections, not proof that canonical DAV content is
in sync. Never use it as a write/import instruction or an alternative store.
"""
from django.db.models import Q
from django.utils import timezone

from .canonical_models import CanonicalFile, CanonicalProject
from .models import KnowledgeResource, ProjectMembership, ResearchProject, Workspace, WorkspaceMembership
from .operating_models import OperatingTask, StrategicObjective


def snapshot(workspace_id=None):
    cores = Workspace.objects.filter(platform_profile__purpose='core')
    if workspace_id is not None:
        cores = cores.filter(pk=workspace_id)
    cores = list(cores.order_by('id')[:2])
    if len(cores) != 1:
        raise ValueError('Select exactly one canonical Core workspace with --workspace-id.')
    core = cores[0]
    if not core.organization_id:
        raise ValueError('Core workspace must have an organization.')
    members = WorkspaceMembership.objects.filter(workspace=core).select_related('user').order_by('user_id')
    member_ids = list(members.values_list('user_id', flat=True))
    tasks = list(OperatingTask.objects.filter(workspace=core).select_related('owner').prefetch_related(
        'checklist_items', 'board_comments__author', 'board_attachments').order_by('id'))
    linked_ids = [t.project_id for t in tasks if t.project_id]
    # Team Research projects only; never include personal or another org's projects.
    projects = ResearchProject.objects.filter(
        workspace__organization_id=core.organization_id,
        workspace__platform_profile__purpose='research',
    ).filter(Q(owner_id__in=member_ids) | Q(memberships__user_id__in=member_ids) | Q(pk__in=linked_ids)).distinct().order_by('id')
    project_ids = list(projects.values_list('id', flat=True))
    field_names = ('id', 'workspace_id', 'initiative_id', 'milestone_id', 'work_package_id',
                   'cycle_id', 'project_id', 'meeting_id', 'owner_id', 'title', 'description',
                   'priority', 'status', 'due_date', 'definition_of_done', 'dependency_id',
                   'blocked_reason', 'completed_at', 'board_order', 'created_at', 'updated_at')
    task_rows = []
    for t in tasks:
        row = {name: getattr(t, name) for name in field_names}
        row['owner_name'] = t.owner.get_full_name() or t.owner.username
        row['checklist'] = [{k: getattr(c, k) for k in ('id', 'title', 'is_completed', 'position', 'created_by_id', 'completed_at', 'created_at', 'updated_at')} for c in t.checklist_items.all()]
        row['comments'] = [{k: getattr(c, k) for k in ('id', 'author_id', 'body', 'created_at', 'updated_at')} for c in t.board_comments.all()]
        row['attachments'] = [{k: getattr(c, k) for k in ('id', 'name', 'mime_type', 'size')} for c in t.board_attachments.all()]
        task_rows.append(row)
    project_rows = []
    for p in projects:
        row = {k: getattr(p, k) for k in ('id', 'workspace_id', 'owner_id', 'title', 'description', 'archived', 'created_at', 'updated_at')}
        row['memberships'] = list(ProjectMembership.objects.filter(project=p).order_by('user_id').values('user_id', 'role'))
        row['canonical'] = CanonicalProject.objects.filter(project=p).values('enabled', 'schema_version', 'last_error', 'activated_at').first()
        project_rows.append(row)
    objectives = StrategicObjective.objects.filter(workspace=core).order_by('id')
    return {
        'schema': 1, 'generated_at': timezone.now(), 'read_only': True,
        'authority': 'Database projection snapshot; canonical DAV readback still required before writes.',
        'workspace': {'id': core.pk, 'organization_id': core.organization_id, 'name': core.name},
        'members': [{'id': m.user_id, 'username': m.user.username, 'name': m.user.get_full_name(), 'role': m.role} for m in members],
        'count': len(task_rows), 'tasks': task_rows, 'projects': project_rows,
        'objectives': [dict(id=o.pk, title=o.title, description=o.description, owner_id=o.owner_id,
            key_results=list(o.key_results.order_by('id').values()),
        ) for o in objectives],
        'initiatives': list(core.initiatives.order_by('id').values()),
        'notes': list(KnowledgeResource.objects.filter(project_id__in=project_ids, kind='note').order_by('id').values(
            'id', 'project_id', 'owner_id', 'title', 'source_url', 'updated_at')),
        'canonical_files': list(CanonicalFile.objects.filter(project_id__in=project_ids).order_by('id').values(
            'project_id', 'path', 'object_type', 'object_id', 'etag', 'file_id', 'deleted', 'updated_at')),
        'limitations': ['No live DAV reads', 'No time entries exported', 'No personal workspace content',
                        'No user credentials or personal profile data', 'Task parent/source activity fields not supported by current schema'],
    }
