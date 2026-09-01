from django.db import transaction

from .operating_models import Initiative, WorkStatus
from .roadmap_calendar import seed_workspace_roadmap_calendar
from .roadmap_execution import (
    ROADMAP_EXECUTION_PLANS,
    _resolve_roles,
    seed_workspace_roadmap_execution,
)


ROLE_LABELS = {
    'hossein': 'Hossein',
    'ahmad': 'Ahmad',
    'kiarash': 'Kiarash',
    'sajjad': 'Sajjad',
}
ROLE_BLOCK_PREFIX = 'Roadmap intended owner is not linked to an active Core member: '


def _save_changed(instance, desired):
    changed = []
    for field, value in desired.items():
        if getattr(instance, field) != value:
            setattr(instance, field, value)
            changed.append(field)
    if changed:
        changed.append('updated_at')
        instance.save(update_fields=changed)
        return True
    return False


def reconcile_workspace_roadmap_assignments(workspace):
    """Seed the Roadmap plan, reconcile team ownership, then materialize its execution calendar."""
    result = seed_workspace_roadmap_execution(workspace)
    if not result.get('planned'):
        result['assignment_updates'] = 0
        result['blocked_role_tasks'] = 0
        result.update(seed_workspace_roadmap_calendar(workspace))
        return result

    roles, unresolved_roles = _resolve_roles(workspace)
    unresolved_roles = set(unresolved_roles)
    assignment_updates = 0
    blocked_role_tasks = 0

    with transaction.atomic():
        for source_key, spec in ROADMAP_EXECUTION_PLANS.items():
            initiative = (
                Initiative.objects.filter(
                    workspace=workspace,
                    title__startswith=f'Roadmap {source_key} ·',
                )
                .exclude(status=WorkStatus.ARCHIVED)
                .select_related('key_result')
                .first()
            )
            if not initiative:
                continue

            accountable_label = ROLE_LABELS[spec['owner']]
            initiative_description = spec['outcome']
            if spec['owner'] in unresolved_roles:
                initiative_description += (
                    f'\n\nIntended accountable team member: {accountable_label}. '
                    'Their active Core account is not linked yet, so the fallback Core owner is used temporarily.'
                )
            if _save_changed(
                initiative,
                {
                    'owner': roles[spec['owner']],
                    'description': initiative_description,
                },
            ):
                assignment_updates += 1

            for blueprint in spec['tasks']:
                role = blueprint['role']
                label = ROLE_LABELS[role]
                task = (
                    initiative.tasks.filter(title=blueprint['title'])
                    .exclude(status=WorkStatus.ARCHIVED)
                    .first()
                )
                if not task:
                    continue

                desired = {
                    'owner': roles[role],
                    'description': (
                        f'Roadmap execution task for {source_key}. '
                        f'Intended team owner: {label}. KR: {initiative.key_result.title}'
                    ),
                }
                if role in unresolved_roles:
                    blocked_role_tasks += 1
                    if task.status != WorkStatus.DONE:
                        desired['status'] = WorkStatus.BLOCKED
                        desired['blocked_reason'] = (
                            f'{ROLE_BLOCK_PREFIX}{label}. '
                            'Add or update that person in Core Team; roadmap assignment will reconcile automatically.'
                        )
                elif (task.blocked_reason or '').startswith(ROLE_BLOCK_PREFIX):
                    if task.status != WorkStatus.DONE:
                        desired['status'] = WorkStatus.ACTIVE
                    desired['blocked_reason'] = ''

                if _save_changed(task, desired):
                    assignment_updates += 1

    result['unresolved_roles'] = sorted(unresolved_roles)
    result['assignment_updates'] = assignment_updates
    result['blocked_role_tasks'] = blocked_role_tasks
    result.update(seed_workspace_roadmap_calendar(workspace))
    return result
