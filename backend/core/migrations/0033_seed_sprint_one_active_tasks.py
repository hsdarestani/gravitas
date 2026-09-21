from datetime import date

from django.db import migrations


SPRINT_MARKER = 'sprint01-20260921'


TASKS = [
    {
        'title': 'Monitor AutoResearch results for funding opportunities and shortlist viable opportunities',
        'owner': 'sajjad',
        'kr': 'O3-KR2',
        'due': date(2026, 9, 26),
        'priority': 'p0',
        'done': 'AutoResearch results for funding opportunities are reviewed, and a shortlist of viable opportunities is recorded with rationale and status for each item.',
    },
    {
        'title': 'Create initial unified Gravitas+ proposal template for institutions',
        'owner': 'ehsan',
        'kr': 'O3-KR2',
        'due': date(2026, 9, 25),
        'priority': 'p0',
        'done': 'A unified, reusable Gravitas+ proposal template is completed and available to the team.',
    },
    {
        'title': 'Prepare and submit proposals to at least 4 selected funding/institutional opportunities',
        'owner': 'ehsan',
        'kr': 'O3-KR2',
        'due': date(2026, 10, 4),
        'priority': 'p0',
        'done': 'At least 4 tailored proposals are prepared and submitted, with recipient, opportunity, and submission date recorded for each.',
    },
    {
        'title': 'Create website UX flow document for key audience segments',
        'owner': 'ahmad',
        'kr': 'O4-KR1',
        'due': date(2026, 9, 27),
        'priority': 'p0',
        'done': 'The UX flow document covers the main audience segments and their key website journeys and is uploaded for review.',
    },
    {
        'title': 'Write complete script for Video #1',
        'owner': 'ahmad',
        'kr': 'O1-KR1',
        'due': date(2026, 9, 29),
        'priority': 'p0',
        'done': 'The complete script for Video #1 is finished and ready for scientific review and production.',
    },
    {
        'title': 'Create a real research project in Research Workspace and document issues in the new version',
        'owner': 'hossein',
        'kr': 'O4-KR8',
        'due': date(2026, 9, 24),
        'priority': 'p1',
        'done': 'A real research project is created and used in Research Workspace, with observed issues, friction points, and required improvements documented.',
    },
    {
        'title': 'Create a real course in LMS Workspace and document issues in the new version',
        'owner': 'hossein',
        'kr': 'O2-KR3',
        'due': date(2026, 9, 26),
        'priority': 'p1',
        'done': 'A real course is created and used in LMS Workspace, with observed issues, friction points, and required improvements documented.',
    },
    {
        'title': 'Create a real topic in the platform and test the new structure',
        'owner': 'hossein',
        'kr': 'O2-KR3',
        'due': date(2026, 9, 28),
        'priority': 'p1',
        'done': 'A real topic is created, at least one real content item is linked to it, and issues and required improvements from real usage are documented.',
    },
    {
        'title': 'Test Stable Diffusion for Gravitas design use cases',
        'owner': 'ahmad',
        'kr': 'O4-KR8',
        'due': date(2026, 9, 25),
        'priority': 'p1',
        'done': 'Stable Diffusion is tested on at least 3 real Gravitas assets or use cases, with outputs and evaluation results recorded for review.',
    },
    {
        "title": "Test narrator using Sajjad's voice for Video #1",
        'owner': 'ahmad',
        'kr': 'O1-KR1',
        'due': date(2026, 9, 26),
        'priority': 'p0',
        "done": "A narrator sample using Sajjad's voice is produced from part of the Video #1 script and uploaded for review.",
    },
    {
        'title': 'Deliver final SVG character files',
        'owner': 'kiarash',
        'kr': 'O1-KR1',
        'due': date(2026, 9, 24),
        'priority': 'p0',
        'done': 'Final SVG character files and required source assets are delivered and uploaded to the agreed location.',
    },
    {
        'title': 'Align Core, Research, and LMS workspace design with the website material design',
        'owner': 'kiarash',
        'kr': 'O4-KR8',
        'due': date(2026, 10, 2),
        'priority': 'p1',
        'done': 'The main Core, Research, and LMS workspace screens are visually aligned with the website design system and ready for review.',
    },
    {
        'title': 'Run cross-browser and responsive QA on key pages and fix critical/major issues',
        'owner': 'kiarash',
        'kr': 'O2-KR2',
        'due': date(2026, 10, 4),
        'priority': 'p1',
        'done': 'Key pages are tested across major browsers and screen sizes, and all critical/major display and responsive issues are fixed with results documented.',
    },
    {
        'title': 'Update Brand Identity Document for Assets',
        'owner': 'kiarash',
        'kr': 'O4-KR7',
        'due': date(2026, 9, 27),
        'priority': 'p1',
        'done': 'The Brand Identity Document is updated and the final version is ready for upload to the Assets section.',
    },
]


