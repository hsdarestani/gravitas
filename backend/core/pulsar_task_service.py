import logging

from django.db import transaction
from django.utils.dateparse import parse_date

from . import operating_api as operating_base
from .layer_access import record_activity
from .layer_models import ActivityEvent
from .models import ResearchProject, WorkspaceMembership
from .operating_models import KeyResult, OperatingTask, Priority, WorkStatus
from .platform_access import can_view
from .platform_runtime_v3 import core_access, ensure_platform_workspaces
from .pulsar_runtime.policy import ActionPolicy


logger = logging.getLogger(__name__)


def _as_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _clean_links(value):
    rows = []
    if not isinstance(value, list):
        return rows
    for item in value[:12]:
        if not isinstance(item, dict):
            continue
        label = ' '.join(str(item.get('label') or 'Related link').split()).strip()[:180]
        url = str(item.get('url') or '').strip()
        if not url.startswith(('https://', 'http://')):
            continue
        rows.append({'label': label or 'Related link', 'url': url[:1800]})
    return rows


def create_operating_task(
    user,
    draft,
    *,
    confirmed=False,
    source='pulsar',
):
    """Create one Core task through the shared Pulsar policy/ACL boundary."""
    ActionPolicy().decide(user, 'tasks.create', confirmed=confirmed)
    draft = draft if isinstance(draft, dict) else {}

    spaces = ensure_platform_workspaces(user)
    core = spaces['core']
    research = spaces['research']
    if not core_access(user, core):
        raise PermissionError('core_workspace_required')

    title = ' '.join(str(draft.get('title') or '').split()).strip()[:240]
    if not title:
        raise ValueError('task_title_required')

    owner_id = _as_int(draft.get('owner_id')) or user.pk
    owner_link = (
        WorkspaceMembership.objects
        .filter(workspace=core, user_id=owner_id)
        .select_related('user')
        .first()
    )
    owner = owner_link.user if owner_link else None

    key_result_id = _as_int(draft.get('key_result_id'))
    key_result = (
        KeyResult.objects
        .filter(
            pk=key_result_id,
            objective__workspace=core,
        )
        .exclude(status=WorkStatus.ARCHIVED)
        .select_related('objective')
        .first()
    )
    due = parse_date(str(draft.get('due_date') or '').strip())
    if not owner or not key_result or not due:
        raise ValueError('task_missing_required_fields')

    project = None
    project_id = _as_int(draft.get('project_id'))
    if project_id:
        project = ResearchProject.objects.filter(
            pk=project_id,
            archived=False,
            workspace_id__in={core.pk, research.pk},
        ).first()
        if not project or not can_view(user, project):
            raise PermissionError('project_access_required')

    dependency = None
    dependency_id = _as_int(draft.get('dependency_id'))
    if dependency_id:
        dependency = (
            OperatingTask.objects
            .filter(pk=dependency_id, workspace=core)
            .exclude(status=WorkStatus.ARCHIVED)
            .first()
        )
        if not dependency or not can_view(user, dependency):
            raise PermissionError('task_dependency_access_required')

    priority = str(draft.get('priority') or Priority.P2).lower()
    if priority not in Priority.values:
        priority = Priority.P2

    definition_of_done = str(
        draft.get('definition_of_done') or ''
    ).strip()[:8000]
    if not definition_of_done:
        definition_of_done = (
            f'{title} is completed, reviewed, and the final output is available to the team.'
        )

    description = str(draft.get('description') or '').strip()
    links = _clean_links(draft.get('related_links'))
    if links:
        description += (
            ('\n\n' if description else '')
            + 'Related links:\n'
            + '\n'.join(
                f'- {row["label"]}: {row["url"]}'
                for row in links
            )
        )

    initiative = operating_base._execution_initiative_for_kr(
        core,
        key_result,
        owner,
    )

    with transaction.atomic():
        task = OperatingTask.objects.create(
            workspace=core,
            initiative=initiative,
            project=project,
            owner=owner,
            title=title,
            description=description[:12000],
            priority=priority,
            status=WorkStatus.ACTIVE,
            due_date=due,
            definition_of_done=definition_of_done,
            dependency=dependency,
        )
        record_activity(
            layer=ActivityEvent.Layer.CORE,
            action='task.created',
            actor=user,
            subject_user=user,
            object_type='operating_task',
            object_id=task.pk,
            detail={
                'title': task.title,
                'source': str(source or 'pulsar')[:80],
            },
        )
        try:
            from .task_notifications import enqueue_task_event
            enqueue_task_event(
                task,
                'task.created',
                actor=user,
                detail={'source': str(source or 'pulsar')[:80]},
            )
        except Exception:
            logger.exception(
                'Could not enqueue Pulsar task notification task_id=%s',
                task.pk,
            )

    return task
