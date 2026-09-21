from datetime import date

from django.db import migrations


SPRINT_MARKER = 'sprint01-20260921'


TASKS = [
    {
        'title': 'پایش نتایج AutoResearch برای Funding Opportunityها و تهیه Shortlist موارد قابل بررسی',
        'owner': 'sajjad',
        'kr': 'O3-KR2',
        'due': date(2026, 9, 26),
        'priority': 'p0',
        'done': 'نتایج AutoResearch مربوط به Funding Opportunityها بررسی شده و Shortlist فرصت‌های قابل بررسی همراه با دلیل انتخاب و وضعیت هر مورد ثبت شده باشد.',
    },
    {
        'title': 'تدوین قالب اولیه Proposal یکپارچه Gravitas+ برای ارسال به مؤسسات',
        'owner': 'ehsan',
        'kr': 'O3-KR2',
        'due': date(2026, 9, 25),
        'priority': 'p0',
        'done': 'یک قالب یکپارچه و قابل استفاده مجدد برای Proposalهای Gravitas+ آماده و در دسترس تیم باشد.',
    },
    {
        'title': 'آماده‌سازی و ارسال Proposal به حداقل 4 Funding / Institutional Opportunity منتخب',
        'owner': 'ehsan',
        'kr': 'O3-KR2',
        'due': date(2026, 10, 4),
        'priority': 'p0',
        'done': 'حداقل 4 Proposal متناسب با فرصت‌های منتخب آماده و ارسال شده و مقصد، فرصت و تاریخ ارسال هر مورد ثبت شده باشد.',
    },
    {
        'title': 'تدوین سند UX Flow وب‌سایت بر اساس گروه‌های مختلف مخاطب',
        'owner': 'ahmad',
        'kr': 'O4-KR1',
        'due': date(2026, 9, 27),
        'priority': 'p0',
        'done': 'سند UX Flow برای گروه‌های اصلی مخاطب و مسیرهای کلیدی آن‌ها در وب‌سایت تکمیل و برای Review آپلود شده باشد.',
    },
    {
        'title': 'نوشتن Script کامل Video #1',
        'owner': 'ahmad',
        'kr': 'O1-KR1',
        'due': date(2026, 9, 29),
        'priority': 'p0',
        'done': 'Script کامل ویدیوی اول تکمیل شده و آماده Scientific Review و Production باشد.',
    },
    {
        'title': 'ثبت یک Research Project واقعی در Research Workspace و ثبت ایرادات نسخه جدید',
        'owner': 'hossein',
        'kr': 'O4-KR8',
        'due': date(2026, 9, 24),
        'priority': 'p1',
        'done': 'یک Research Project واقعی در Research Workspace ساخته و استفاده شده و ایرادات، frictionها و نیازهای اصلاحی مشاهده‌شده ثبت شده باشد.',
    },
    {
        'title': 'ثبت یک Course واقعی در LMS Workspace و ثبت ایرادات نسخه جدید',
        'owner': 'hossein',
        'kr': 'O2-KR3',
        'due': date(2026, 9, 26),
        'priority': 'p1',
        'done': 'یک Course واقعی در LMS Workspace ساخته و استفاده شده و ایرادات، frictionها و نیازهای اصلاحی مشاهده‌شده ثبت شده باشد.',
    },
    {
        'title': 'ثبت یک Topic واقعی در پلتفرم و تست ساختار جدید',
        'owner': 'hossein',
        'kr': 'O2-KR3',
        'due': date(2026, 9, 28),
        'priority': 'p1',
        'done': 'یک Topic واقعی ساخته شده، حداقل یک محتوای واقعی به آن متصل شده و ایرادات و نیازهای اصلاحی حاصل از استفاده واقعی ثبت شده باشد.',
    },
    {
        'title': 'بررسی عملی Stable Diffusion برای طراحی‌های Gravitas',
        'owner': 'ahmad',
        'kr': 'O4-KR8',
        'due': date(2026, 9, 25),
        'priority': 'p1',
        'done': 'Stable Diffusion روی حداقل 3 Asset یا Use Case واقعی Gravitas تست شده و خروجی‌ها و نتیجه ارزیابی برای Review ثبت شده باشد.',
    },
    {
        'title': 'تست Narrator با صدای سجاد برای Video #1',
        'owner': 'ahmad',
        'kr': 'O1-KR1',
        'due': date(2026, 9, 26),
        'priority': 'p0',
        'done': 'یک نمونه Narrator با صدای سجاد بر اساس بخشی از Script ویدیوی اول تولید و برای Review آپلود شده باشد.',
    },
    {
        'title': 'ارائه فایل‌های SVG نهایی Characterها',
        'owner': 'kiarash',
        'kr': 'O1-KR1',
        'due': date(2026, 9, 24),
        'priority': 'p0',
        'done': 'فایل‌های SVG نهایی Characterها به همراه Source Assetهای لازم تحویل و در محل مورد توافق آپلود شده باشد.',
    },
    {
        'title': 'یکپارچه‌سازی Design سه Workspace اصلی با Material Design وب‌سایت',
        'owner': 'kiarash',
        'kr': 'O4-KR8',
        'due': date(2026, 10, 2),
        'priority': 'p1',
        'done': 'طراحی Core، Research و LMS Workspace در صفحات اصلی با Design Material وب‌سایت هماهنگ شده و خروجی قابل Review باشد.',
    },
    {
        'title': 'Cross-browser و Responsive QA صفحات اصلی و رفع ایرادات Critical/Major',
        'owner': 'kiarash',
        'kr': 'O2-KR2',
        'due': date(2026, 10, 4),
        'priority': 'p1',
        'done': 'صفحات اصلی در مرورگرها و اندازه‌های اصلی بررسی شده و ایرادات Critical/Major مربوط به نمایش و Responsive رفع و نتایج ثبت شده باشد.',
    },
    {
        'title': 'به‌روزرسانی Brand Identity Document برای بخش Assets',
        'owner': 'kiarash',
        'kr': 'O4-KR7',
        'due': date(2026, 9, 27),
        'priority': 'p1',
        'done': 'Brand Identity Document به‌روزرسانی شده و نسخه نهایی برای آپلود در بخش Assets آماده باشد.',
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
        raise RuntimeError('Sprint 01 seed: no roadmap workspace contains all required KR bindings.')

    workspace = state.workspace
    memberships = list(
        WorkspaceMembership.objects.using(db_alias)
        .filter(workspace_id=workspace.pk)
        .select_related('user')
        .order_by('id')
    )

    owners = {}
    for owner_key, aliases in OWNER_ALIASES.items():
        match = None
        for membership in memberships:
            text = _member_text(membership)
            if any(alias.lower() in text for alias in aliases):
                match = membership.user
                break
        if match is None:
            raise RuntimeError(f'Sprint 01 seed: required owner "{owner_key}" is not a member of the roadmap workspace.')
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
