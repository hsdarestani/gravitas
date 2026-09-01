from calendar import monthrange
from datetime import date, timedelta

from django.db import transaction
from django.utils import timezone

from . import operating_api as base
from .operating_models import (
    Initiative,
    OperatingCycle,
    OperatingMilestone,
    OperatingTask,
    OperatingWorkPackage,
    Priority,
    WorkStatus,
)
from .roadmap_execution import ROADMAP_EXECUTION_PLANS, _resolve_roles, _roadmap_state


ROADMAP_START_DATE = date(2026, 9, 12)
ROADMAP_END_DATE = date(2027, 3, 12)
ROLE_LABELS = {
    'hossein': 'Hossein',
    'ahmad': 'Ahmad',
    'kiarash': 'Kiarash',
    'sajjad': 'Sajjad',
}
ROLE_BLOCK_PREFIX = 'Roadmap intended owner is not linked to an active Core member: '
GENERATED_CYCLE_PREFIXES = (
    'Roadmap Month ',
    'Roadmap Kickoff ',
    'Roadmap Sprint ',
    'Roadmap Closeout ',
)

# One focused kickoff week, twelve two-week execution sprints, one closeout week.
# Inclusive offsets cover Sep 12, 2026 through Mar 12, 2027 exactly.
SPRINT_DEFINITIONS = [
    ('Roadmap Kickoff · Character lock & production setup', OperatingCycle.Cadence.WEEKLY, 0, 6),
    ('Roadmap Sprint 01 · Video flow & pilot', OperatingCycle.Cadence.BIWEEKLY, 7, 20),
    ('Roadmap Sprint 02 · Publish first loop', OperatingCycle.Cadence.BIWEEKLY, 21, 34),
    ('Roadmap Sprint 03 · Repeat video + Shorts', OperatingCycle.Cadence.BIWEEKLY, 35, 48),
    ('Roadmap Sprint 04 · Audience & newsletter loop', OperatingCycle.Cadence.BIWEEKLY, 49, 62),
    ('Roadmap Sprint 05 · Community validation', OperatingCycle.Cadence.BIWEEKLY, 63, 76),
    ('Roadmap Sprint 06 · Commercial offers & proposals', OperatingCycle.Cadence.BIWEEKLY, 77, 90),
    ('Roadmap Sprint 07 · First paid-project proof', OperatingCycle.Cadence.BIWEEKLY, 91, 104),
    ('Roadmap Sprint 08 · Scale winning content', OperatingCycle.Cadence.BIWEEKLY, 105, 118),
    ('Roadmap Sprint 09 · Membership beta', OperatingCycle.Cadence.BIWEEKLY, 119, 132),
    ('Roadmap Sprint 10 · Product / experiment validation', OperatingCycle.Cadence.BIWEEKLY, 133, 146),
    ('Roadmap Sprint 11 · Revenue acceleration', OperatingCycle.Cadence.BIWEEKLY, 147, 160),
    ('Roadmap Sprint 12 · Outcome push', OperatingCycle.Cadence.BIWEEKLY, 161, 174),
    ('Roadmap Closeout · Six-month review & next roadmap', OperatingCycle.Cadence.WEEKLY, 175, 181),
]

KICKOFF_TASKS = [
    {
        'role': 'kiarash',
        'title': 'Finalize the Gravitas on-screen character and visual rules',
        'due_offset': 4,
        'priority': Priority.P0,
        'definition_of_done': (
            'The recurring Gravitas character is locked with approved look, expressions, proportions, '
            'camera/scene rules and a compact character bible usable by production.'
        ),
    },
    {
        'role': 'ahmad',
        'title': 'Lock character implementation inside the reusable video scene and prompt pack',
        'due_offset': 6,
        'priority': Priority.P0,
        'definition_of_done': (
            'The approved character can be reproduced consistently inside the real video workflow with '
            'tested scene, prompt, motion and continuity settings.'
        ),
    },
    {
        'role': 'hossein',
        'title': 'Lock the video production flow from scientific brief to publish',
        'due_offset': 10,
        'priority': Priority.P0,
        'definition_of_done': (
            'One explicit flow covers brief → research → script → character/visual production → edit → '
            'scientific review → QA → publish, with owner, handoff and WIP rule at every stage.'
        ),
    },
    {
        'role': 'sajjad',
        'title': 'Lock the scientific review gate and handoff SLA for the video flow',
        'due_offset': 12,
        'priority': Priority.P1,
        'definition_of_done': (
            'Scientific review has a clear entry checklist, response time, evidence standard and escalation '
            'rule so it protects quality without stopping the publishing cadence.'
        ),
    },
]


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


