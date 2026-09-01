from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from . import operating_api as base
from .operating_models import (
    Initiative,
    OperatingCycle,
    OperatingMilestone,
    OperatingTask,
    OperatingWorkPackage,
    WorkStatus,
)
from .roadmap_execution import (
    ROADMAP_EXECUTION_PLANS,
    _anchor_date,
    _roadmap_state,
    _resolve_roles,
)


MONTH_LABELS = {
    1: 'Foundation & baselines',
    2: 'First validation',
    3: 'Proof & first paid project',
    4: 'Scale the strongest loops',
    5: 'Revenue & product validation',
    6: 'Six-month outcome',
}


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


def _cycle_dates(anchor, month):
    start_offset = 0 if month == 1 else (30 * (month - 1)) + 1
    return (
        anchor + timedelta(days=start_offset),
        anchor + timedelta(days=30 * month),
    )


def _automatic_cycle_status(start_date, end_date):
    today = timezone.localdate()
    if end_date < today:
        return WorkStatus.DONE
    if start_date > today:
        return WorkStatus.DRAFT
    return WorkStatus.ACTIVE


def _task_cycle(cycles, due_date):
    if not due_date:
        return cycles[1]
    for month in range(1, 7):
        cycle = cycles[month]
        if cycle.start_date <= due_date <= cycle.end_date:
            return cycle
    return cycles[1] if due_date < cycles[1].start_date else cycles[6]


def seed_workspace_roadmap_calendar(workspace):
    """Materialize the Roadmap execution calendar without duplicating user-created planning data.

    The generated layer owns only records prefixed with ``Roadmap``. Existing task links are
    filled when empty and are deliberately not overwritten after a team member changes them.
    """
    state = _roadmap_state(workspace)
    if not state:
        return {
            'cycles_created': 0,
            'cycles_updated': 0,
            'milestones_created': 0,
            'milestones_updated': 0,
            'work_packages_created': 0,
            'work_packages_updated': 0,
            'task_links_updated': 0,
        }

    base._ensure_processes(workspace)
    operations = workspace.operating_processes.filter(key='operations', active=True).first()
    if not operations:
        raise ValueError('roadmap_operations_process_missing')
    roles, _ = _resolve_roles(workspace)
    owner = roles['hossein']
    anchor = _anchor_date(workspace, state)
    stats = {
        'cycles_created': 0,
        'cycles_updated': 0,
        'milestones_created': 0,
        'milestones_updated': 0,
        'work_packages_created': 0,
        'work_packages_updated': 0,
        'task_links_updated': 0,
    }

    with transaction.atomic():
        cycles = {}
        for month in range(1, 7):
            start_date, end_date = _cycle_dates(anchor, month)
            name = f'Roadmap Month {month} · {MONTH_LABELS[month]}'
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
                    cadence=OperatingCycle.Cadence.MONTHLY,
                    owner=owner,
                    start_date=start_date,
                    end_date=end_date,
                    status=desired_status,
                )
                stats['cycles_created'] += 1
            else:
                desired = {
                    'process': operations,
                    'cadence': OperatingCycle.Cadence.MONTHLY,
                    'owner': owner,
                    'start_date': start_date,
                    'end_date': end_date,
                }
                if cycle.status in {WorkStatus.DRAFT, WorkStatus.ACTIVE}:
                    desired['status'] = desired_status
                if _save_changed(cycle, desired):
                    stats['cycles_updated'] += 1
            cycles[month] = cycle

        for source_key, spec in ROADMAP_EXECUTION_PLANS.items():
            initiative = (
                Initiative.objects.filter(
                    workspace=workspace,
                    title__startswith=f'Roadmap {source_key} ·',
                )
                .exclude(status=WorkStatus.ARCHIVED)
                .select_related('owner')
                .first()
            )
            if not initiative:
                continue

            target_month = max(1, min(6, int(spec['month'])))
            cycle = cycles[target_month]
            milestone_title = f'Roadmap {source_key} milestone · {spec["title"]}'
            milestone = (
                OperatingMilestone.objects.filter(
                    workspace=workspace,
                    initiative=initiative,
                    title=milestone_title,
                )
                .exclude(status=WorkStatus.ARCHIVED)
                .first()
            )
            milestone_due = initiative.due_date or cycle.end_date
            if milestone is None:
                milestone = OperatingMilestone.objects.create(
                    workspace=workspace,
                    initiative=initiative,
                    cycle=cycle,
                    title=milestone_title,
                    owner=initiative.owner,
                    due_date=milestone_due,
                    definition_of_done=spec['outcome'],
                    health=initiative.health,
                    status=WorkStatus.DONE if initiative.status == WorkStatus.DONE else WorkStatus.ACTIVE,
                )
                stats['milestones_created'] += 1
            else:
                if _save_changed(
                    milestone,
                    {
                        'cycle': cycle,
                        'owner': initiative.owner,
                        'due_date': milestone_due,
                        'definition_of_done': spec['outcome'],
                        'health': initiative.health,
                    },
                ):
                    stats['milestones_updated'] += 1

            work_package = None
            if source_key.startswith('O3-'):
                work_package_title = f'Roadmap {source_key} work package · {spec["title"]}'
                work_package = (
                    OperatingWorkPackage.objects.filter(
                        workspace=workspace,
                        milestone=milestone,
                        title=work_package_title,
                    )
                    .exclude(status=WorkStatus.ARCHIVED)
                    .first()
                )
                if work_package is None:
                    work_package = OperatingWorkPackage.objects.create(
                        workspace=workspace,
                        milestone=milestone,
                        title=work_package_title,
                        description=f'Commercial Roadmap execution package for {source_key}.',
                        owner=initiative.owner,
                        due_date=milestone_due,
                        definition_of_done=spec['outcome'],
                        status=WorkStatus.DONE if initiative.status == WorkStatus.DONE else WorkStatus.ACTIVE,
                    )
                    stats['work_packages_created'] += 1
                else:
                    if _save_changed(
                        work_package,
                        {
                            'owner': initiative.owner,
                            'due_date': milestone_due,
                            'description': f'Commercial Roadmap execution package for {source_key}.',
                            'definition_of_done': spec['outcome'],
                        },
                    ):
                        stats['work_packages_updated'] += 1

            for task in OperatingTask.objects.filter(
                workspace=workspace,
                initiative=initiative,
            ).exclude(status=WorkStatus.ARCHIVED):
                desired = {}
                if task.milestone_id is None:
                    desired['milestone'] = milestone
                if task.cycle_id is None:
                    desired['cycle'] = _task_cycle(cycles, task.due_date)
                if work_package is not None and task.work_package_id is None:
                    desired['work_package'] = work_package
                if desired and _save_changed(task, desired):
                    stats['task_links_updated'] += 1

    return stats
