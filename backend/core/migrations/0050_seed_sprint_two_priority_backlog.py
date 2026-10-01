from datetime import date

from django.db import migrations


BACKLOG_MARKER = 'sprint02-priority-backlog-20261001'
SPRINT_END = date(2026, 10, 19)


TASKS = [
    {
        'title': 'Document the End-to-End Video Production Workflow in a Real Research Project',
        'owner': 'hossein',
        'kr': 'O4-KR7',
        'priority': 'p0',
        'done': (
            'A real Research Project documents the complete video production workflow from idea and research '
            'through script, design, production, scientific review, edit, QA and publish, including owners, '
            'inputs, outputs, handoffs, tools, reusable artifacts and the main process gaps discovered from '
            'actual production work.'
        ),
    },
    {
        'title': 'Kick Off Video #2 Production and Move It into Active Production',
        'owner': 'ahmad',
        'kr': 'O1-KR1',
        'priority': 'p0',
        'done': (
            'Video #2 has an agreed production plan and timeline, the required research/script/assets have been '
            'handed into production, responsibilities are clear, and the first production work has started with '
            'the next concrete handoff recorded.'
        ),
    },
    {
        'title': 'Redesign the LMS Workspace UX and Visual System for Production Readiness',
        'owner': 'kiarash',
        'kr': 'O2-KR3',
        'priority': 'p1',
        'done': (
            'The main LMS flows are redesigned for clear real-world use on desktop and mobile, including course '
            'overview, lesson consumption, learner interactions, progress/task surfaces and Pulsar access; the '
            'result is consistent with the Gravitas design system and ready for implementation/review.'
        ),
    },
    {
        'title': 'Finalize the Public Website UX Flow Based on the Ahmad Review',
        'owner': 'kiarash',
        'kr': 'O4-KR1',
        'priority': 'p1',
        'done': (
            'The public website UX flow is updated from the Ahmad review, with key audience journeys, content '
            'hierarchy, major entry points, CTAs and destination paths resolved in a review-ready flow that can '
            'guide the next website design/implementation pass.'
        ),
    },
    {
        'title': 'Make the Research Workspace Ready for Real Team Use',
        'owner': 'hossein',
        'kr': 'O4-KR8',
        'priority': 'p1',
        'done': (
            'A real research workflow can be completed end-to-end in Research Workspace without a critical '
            'blocker; the essential project, source/evidence, notes/files, task and collaboration flows are usable, '
            'critical issues are resolved or have an owner, and remaining non-blocking improvements are documented.'
        ),
    },
]


OWNER_ALIASES = {
    'hossein': ('hossein', 'hosein', 'حسین', 'darestani'),
    'ahmad': ('ahmad', 'ahmed', 'احمد'),
    'kiarash': ('kiarash', 'کیارش'),
}


PROCESS_BY_KR = {
    'O1-KR1': ('content', 'Media & Content'),
    'O2-KR3': ('operations', 'Operations / Management'),
    'O4-KR1': ('operations', 'Operations / Management'),
    'O4-KR7': ('operations', 'Operations / Management'),
    'O4-KR8': ('operations', 'Operations / Management'),
}


def _member_text(membership):
    user = membership.user
    return ' '.join(filter(None, [
        getattr(user, 'first_name', ''),
        getattr(user, 'last_name', ''),
        getattr(user, 'username', ''),
        getattr(user, 'email', ''),
    ])).lower()