def _add_months(value, months):
    month_index = (value.year * 12) + (value.month - 1) + int(months)
    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1
    day = min(value.day, monthrange(year, month)[1])
    return date(year, month, day)


def _target_due(month):
    return min(_add_months(ROADMAP_START_DATE, max(1, min(6, int(month)))), ROADMAP_END_DATE)


def _automatic_cycle_status(start_date, end_date):
    today = timezone.localdate()
    if end_date < today:
        return WorkStatus.DONE
    if start_date > today:
        return WorkStatus.DRAFT
    return WorkStatus.ACTIVE


def _activation_offset(source_key):
    if source_key == 'O1-KR1':
        return 0
    if source_key.startswith('O1-') or source_key.startswith('O4-'):
        return 14
    if source_key.startswith('O3-'):
        return 28
    if source_key.startswith('O2-'):
        return 42
    return 14


def _planned_task_due(source_key, target_due, position, total):
    if position >= total:
        return target_due
    if source_key == 'O1-KR1':
        offsets = (14, 18, 21)
        return ROADMAP_START_DATE + timedelta(days=offsets[min(position - 1, len(offsets) - 1)])

    span = max(1, (target_due - ROADMAP_START_DATE).days)
    latest_activation = max(0, span - (7 * total))
    activation = min(_activation_offset(source_key), latest_activation)
    return ROADMAP_START_DATE + timedelta(days=activation + (7 * position))


def _cycle_for_date(cycles, due_date):
    if not cycles:
        return None
    due_date = due_date or ROADMAP_START_DATE
    for cycle in cycles:
        if cycle.start_date <= due_date <= cycle.end_date:
            return cycle
    return cycles[0] if due_date < cycles[0].start_date else cycles[-1]


def _is_generated_cycle(cycle):
    return bool(cycle and cycle.name.startswith(GENERATED_CYCLE_PREFIXES))


def _roadmap_objective_ids(state):
    values = ((state.bindings or {}).get('objectives') or {}).values()
    return [int(value) for value in values if str(value).isdigit()]


def _roadmap_kr_id(state, source_key):
    try:
        return int((((state.bindings or {}).get('key_results') or {}).get(source_key)))
    except (TypeError, ValueError):
        return None


def _ensure_kickoff_tasks(workspace, initiative, roles, unresolved_roles):
    created = 0
    updated = 0
    previous = None
    for blueprint in KICKOFF_TASKS:
        role = blueprint['role']
        label = ROLE_LABELS[role]
        task = (
            OperatingTask.objects.filter(
                workspace=workspace,
                initiative=initiative,
                title=blueprint['title'],
            )
            .exclude(status=WorkStatus.ARCHIVED)
            .first()
        )
        desired = {
            'owner': roles[role],
            'description': (
                'Roadmap kickoff task for O1-KR1. '
                f'Intended team owner: {label}. Current focus: character → video flow → repeatable production.'
            ),
            'priority': blueprint['priority'],
            'due_date': ROADMAP_START_DATE + timedelta(days=blueprint['due_offset']),
            'definition_of_done': blueprint['definition_of_done'],
            'dependency': previous,
        }
        if role in unresolved_roles:
            if task is None or task.status != WorkStatus.DONE:
                desired['status'] = WorkStatus.BLOCKED
                desired['blocked_reason'] = (
                    f'{ROLE_BLOCK_PREFIX}{label}. '
                    'Add or update that person in Core Team; roadmap assignment will reconcile automatically.'
                )
        elif task is None or (task.blocked_reason or '').startswith(ROLE_BLOCK_PREFIX):
            if task is None or task.status != WorkStatus.DONE:
                desired['status'] = WorkStatus.ACTIVE
            desired['blocked_reason'] = ''

        if task is None:
            task = OperatingTask.objects.create(
                workspace=workspace,
                initiative=initiative,
                status=desired.pop('status', WorkStatus.ACTIVE),
                blocked_reason=desired.pop('blocked_reason', ''),
                **desired,
            )
            created += 1
        elif _save_changed(task, desired):
            updated += 1
        previous = task
    return previous, created, updated


