"""Apply an explicitly reconciled task plan, never an unreviewed title import.

Project/task source keys are immutable idempotency identifiers. Existing task
state is never replaced: only missing relationships and provenance are added.
All mutations use the canonical journal and produce before/after audit data.
"""
import hashlib
import json
from copy import deepcopy
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from .canonical_journal import journal_transaction
from .canonical_projects import active, refresh_project, _pending
from .models import ResearchProject, Workspace, WorkspaceMembership, ProjectMembership
from .operating_models import OperatingTask, Initiative
from .platform_access import can_edit, can_manage, can_view, policy_for, INHERIT_VISIBILITY
from .platform_models import ResearchProjectProfile, ProjectAuditEvent, ObjectPolicy
from .workspace_api import _can_manage_workspace


TASK_FIELDS = ('title', 'description', 'status', 'priority', 'due_date', 'owner_id',
               'project_id', 'parent_id', 'dependency_id', 'initiative_id',
               'definition_of_done', 'source_key', 'source_metadata', 'updated_at')


def task_snapshot(task):
    return {key: getattr(task, key) for key in TASK_FIELDS}


def digest(plan):
    return hashlib.sha256(json.dumps(plan, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def validate(plan):
    if plan.get('schema') != 1 or not isinstance(plan.get('tasks'), list):
        raise ValueError('invalid_migration_plan')
    core = Workspace.objects.get(pk=plan['workspace_id'], platform_profile__purpose='core')
    actor = get_user_model().objects.get(pk=plan['actor_id'], is_active=True)
    if not _can_manage_workspace(actor, core):
        raise PermissionError('core_manager_required')
    research = Workspace.objects.get(organization_id=core.organization_id, platform_profile__purpose='research')
    projects = {}
    for item in plan.get('projects', []):
        if item['key'] in projects:
            raise ValueError('duplicate_project_key')
        if item.get('id'):
            project = ResearchProject.objects.get(pk=item['id'], workspace=research, archived=False)
            if not can_manage(actor, project):
                raise PermissionError('project_manage_required')
            projects[item['key']] = project
        else:
            if not item.get('title') or not item.get('description'):
                raise ValueError('project_description_required')
            marker = '<!-- gq-migration-project:' + item['key'] + ' -->'
            existing = list(ResearchProject.objects.filter(workspace=research, description__contains=marker)[:2])
            if len(existing) > 1:
                raise ValueError('duplicate_project_source')
            if existing:
                if not can_manage(actor, existing[0]):
                    raise PermissionError('project_manage_required')
                projects[item['key']] = existing[0]
            elif ResearchProject.objects.filter(workspace=research, title__iexact=item['title']).exists():
                raise ValueError('existing_project_requires_explicit_id')
            else:
                projects[item['key']] = None
        for user_id in {item['owner_id'], *item.get('editors', [])}:
            if not WorkspaceMembership.objects.filter(workspace=core, user_id=user_id, user__is_active=True).exists():
                raise ValueError('project_user_not_core_member')
    keys = set()
    for item in plan['tasks']:
        key = item['source_key']
        if not isinstance(key, str) or not key or len(key) > 240 or key in keys:
            raise ValueError('invalid_or_duplicate_source_key')
        keys.add(key)
        if item['project'] not in projects:
            raise ValueError('unknown_project_key')
        if not isinstance(item.get('source_metadata'), dict):
            raise ValueError('source_metadata_required')
        if item.get('parent_source_key') and item['parent_source_key'] not in keys:
            parent = OperatingTask.objects.filter(source_key=item['parent_source_key'], workspace=core).first()
            if parent is None or not can_view(actor, parent):
                raise ValueError('parent_must_precede_child')
        owner = item['owner_id']
        if not WorkspaceMembership.objects.filter(workspace=core, user_id=owner, user__is_active=True).exists():
            raise ValueError('task_owner_not_core_member')
        existing = OperatingTask.objects.filter(source_key=key).first()
        if item.get('task_id'):
            task = OperatingTask.objects.get(pk=item['task_id'], workspace=core)
            if existing and existing.pk != task.pk:
                raise ValueError('source_already_bound_elsewhere')
            if not can_edit(actor, task):
                raise PermissionError('task_edit_required')
            if task.source_key and task.source_key != key:
                raise ValueError('task_already_bound_elsewhere')
            # An already applied plan is a no-op, even if the task was later edited.
            if task.source_key != key and task.updated_at != parse_datetime(item.get('expected_updated_at') or ''):
                raise ValueError('stale_task:' + str(task.pk))
        elif existing:
            if existing.workspace_id != core.pk or not can_edit(actor, existing):
                raise PermissionError('source_binding_not_accessible')
        else:
            project = projects[item['project']]
            if project and OperatingTask.objects.filter(workspace=core, project=project, owner_id=owner, title__iexact=item['title']).exists():
                raise ValueError('same_title_requires_reconciliation')
            candidate = OperatingTask(workspace=core, owner_id=owner, title=item['title'],
                status=item['status'], priority=item.get('priority', 'p2'),
                definition_of_done=item['definition_of_done'], source_metadata=item['source_metadata'])
            candidate.full_clean(exclude=['parent', 'project'])
    return core, research, actor, projects


@journal_transaction
def apply_plan(plan):
    core, research, actor, projects = validate(plan)
    # Serialize all imports in this Core. Revalidate after acquiring the lock.
    Workspace.objects.select_for_update().get(pk=core.pk)
    core, research, actor, projects = validate(plan)
    result = {'schema': 1, 'run_id': plan['run_id'], 'plan_sha256': digest(plan),
              'applied_at': timezone.now(), 'created': 0, 'updated': 0, 'matched': 0,
              'projects_created': [], 'membership_additions': [], 'tasks': []}
    pending = []; token = _pending.set(pending)
    try:
        for item in plan['projects']:
            project = projects[item['key']]
            if project is None:
                project = ResearchProject.objects.create(workspace=research, owner_id=item['owner_id'],
                    title=item['title'], description=item['description'] + '\n<!-- gq-migration-project:' + item['key'] + ' -->')
                ResearchProjectProfile.objects.create(project=project, category='internal', visibility='invite',
                    status='active', nextcloud_root=f'GRV-{project.pk:06d}', confidentiality='internal')
                policy_for(project, create=True, created_by=actor, default_visibility=ObjectPolicy.Visibility.SPECIFIC)
                projects[item['key']] = project
                result['projects_created'].append(project.pk)
            if active(project):
                refresh_project(project, actor)
            for user_id in {item['owner_id'], *item.get('editors', [])}:
                role = 'owner' if user_id == project.owner_id else 'editor'
                _, created = ProjectMembership.objects.get_or_create(project=project, user_id=user_id, defaults={'role': role})
                if created:
                    result['membership_additions'].append({'project_id': project.pk, 'user_id': user_id, 'role': role})
            # Explicit per-project adoption, using the existing backup/readback/
            # ACL validation path. Never enable global adoption or bypass it.
            if not active(project) and item.get('adopt_canonical'):
                from django.test.utils import override_settings
                from .canonical_projects import adopt_project
                with override_settings(GRAVITAS_CANONICAL_ADOPTION_ENABLED=True):
                    adopt_project(project, actor)
        # Canonical refresh may have updated a projection. Check stale versions again.
        validate(plan)
        bindings = {}
        for item in plan['tasks']:
            key = item['source_key']
            task = OperatingTask.objects.select_for_update().filter(source_key=key).first()
            if task:
                bindings[key] = task
                result['matched'] += 1
                result['tasks'].append({'source_key': key, 'task_id': task.pk, 'action': 'matched', 'after': task_snapshot(task)})
                continue
            project = projects[item['project']]
            parent = bindings.get(item.get('parent_source_key'))
            if parent is None and item.get('parent_source_key'):
                parent = OperatingTask.objects.get(source_key=item['parent_source_key'], workspace=core)
            if item.get('task_id'):
                task = OperatingTask.objects.select_for_update().get(pk=item['task_id'], workspace=core)
                before = task_snapshot(task)
                # Preserve every existing title, owner, status, due date and description.
                if task.project_id and task.project_id != project.pk:
                    raise ValueError('existing_project_conflict')
                task.project = project
                if parent and task.parent_id and task.parent_id != parent.pk:
                    raise ValueError('existing_parent_conflict')
                task.parent = task.parent or parent
                action = 'updated';result['updated'] += 1
            else:
                task = OperatingTask(workspace=core, project=project, parent=parent, owner_id=item['owner_id'],
                    title=item['title'], description=item.get('description', ''), status=item['status'],
                    priority=item.get('priority', 'p2'), definition_of_done=item['definition_of_done'])
                if item.get('initiative_id'):
                    initiative = Initiative.objects.get(pk=item['initiative_id'], workspace=core)
                    # Historic activity is never turned into a due date to satisfy a constraint.
                    task.initiative = initiative;task.cycle_id = item.get('cycle_id')
                action = 'created';before = None;result['created'] += 1
            if task.owner_id != item['owner_id']:
                raise ValueError('owner_conflict')
            if not (project.owner_id == task.owner_id or ProjectMembership.objects.filter(project=project, user_id=task.owner_id).exists()):
                raise ValueError('owner_must_be_project_member')
            task.source_key = key
            task.source_metadata = deepcopy(item['source_metadata'])
            task.source_metadata['migration_run_id'] = plan['run_id']
            task.full_clean();task.save()
            policy_for(task, create=True, created_by=actor, default_visibility=INHERIT_VISIBILITY)
            ProjectAuditEvent.objects.create(project=project, actor=actor, action='source_task_migrated',
                object_type='OperatingTask', object_id=str(task.pk), detail={'run_id':plan['run_id'], 'source_key':key, 'action':action})
            bindings[key] = task
            result['tasks'].append({'source_key':key,'task_id':task.pk,'action':action,'before':before,'after':task_snapshot(task)})
        from .canonical_signals import flush_pending
        flush_pending(pending, actor)
        return result
    finally:
        _pending.reset(token)