def add_priority_backlog(apps, schema_editor):
    db_alias = schema_editor.connection.alias
    RoadmapOKRSyncState = apps.get_model('core', 'RoadmapOKRSyncState')
    WorkspaceMembership = apps.get_model('core', 'WorkspaceMembership')
    KeyResult = apps.get_model('core', 'KeyResult')
    OperatingProcess = apps.get_model('core', 'OperatingProcess')
    Initiative = apps.get_model('core', 'Initiative')
    OperatingTask = apps.get_model('core', 'OperatingTask')

    required_krs = {task['kr'] for task in TASKS}
    state = None
    bindings = None
    for candidate in RoadmapOKRSyncState.objects.using(db_alias).all().order_by('id'):
        candidate_bindings = (candidate.bindings or {}).get('key_results') or {}
        if required_krs.issubset(set(candidate_bindings.keys())):
            state = candidate
            bindings = candidate_bindings
            break

    if state is None:
        # Fresh/test databases may not have a live Roadmap sync state. This
        # release seed is production data, so absence of a fully bound roadmap
        # should not make schema migration impossible.
        print('Sprint 02 backlog seed skipped: no fully bound roadmap workspace found.')
        return

    workspace = state.workspace
    memberships = list(
        WorkspaceMembership.objects.using(db_alias)
        .filter(workspace_id=workspace.pk, user__is_active=True)
        .select_related('user')
        .order_by('id')
    )

    owners = {}
    for owner_key, aliases in OWNER_ALIASES.items():
        owner = next(
            (
                membership.user
                for membership in memberships
                if any(alias.lower() in _member_text(membership) for alias in aliases)
            ),
            None,
        )
        if owner is None:
            raise RuntimeError(f'Sprint 02 backlog: required owner "{owner_key}" was not found.')
        owners[owner_key] = owner

    krs = {}
    for kr_code in required_krs:
        try:
            kr_id = int(bindings[kr_code])
        except (TypeError, ValueError, KeyError):
            raise RuntimeError(f'Sprint 02 backlog: invalid binding for {kr_code}.')
        kr = (
            KeyResult.objects.using(db_alias)
            .filter(pk=kr_id, objective__workspace_id=workspace.pk)
            .first()
        )
        if kr is None:
            raise RuntimeError(f'Sprint 02 backlog: bound KR {kr_code} was not found.')
        krs[kr_code] = kr

    processes = {}
    for kr_code, (process_key, process_name) in PROCESS_BY_KR.items():
        process, _ = OperatingProcess.objects.using(db_alias).get_or_create(
            workspace_id=workspace.pk,
            key=process_key,
            defaults={
                'name': process_name,
                'flow': [],
                'cadence': [],
                'kpis': [],
                'active': True,
            },
        )
        processes[kr_code] = process

    initiatives = {}
    for kr_code in required_krs:
        kr = krs[kr_code]
        initiative = (
            Initiative.objects.using(db_alias)
            .filter(workspace_id=workspace.pk, key_result_id=kr.pk)
            .exclude(status='archived')
            .order_by('id')
            .first()
        )
        if initiative is None:
            initiative = Initiative.objects.using(db_alias).create(
                workspace_id=workspace.pk,
                key_result_id=kr.pk,
                process_id=processes[kr_code].pk,
                title=f'Sprint 02 planning · {kr_code}',
                description=f'[{BACKLOG_MARKER}] Upcoming sprint backlog aligned to {kr_code}.',
                owner_id=kr.owner_id,
                priority='p1',
                stage='',
                health='green',
                status='active',
                start_date=date(2026, 10, 6),
                due_date=SPRINT_END,
            )
        initiatives[kr_code] = initiative

    for rank, task_spec in enumerate(TASKS, start=1):
        marker = f'[{BACKLOG_MARKER}] Priority {rank}/5 · Roadmap alignment: {task_spec["kr"]}.'
        task = (
            OperatingTask.objects.using(db_alias)
            .filter(workspace_id=workspace.pk, description__startswith=f'[{BACKLOG_MARKER}]')
            .filter(title=task_spec['title'])
            .order_by('id')
            .first()
        )
        values = {
            'initiative_id': initiatives[task_spec['kr']].pk,
            'owner_id': owners[task_spec['owner']].pk,
            'description': marker,
            'priority': task_spec['priority'],
            'status': 'draft',
            'due_date': SPRINT_END,
            'definition_of_done': task_spec['done'],
            'dependency_id': None,
            'blocked_reason': '',
            'completed_at': None,
            'board_order': rank * 10,
        }
        if task is None:
            OperatingTask.objects.using(db_alias).create(
                workspace_id=workspace.pk,
                title=task_spec['title'],
                **values,
            )
        else:
            for field, value in values.items():
                setattr(task, field, value)
            task.save(using=db_alias)


def remove_priority_backlog(apps, schema_editor):
    db_alias = schema_editor.connection.alias
    Initiative = apps.get_model('core', 'Initiative')
    OperatingTask = apps.get_model('core', 'OperatingTask')

    OperatingTask.objects.using(db_alias).filter(
        description__startswith=f'[{BACKLOG_MARKER}]'
    ).delete()
    Initiative.objects.using(db_alias).filter(
        description__startswith=f'[{BACKLOG_MARKER}]'
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0049_research_intelligence_source_profiles'),
    ]

    operations = [
        migrations.RunPython(
            add_priority_backlog,
            reverse_code=remove_priority_backlog,
        ),
    ]