def seed_workspace_agile_roadmap(workspace):
    """Converge the Roadmap to the Sep 12 start and a sprint-based execution rhythm.

    This intentionally owns only Roadmap-generated cycles, dates and links. Manual cycles or
    manual task planning links are preserved.
    """
    state = _roadmap_state(workspace)
    stats = {
        'cycles_created': 0,
        'cycles_updated': 0,
        'milestones_created': 0,
        'milestones_updated': 0,
        'work_packages_created': 0,
        'work_packages_updated': 0,
        'task_links_updated': 0,
        'schedule_updates': 0,
        'kickoff_tasks_created': 0,
        'kickoff_tasks_updated': 0,
        'legacy_cycles_archived': 0,
    }
    if not state:
        return stats

    base._ensure_processes(workspace)
    operations = workspace.operating_processes.filter(key='operations', active=True).first()
    if not operations:
        raise ValueError('roadmap_operations_process_missing')
    roles, unresolved = _resolve_roles(workspace)
    unresolved = set(unresolved)
    owner = roles['hossein']

    with transaction.atomic():
        objective_ids = _roadmap_objective_ids(state)
        for objective in workspace.strategic_objectives.filter(pk__in=objective_ids):
            if _save_changed(
                objective,
                {'start_date': ROADMAP_START_DATE, 'due_date': ROADMAP_END_DATE},
            ):
                stats['schedule_updates'] += 1

        legacy = OperatingCycle.objects.filter(
            workspace=workspace,
            name__startswith='Roadmap Month ',
        ).exclude(status=WorkStatus.ARCHIVED)
        stats['legacy_cycles_archived'] = legacy.update(status=WorkStatus.ARCHIVED)

        cycles = []
        for name, cadence, start_offset, end_offset in SPRINT_DEFINITIONS:
            start_date = ROADMAP_START_DATE + timedelta(days=start_offset)
            end_date = ROADMAP_START_DATE + timedelta(days=end_offset)
            cycle = (
                OperatingCycle.objects.filter(workspace=workspace, name=name)
                .exclude(status=WorkStatus.ARCHIVED)
                .first()
            )
            desired_status = _automatic_cycle_status(start_date, end_date)
            if cycle is None:
                cycle = OperatingCycle.objects.create(
                    workspace=workspace,
                    process=operations,
                    name=name,
                    cadence=cadence,
                    owner=owner,
                    start_date=start_date,
                    end_date=end_date,
                    status=desired_status,
                )
                stats['cycles_created'] += 1
            else:
                desired = {
                    'process': operations,
                    'cadence': cadence,
                    'owner': owner,
                    'start_date': start_date,
                    'end_date': end_date,
                }
                if cycle.status != WorkStatus.DONE:
                    desired['status'] = desired_status
                if _save_changed(cycle, desired):
                    stats['cycles_updated'] += 1
            cycles.append(cycle)

        for source_key, spec in ROADMAP_EXECUTION_PLANS.items():
            kr_id = _roadmap_kr_id(state, source_key)
            initiative = (
                Initiative.objects.filter(
                    workspace=workspace,
                    key_result_id=kr_id,
                    title__startswith=f'Roadmap {source_key} ·',
                )
                .exclude(status=WorkStatus.ARCHIVED)
                .select_related('key_result', 'owner')
                .first()
                if kr_id else None
            )
            if not initiative:
                continue

            target_due = _target_due(spec['month'])
            if _save_changed(
                initiative,
                {'start_date': ROADMAP_START_DATE, 'due_date': target_due},
            ):
                stats['schedule_updates'] += 1
            if _save_changed(initiative.key_result, {'due_date': target_due}):
                stats['schedule_updates'] += 1

            kickoff_tail = None
            if source_key == 'O1-KR1':
                kickoff_tail, created, updated = _ensure_kickoff_tasks(
                    workspace, initiative, roles, unresolved
                )
                stats['kickoff_tasks_created'] += created
                stats['kickoff_tasks_updated'] += updated

            previous = kickoff_tail
            total = len(spec['tasks'])
            for position, blueprint in enumerate(spec['tasks'], start=1):
                task = (
                    initiative.tasks.filter(title=blueprint['title'])
                    .exclude(status=WorkStatus.ARCHIVED)
                    .first()
                )
                if not task:
                    continue
                desired = {
                    'due_date': _planned_task_due(source_key, target_due, position, total),
                }
                if source_key == 'O1-KR1':
                    desired['dependency'] = previous
                if _save_changed(task, desired):
                    stats['schedule_updates'] += 1
                previous = task

            milestone_title = f'Roadmap {source_key} milestone · {spec["title"]}'
            target_cycle = _cycle_for_date(cycles, target_due)
            milestone = (
                OperatingMilestone.objects.filter(
                    workspace=workspace,
                    initiative=initiative,
                    title=milestone_title,
                )
                .exclude(status=WorkStatus.ARCHIVED)
                .first()
            )
            if milestone is None:
                milestone = OperatingMilestone.objects.create(
                    workspace=workspace,
                    initiative=initiative,
                    cycle=target_cycle,
                    title=milestone_title,
                    owner=initiative.owner,
                    due_date=target_due,
                    definition_of_done=spec['outcome'],
                    health=initiative.health,
                    status=WorkStatus.DONE if initiative.status == WorkStatus.DONE else WorkStatus.ACTIVE,
                )
                stats['milestones_created'] += 1
            elif _save_changed(
                milestone,
                {
                    'cycle': target_cycle,
                    'owner': initiative.owner,
                    'due_date': target_due,
                    'definition_of_done': spec['outcome'],
                    'health': initiative.health,
                },
            ):
                stats['milestones_updated'] += 1

            work_package = None
            if source_key.startswith('O3-'):
                wp_title = f'Roadmap {source_key} work package · {spec["title"]}'
                work_package = (
                    OperatingWorkPackage.objects.filter(
                        workspace=workspace,
                        milestone=milestone,
                        title=wp_title,
                    )
                    .exclude(status=WorkStatus.ARCHIVED)
                    .first()
                )
                if work_package is None:
                    work_package = OperatingWorkPackage.objects.create(
                        workspace=workspace,
                        milestone=milestone,
                        title=wp_title,
                        description=f'Commercial Roadmap execution package for {source_key}.',
                        owner=initiative.owner,
                        due_date=target_due,
                        definition_of_done=spec['outcome'],
                        status=WorkStatus.DONE if initiative.status == WorkStatus.DONE else WorkStatus.ACTIVE,
                    )
                    stats['work_packages_created'] += 1
                elif _save_changed(
                    work_package,
                    {
                        'owner': initiative.owner,
                        'due_date': target_due,
                        'description': f'Commercial Roadmap execution package for {source_key}.',
                        'definition_of_done': spec['outcome'],
                    },
                ):
                    stats['work_packages_updated'] += 1

            for task in OperatingTask.objects.filter(
                workspace=workspace,
                initiative=initiative,
            ).exclude(status=WorkStatus.ARCHIVED).select_related('cycle', 'milestone', 'work_package'):
                desired = {}
                if task.milestone_id is None or (
                    task.milestone and task.milestone.title.startswith(f'Roadmap {source_key} milestone ·')
                ):
                    desired['milestone'] = milestone
                if task.cycle_id is None or _is_generated_cycle(task.cycle):
                    desired['cycle'] = _cycle_for_date(cycles, task.due_date)
                if work_package is not None and (
                    task.work_package_id is None
                    or (
                        task.work_package
                        and task.work_package.title.startswith(f'Roadmap {source_key} work package ·')
                    )
                ):
                    desired['work_package'] = work_package
                if desired and _save_changed(task, desired):
                    stats['task_links_updated'] += 1

    return stats
