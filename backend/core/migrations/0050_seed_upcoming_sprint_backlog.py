from datetime import date

from django.db import migrations
from django.db.models import F


BACKLOG_MARKER = 'upcoming-sprint-backlog-20261001'
SPRINT_DUE = date(2026, 10, 19)


TASKS = [
    {
        'title': 'Document the end-to-end video production workflow through a real Research Project',
        'owner': 'hossein',
        'kr': 'O4-KR7',
        'priority': 'p0',
        'done': (
            'A real video production project is run in Research Workspace and the reusable process is documented '
            'from brief and research through script, design, scientific review, production, QA and publish. '
            'The documentation names owners, inputs, outputs, handoffs, required artifacts and measurable completion criteria.'
        ),
        'description': (
            'Use a real Research Project as the working case so the documented process reflects actual Gravitas production, '
            'not a theoretical workflow.'
        ),
    },
    {
        'title': 'Launch Video #2 production and complete the first production handoff',
        'owner': 'ahmad',
        'kr': 'O1-KR1',
        'priority': 'p0',
        'done': (
            'Video #2 has formally entered production with the current brief/script and required source material, '
            'the production approach and immediate dependencies are recorded, and at least one concrete production output '
            'or first handoff is delivered for team review.'
        ),
        'description': (
            'Move Video #2 from planning into real production and make the next production step visible to the team.'
        ),
    },
    {
        'title': 'Redesign the LMS learner experience and resolve priority UX friction',
        'owner': 'kiarash',
        'kr': 'O2-KR3',
        'priority': 'p1',
        'done': (
            'The main LMS learner journeys are reviewed and redesigned where needed, including course entry, lesson use, '
            'learning interactions, progress and returning to unfinished work. Priority UX issues are resolved in responsive '
            'designs that are ready for implementation or review.'
        ),
        'description': (
            'Focus on reducing friction in the real learner experience and making the interactive LMS features easier to discover and use.'
        ),
    },
    {
        'title': 'Finalize the public website UX flow from the latest audience and content review',
        'owner': 'kiarash',
        'kr': 'O4-KR1',
        'priority': 'p1',
        'done': (
            'The public website UX flow is updated from the latest review with Ahmad and covers the key audience journeys '
            'from first visit through value understanding, content exploration and the primary conversion/action points. '
            'Desktop and mobile flow states are coherent and the result is ready for team review.'
        ),
        'description': (
            'Turn the latest website discussion with Ahmad into a complete, reviewable storefront UX flow rather than isolated screen changes.'
        ),
    },
    {
        'title': 'Bring Research Workspace to team-ready operational quality',
        'owner': 'hossein',
        'kr': 'O4-KR8',
        'priority': 'p1',
        'done': (
            'A real Research Workspace project can be created and used end-to-end for the team’s normal research workflow. '
            'Blocking and high-friction issues in core project, file/data, note, task and research-context flows are either fixed '
            'or captured with clear owner and next action, leaving the workspace ready for regular team use.'
        ),
        'description': (
            'Close the remaining usability and operational gaps that prevent Research Workspace from being used as the normal team research surface.'
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


def _user_text(user):
    return ' '.join(filter(None, [
        getattr(user, 'first_name', ''),
        getattr(user, 'last_name', ''),
        getattr(user, 'username', ''),
        getattr(user, 'email', ''),
    ])).lower()


def seed_upcoming_sprint_backlog(apps, schema_editor):
    db_alias = schema_editor.connection.alias
    RoadmapOKRSyncState = apps.get_model('core', 'RoadmapOKRSyncState')
    WorkspaceMembership = apps.get_model('core', 'WorkspaceMembership')
    User = apps.get_model('auth', 'User')
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

    # Production has roadmap bindings before this migration. Fresh/test
    # databases may not, so the product seed remains intentionally a no-op there.
    if state is None:
        return

    workspace = state.workspace
    memberships = list(
        WorkspaceMembership.objects.using(db_alias)
        .filter(workspace_id=workspace.pk)
        .select_related('user')
        .order_by('id')
    )
    all_users = list(User.objects.using(db_alias).all().order_by('id'))

    owners = {}
    for owner_key, aliases in OWNER_ALIASES.items():
        match = None
        for membership in memberships:
            if any(alias.lower() in _user_text(membership.user) for alias in aliases):
                match = membership.user
                break
        if match is None:
            for user in all_users:
                if any(alias.lower() in _user_text(user) for alias in aliases):
                    match = user
                    break
        if match is None:
            raise RuntimeError(
                f'Upcoming sprint backlog seed: required owner "{owner_key}" has no Gravitas account.'
            )
        owners[owner_key] = match

    krs = {}
    for kr_code in required_krs:
        try:
            kr_id = int(bindings[kr_code])
        except (TypeError, ValueError, KeyError):
            raise RuntimeError(f'Upcoming sprint backlog seed: invalid binding for {kr_code}.')
        kr = (
            KeyResult.objects.using(db_alias)
            .filter(pk=kr_id, objective__workspace_id=workspace.pk)
            .first()
        )
        if kr is None:
            raise RuntimeError(f'Upcoming sprint backlog seed: bound KR {kr_code} was not found.')
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
                title=f'Upcoming sprint backlog · {kr_code}',
                description=f'Upcoming sprint backlog aligned to {kr_code}.',
                owner_id=kr.owner_id,
                priority='p1',
                stage='',
                health='green',
                status='active',
                start_date=date(2026, 10, 6),
                due_date=SPRINT_DUE,
            )
        initiatives[kr_code] = initiative

    already_seeded = OperatingTask.objects.using(db_alias).filter(
        workspace_id=workspace.pk,
        description__startswith=f'[{BACKLOG_MARKER}]',
    ).exists()

    # Keep the user's explicit priority order at the top of Backlog while
    # preserving the relative order of any older backlog tasks.
    if not already_seeded:
        (
            OperatingTask.objects.using(db_alias)
            .filter(workspace_id=workspace.pk, status='draft')
            .update(board_order=F('board_order') + len(TASKS))
        )

    for rank, task_spec in enumerate(TASKS, start=1):
        marker = (
            f'[{BACKLOG_MARKER}] Roadmap alignment: {task_spec["kr"]}. '
            f'Priority rank: {rank}/{len(TASKS)}. '
        )
        existing = (
            OperatingTask.objects.using(db_alias)
            .filter(
                workspace_id=workspace.pk,
                description__startswith=f'[{BACKLOG_MARKER}]',
                title=task_spec['title'],
            )
            .order_by('id')
            .first()
        )
        values = {
            'initiative_id': initiatives[task_spec['kr']].pk,
            'owner_id': owners[task_spec['owner']].pk,
            'description': marker + task_spec['description'],
            'priority': task_spec['priority'],
            'status': 'draft',
            'due_date': SPRINT_DUE,
            'definition_of_done': task_spec['done'],
            'dependency_id': None,
            'blocked_reason': '',
            'completed_at': None,
            'board_order': rank,
        }
        if existing is None:
            OperatingTask.objects.using(db_alias).create(
                workspace_id=workspace.pk,
                title=task_spec['title'],
                **values,
            )
        else:
            for field, value in values.items():
                setattr(existing, field, value)
            existing.save(using=db_alias)


def unseed_upcoming_sprint_backlog(apps, schema_editor):
    db_alias = schema_editor.connection.alias
    OperatingTask = apps.get_model('core', 'OperatingTask')
    rows = OperatingTask.objects.using(db_alias).filter(
        description__startswith=f'[{BACKLOG_MARKER}]'
    )
    workspace_ids = list(rows.values_list('workspace_id', flat=True).distinct())
    rows.delete()
    for workspace_id in workspace_ids:
        (
            OperatingTask.objects.using(db_alias)
            .filter(workspace_id=workspace_id, status='draft', board_order__gt=len(TASKS))
            .update(board_order=F('board_order') - len(TASKS))
        )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0049_research_intelligence_source_profiles'),
    ]

    operations = [
        migrations.RunPython(
            seed_upcoming_sprint_backlog,
            reverse_code=unseed_upcoming_sprint_backlog,
        ),
    ]