OWNER_ALIASES = {
    'hossein': ('hossein', 'hosein', 'حسین', 'darestani'),
    'ahmad': ('ahmad', 'ahmed', 'احمد'),
    'kiarash': ('kiarash', 'کیارش'),
    'sajjad': ('sajjad', 'sajad', 'سجاد'),
    'ehsan': ('ehsan', 'ehsaan', 'احسان'),
}


PROCESS_BY_KR = {
    'O1-KR1': ('content', 'Media & Content'),
    'O2-KR2': ('operations', 'Operations / Management'),
    'O2-KR3': ('operations', 'Operations / Management'),
    'O3-KR2': ('commercial', 'Commercial Scientific Projects'),
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


def seed_sprint_one_active_tasks(apps, schema_editor):
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

    # Fresh/test databases have no synced roadmap state yet. In that case this
    # production seed is intentionally a no-op; production already has the
    # roadmap bindings before this migration is applied.
    if state is None:
        return

    workspace = state.workspace
    memberships = list(
        WorkspaceMembership.objects.using(db_alias)
        .filter(workspace_id=workspace.pk)
        .select_related('user')
        .order_by('id')
    )

    owners = {}
    all_users = list(User.objects.using(db_alias).all().order_by('id'))
    for owner_key, aliases in OWNER_ALIASES.items():
        match = None
        for membership in memberships:
            text = _member_text(membership)
            if any(alias.lower() in text for alias in aliases):
                match = membership.user
                break

        # Some internal collaborators can exist as Gravitas accounts before
        # they are added to the Core workspace. Keep the requested task owner
        # without silently changing workspace access.
        if match is None:
            for user in all_users:
                text = ' '.join(filter(None, [
                    getattr(user, 'first_name', ''),
                    getattr(user, 'last_name', ''),
                    getattr(user, 'username', ''),
                    getattr(user, 'email', ''),
                ])).lower()
                if any(alias.lower() in text for alias in aliases):
                    match = user
                    break

        if match is None:
            raise RuntimeError(f'Sprint 01 seed: required owner "{owner_key}" has no Gravitas account.')
        owners[owner_key] = match

    krs = {}
    for kr_code in required_krs:
        try:
            kr_id = int(bindings[kr_code])
        except (TypeError, ValueError, KeyError):
            raise RuntimeError(f'Sprint 01 seed: invalid binding for {kr_code}.')
        kr = (
            KeyResult.objects.using(db_alias)
            .filter(pk=kr_id, objective__workspace_id=workspace.pk)
            .first()
        )
        if kr is None:
            raise RuntimeError(f'Sprint 01 seed: bound KR {kr_code} was not found.')
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

    due_by_kr = {}
    for task in TASKS:
        due_by_kr[task['kr']] = max(due_by_kr.get(task['kr'], task['due']), task['due'])

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
                title=f'Sprint 01 execution · {kr_code}',
                description=f'Operational execution for Sprint 01 (21 Sep–5 Oct 2026), aligned to {kr_code}.',
                owner_id=kr.owner_id,
                priority='p1',
                stage='',
                health='green',
                status='active',
                start_date=date(2026, 9, 21),
                due_date=due_by_kr[kr_code],
            )
        initiatives[kr_code] = initiative

    for board_order, task_spec in enumerate(TASKS, start=1):
        marker = f'[{SPRINT_MARKER}] Roadmap alignment: {task_spec["kr"]}.'
        existing = (
            OperatingTask.objects.using(db_alias)
            .filter(workspace_id=workspace.pk, title=task_spec['title'])
            .order_by('id')
            .first()
        )
        values = {
            'initiative_id': initiatives[task_spec['kr']].pk,
            'owner_id': owners[task_spec['owner']].pk,
            'description': marker,
            'priority': task_spec['priority'],
            'status': 'active',
            'due_date': task_spec['due'],
            'definition_of_done': task_spec['done'],
            'dependency_id': None,
            'blocked_reason': '',
            'completed_at': None,
            'board_order': board_order,
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


def unseed_sprint_one_active_tasks(apps, schema_editor):
    db_alias = schema_editor.connection.alias
    OperatingTask = apps.get_model('core', 'OperatingTask')
    OperatingTask.objects.using(db_alias).filter(
        description__startswith=f'[{SPRINT_MARKER}]'
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0032_clear_legacy_operating_tasks'),
    ]

    operations = [
        migrations.RunPython(
            seed_sprint_one_active_tasks,
            reverse_code=unseed_sprint_one_active_tasks,
        ),
    ]
