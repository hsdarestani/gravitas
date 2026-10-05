import json
import logging
import re
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date

from . import operating_api as operating_base
from .layer_access import record_activity
from .layer_models import ActivityEvent
from .lms_models import Course
from .models import ResearchProject, WorkspaceMembership
from .operating_models import KeyResult, OperatingTask, Priority, TelegramPulsarSession, WorkStatus
from .platform_runtime_v3 import core_access, ensure_platform_workspaces
from .pulsar import PLATFORM_CONTEXT, PulsarError, complete, configured


logger = logging.getLogger(__name__)
PERSIAN_RE = re.compile(r'[\u0600-\u06ff]')
URL_RE = re.compile(r'https?://[^\s<>()]+', re.I)
DIGIT_MAP = str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
MAX_ROWS = 40


def _lang(text):
    return 'fa' if PERSIAN_RE.search(str(text or '')) else 'en'


def _say(lang, fa, en):
    return fa if lang == 'fa' else en


def _name(user):
    return user.get_full_name() or user.first_name or user.email or user.get_username()


def _session(user):
    row, _ = TelegramPulsarSession.objects.get_or_create(user=user)
    if row.state and row.updated_at < timezone.now() - timedelta(hours=24):
        row.state = {}
        row.save(update_fields=['state', 'updated_at'])
    return row


def _store(row, state):
    row.state = state or {}
    row.save(update_fields=['state', 'updated_at'])


def clear_session(user):
    row = TelegramPulsarSession.objects.filter(user=user).first()
    if row:
        _store(row, {})


def _context(user):
    spaces = ensure_platform_workspaces(user)
    core, research = spaces['core'], spaces['research']
    if not core_access(user, core):
        raise PermissionError('core_workspace_required')

    members = [
        {'id': row.user_id, 'name': _name(row.user), 'email': row.user.email, 'role': row.role}
        for row in WorkspaceMembership.objects.filter(workspace=core)
        .select_related('user').order_by('user__first_name', 'user__email')[:MAX_ROWS]
    ]
    key_results = [
        {
            'id': row.pk, 'title': row.title, 'objective': row.objective.title,
            'owner_id': row.owner_id, 'due_date': row.due_date.isoformat() if row.due_date else None,
        }
        for row in KeyResult.objects.filter(objective__workspace=core)
        .exclude(status=WorkStatus.ARCHIVED)
        .select_related('objective', 'owner')
        .order_by('objective__due_date', 'objective__title', 'due_date', 'title')[:MAX_ROWS]
    ]
    projects = [
        {'id': row.pk, 'title': row.title}
        for row in ResearchProject.objects.filter(
            archived=False, workspace_id__in={core.pk, research.pk},
        ).order_by('-updated_at', 'title')[:MAX_ROWS]
    ]
    tasks = [
        {
            'id': row.pk, 'title': row.title, 'owner_id': row.owner_id, 'owner': _name(row.owner),
            'key_result_id': row.initiative.key_result_id,
            'due_date': row.due_date.isoformat() if row.due_date else None,
        }
        for row in OperatingTask.objects.filter(workspace=core)
        .exclude(status__in=[WorkStatus.DONE, WorkStatus.ARCHIVED])
        .select_related('owner', 'initiative__key_result')
        .order_by('due_date', 'board_order', 'id')[:MAX_ROWS]
    ]
    courses = [
        {'id': row.pk, 'title': row.title}
        for row in Course.objects.exclude(status=Course.Status.ARCHIVED)
        .order_by('-updated_at', 'title')[:MAX_ROWS]
    ]
    return {
        'core': core, 'research': research, 'members': members, 'key_results': key_results,
        'projects': projects, 'tasks': tasks, 'courses': courses,
        'member_ids': {x['id'] for x in members}, 'kr_ids': {x['id'] for x in key_results},
        'project_ids': {x['id'] for x in projects}, 'task_ids': {x['id'] for x in tasks},
        'course_ids': {x['id'] for x in courses},
    }


def _prompt_context(ctx):
    return json.dumps({
        'members': ctx['members'], 'key_results': ctx['key_results'],
        'research_projects': ctx['projects'], 'open_tasks': ctx['tasks'], 'courses': ctx['courses'],
    }, ensure_ascii=False, separators=(',', ':'))


def _json_answer(answer):
    raw = str(answer or '').strip()
    fence = chr(96) * 3
    if raw.startswith(fence):
        raw = raw[len(fence):].strip()
        if raw.lower().startswith('json'):
            raw = raw[4:].strip()
        if raw.endswith(fence):
            raw = raw[:-len(fence)].strip()
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        start, end = raw.find('{'), raw.rfind('}')
        if start >= 0 and end > start:
            try:
                return json.loads(raw[start:end + 1])
            except ValueError:
                pass
    raise PulsarError('pulsar_invalid_json')


def _as_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _confidence(raw, field):
    try:
        return float((raw.get('confidence') or {}).get(field, 1))
    except (TypeError, ValueError):
        return 1


def _urls(text):
    return [x.rstrip('.,،;)')[:1800] for x in URL_RE.findall(str(text or ''))][:8]


def _fallback_tasks(text):
    rows = []
    for raw in str(text or '').splitlines():
        line = re.sub(r'^\s*(?:[-*•]+|\d+[.)-]?)\s*', '', raw).strip()
        if line:
            rows.append(line)
    if not rows and str(text or '').strip():
        rows = [str(text).strip()]
    return [{'title': x[:240]} for x in rows[:8]]


def _interpret(user, text, ctx):
    if not configured():
        return {'intent': 'create_tasks', 'reply': '', 'tasks': _fallback_tasks(text)}
    system = (
        'You are Pulsar, the authenticated Gravitas+ assistant in Telegram. '
        'The user may chat normally or ask to create one or more Core execution tasks. '
        'Return ONLY JSON and never invent IDs. Use only IDs from the authorized catalog. '
        'Reply in the user language. Keep task titles/descriptions/DoD concise professional English. '
        'Split multi-item requests into separate tasks. Never invent a deadline. '
        'If owner is unstated use the current user. Choose a KR only when relevant; otherwise use null and suggest up to 5 KR IDs. '
        'Project, dependency and course references are optional and must be semantically relevant. '
        'Schema: {"intent":"create_tasks"|"chat","reply":"string","tasks":[{"title":"string","description":"string",'
        '"definition_of_done":"string","priority":"p0|p1|p2|p3","due_date":"YYYY-MM-DD|null","owner_id":1,'
        '"key_result_id":1,"key_result_suggestions":[1,2],"project_id":1,"dependency_id":1,'
        '"related_course_ids":[1,2],"confidence":{"key_result_id":0.0,"project_id":0.0,"dependency_id":0.0}}]}. '
        'For chat intent tasks must be empty.\n\n' + PLATFORM_CONTEXT
    )
    try:
        return _json_answer(complete(
            system=system,
            user=(
                f'Current date: {timezone.localdate().isoformat()}\n'
                f'Current user: {user.pk} · {_name(user)}\n'
                f'Authorized catalog: {_prompt_context(ctx)}\n\nUser message: {text[:6000]}'
            ),
            max_tokens=1800,
            temperature=0.1,
            surface='telegram',
            skill='project_task',
            operation='interpret',
            user_id=user.pk,
            actor=user,
        ))
    except PulsarError:
        logger.exception('Telegram Pulsar interpretation failed user_id=%s', user.pk)
        return {'intent': 'create_tasks', 'reply': '', 'tasks': _fallback_tasks(text)}


def _normalize(raw, user, ctx, source_text):
    raw = raw if isinstance(raw, dict) else {}
    title = ' '.join(str(raw.get('title') or '').split()).strip()[:240]
    if not title:
        return None

    owner = _as_int(raw.get('owner_id'))
    if owner not in ctx['member_ids']:
        owner = user.pk if user.pk in ctx['member_ids'] else next(iter(ctx['member_ids']), None)

    kr = _as_int(raw.get('key_result_id'))
    suggestions = []
    for value in raw.get('key_result_suggestions') or []:
        value = _as_int(value)
        if value in ctx['kr_ids'] and value not in suggestions:
            suggestions.append(value)
    if kr in ctx['kr_ids'] and kr not in suggestions:
        suggestions.insert(0, kr)
    if kr not in ctx['kr_ids'] or _confidence(raw, 'key_result_id') < .66:
        kr = None

    project = _as_int(raw.get('project_id'))
    if project not in ctx['project_ids'] or _confidence(raw, 'project_id') < .72:
        project = None
    dependency = _as_int(raw.get('dependency_id'))
    if dependency not in ctx['task_ids'] or _confidence(raw, 'dependency_id') < .78:
        dependency = None

    courses = []
    for value in raw.get('related_course_ids') or []:
        value = _as_int(value)
        if value in ctx['course_ids'] and value not in courses:
            courses.append(value)

    priority = str(raw.get('priority') or Priority.P2).lower()
    if priority not in Priority.values:
        priority = Priority.P2
    due = str(raw.get('due_date') or '').strip()
    due = due if parse_date(due) else None
    done = str(raw.get('definition_of_done') or '').strip()[:4000]
    if not done:
        done = f'{title} is completed, reviewed, and the final output is available to the team.'

    return {
        'title': title, 'description': str(raw.get('description') or '').strip()[:6000],
        'definition_of_done': done, 'priority': priority, 'due_date': due, 'owner_id': owner,
        'key_result_id': kr, 'key_result_suggestions': suggestions[:5], 'project_id': project,
        'dependency_id': dependency, 'related_course_ids': courses[:5], 'source_urls': _urls(source_text),
    }


def _normalize_many(rows, user, ctx, source_text):
    result = []
    for raw in rows if isinstance(rows, list) else []:
        item = _normalize(raw, user, ctx, source_text)
        if item:
            result.append(item)
    return result[:8]


def _get(rows, pk):
    return next((x for x in rows if x['id'] == pk), None)


def _numbers(text, count):
    value = str(text or '').translate(DIGIT_MAP).strip().lower()
    if value in {'all', 'همه', 'همه‌شون', 'همشون'}:
        return list(range(count))
    result = []
    for token in re.findall(r'\d+', value):
        index = int(token) - 1
        if 0 <= index < count and index not in result:
            result.append(index)
    return result


def _candidate_message(rows, lang):
    lines = [_say(lang, f'{len(rows)} تسک پیدا کردم:', f'I found {len(rows)} task candidates:')]
    lines += [f'{i}. {row["title"]}' for i, row in enumerate(rows, 1)]
    lines += ['', _say(lang, 'شماره‌ها رو بفرست، مثلا «1, 3» یا «همه».', 'Reply with numbers, for example “1, 3”, or “all”.')]
    return {'text': '\n'.join(lines)}


def _kr_rows(draft, ctx):
    ids = list(draft.get('key_result_suggestions') or []) or [x['id'] for x in ctx['key_results'][:5]]
    return [x for x in ctx['key_results'] if x['id'] in ids][:5]


def _kr_question(state, ctx):
    rows = _kr_rows(state['draft'], ctx)
    state['kr_option_ids'] = [x['id'] for x in rows]
    lang = state['language']
    lines = [_say(lang, f'برای «{state["draft"]["title"]}» کدوم KR؟', f'Which KR should “{state["draft"]["title"]}” belong to?')]
    lines += [f'{i}. {row["objective"]} · {row["title"]}' for i, row in enumerate(rows, 1)]
    lines += ['', _say(lang, 'شماره رو بفرست؛ یا اسم KR رو بنویس.', 'Reply with a number, or type the KR name.')]
    return {'text': '\n'.join(lines)}


def _resolve_kr(user, text, rows, ctx):
    value = str(text or '').strip().lower()
    for row in rows:
        haystack = f'{row["objective"]} {row["title"]}'.lower()
        if value and value in haystack:
            return row['id']
    if not configured():
        return None
    try:
        payload = _json_answer(complete(
            system='Choose the best matching KR from the supplied list. Return ONLY JSON {"id":integer|null}. Use only supplied IDs.',
            user=f'User reply: {text[:500]}\nKRs: {json.dumps(ctx["key_results"], ensure_ascii=False)}',
            max_tokens=100,
            temperature=0,
            surface='telegram',
            skill='project_task',
            operation='decision',
            user_id=user.pk,
            actor=user,
        ))
        picked = _as_int(payload.get('id'))
        return picked if picked in ctx['kr_ids'] else None
    except PulsarError:
        return None


def _due_question(state, ctx):
    today = timezone.localdate()
    kr = _get(ctx['key_results'], state['draft'].get('key_result_id'))
    options = []
    if kr and kr.get('due_date') and parse_date(kr['due_date']) >= today:
        options.append(kr['due_date'])
    for days in (7, 14):
        value = (today + timedelta(days=days)).isoformat()
        if value not in options:
            options.append(value)
    state['due_options'] = options[:3]
    lang = state['language']
    lines = [_say(lang, f'Deadline برای «{state["draft"]["title"]}»؟', f'Deadline for “{state["draft"]["title"]}”?')]
    lines += [f'{i}. {value}' for i, value in enumerate(state['due_options'], 1)]
    lines += [f'{len(state["due_options"]) + 1}. ' + _say(lang, 'تاریخ دیگه', 'Another date')]
    lines += ['', _say(lang, 'شماره یا عبارت طبیعی مثل «جمعه» رو بفرست.', 'Reply with a number or a natural date like “Friday”.')]
    return {'text': '\n'.join(lines)}


def _parse_due(user, text, lang):
    direct = parse_date(str(text or '').strip())
    if direct:
        return direct.isoformat()
    value = str(text or '').translate(DIGIT_MAP).strip().lower()
    if value in {'tomorrow', 'فردا'}:
        return (timezone.localdate() + timedelta(days=1)).isoformat()
    if not configured():
        return None
    try:
        payload = _json_answer(complete(
            system='Convert the date expression to ISO YYYY-MM-DD using the current date. Return ONLY JSON {"date":"YYYY-MM-DD|null"}.',
            user=f'Current date: {timezone.localdate().isoformat()}\nLanguage: {lang}\nExpression: {text[:250]}',
            max_tokens=100,
            temperature=0,
            surface='telegram',
            skill='project_task',
            operation='date',
            user_id=user.pk,
            actor=user,
        ))
        value = str(payload.get('date') or '')
        return value if parse_date(value) else None
    except PulsarError:
        return None


def _links(draft, ctx):
    base = settings.PUBLIC_BASE_URL.rstrip('/')
    result = []
    project = _get(ctx['projects'], draft.get('project_id'))
    if project:
        result.append({'label': f'Research project · {project["title"]}', 'url': f'{base}/workspace/research/projects/{project["id"]}'})
    for course_id in draft.get('related_course_ids') or []:
        course = _get(ctx['courses'], course_id)
        if course:
            result.append({'label': f'Course · {course["title"]}', 'url': f'{base}/workspace/learning/courses/{course["id"]}'})
    result += [{'label': 'Source link', 'url': url} for url in draft.get('source_urls') or []]
    unique = []
    seen = set()
    for row in result:
        if row['url'] not in seen:
            seen.add(row['url'])
            unique.append(row)
    return unique[:8]


def _preview(state, ctx):
    d, lang = state['draft'], state['language']
    owner, kr = _get(ctx['members'], d.get('owner_id')), _get(ctx['key_results'], d.get('key_result_id'))
    project, dep = _get(ctx['projects'], d.get('project_id')), _get(ctx['tasks'], d.get('dependency_id'))
    lines = [
        _say(lang, 'پیش‌نویس Pulsar:', 'Pulsar draft:'), '',
        f'Title: {d["title"]}', f'Owner: {owner["name"] if owner else "—"}',
        f'KR: {(kr["objective"] + " · " + kr["title"]) if kr else "—"}',
        f'Project: {project["title"] if project else "—"}',
        f'Dependency: {dep["title"] if dep else "—"}', f'Due: {d.get("due_date") or "—"}',
        f'Priority: {d.get("priority", "p2").upper()}', f'DoD: {d["definition_of_done"]}',
    ]
    links = _links(d, ctx)
    if links:
        lines += ['', _say(lang, 'لینک‌های پیشنهادی:', 'Suggested links:')]
        lines += [f'{i}. {row["label"]} — {row["url"]}' for i, row in enumerate(links, 1)]
    lines += ['', _say(lang, 'اگر اوکیه تأیید کن؛ برای تغییر هم طبیعی بنویس.', 'Confirm to create, or describe a change naturally.')]
    return {
        'text': '\n'.join(lines),
        'reply_markup': {'inline_keyboard': [[
            {'text': '✅ ' + _say(lang, 'تأیید', 'Create'), 'callback_data': 'pulsar:create'},
            {'text': '✏️ ' + _say(lang, 'اصلاح', 'Edit'), 'callback_data': 'pulsar:edit'},
            {'text': '❌ ' + _say(lang, 'لغو', 'Cancel'), 'callback_data': 'pulsar:cancel'},
        ]]},
    }


def _advance(state, ctx):
    if not state['draft'].get('key_result_id'):
        state['mode'] = 'ask_kr'
        return [_kr_question(state, ctx)]
    if not state['draft'].get('due_date'):
        state['mode'] = 'ask_due'
        return [_due_question(state, ctx)]
    state['mode'] = 'confirm'
    return [_preview(state, ctx)]


def _edit(user, draft, instruction, ctx):
    if not configured():
        return draft
    try:
        payload = _json_answer(complete(
            system=(
                'Update the Gravitas task draft from the edit instruction. Return ONLY the full JSON draft. '
                'Keep unchanged fields unchanged. Use only IDs from the supplied catalog. Null removes optional project/dependency.'
            ),
            user=(
                f'Current date: {timezone.localdate().isoformat()}\nCatalog: {_prompt_context(ctx)}\n'
                f'Current draft: {json.dumps(draft, ensure_ascii=False)}\nInstruction: {instruction[:1500]}'
            ),
            max_tokens=1000,
            temperature=.05,
            surface='telegram',
            skill='project_task',
            operation='edit',
            user_id=user.pk,
            actor=user,
        ))
        merged = {**draft, **payload}
        updated = _normalize(merged, user, ctx, instruction)
        if updated:
            if not updated.get('source_urls'):
                updated['source_urls'] = draft.get('source_urls') or []
            return updated
    except PulsarError:
        logger.exception('Telegram Pulsar edit failed user_id=%s', user.pk)
    return draft


def _create(user, draft, ctx):
    core = ctx['core']
    owner_link = WorkspaceMembership.objects.filter(workspace=core, user_id=draft.get('owner_id')).select_related('user').first()
    owner = owner_link.user if owner_link else None
    kr = KeyResult.objects.filter(
        pk=draft.get('key_result_id'), objective__workspace=core,
    ).exclude(status=WorkStatus.ARCHIVED).first()
    due = parse_date(str(draft.get('due_date') or ''))
    if not core_access(user, core) or not owner or not kr or not due:
        raise ValueError('task_missing_required_fields')

    initiative = operating_base._execution_initiative_for_kr(core, kr, owner)
    project = ResearchProject.objects.filter(
        pk=draft.get('project_id'), archived=False,
        workspace_id__in={core.pk, ctx['research'].pk},
    ).first() if draft.get('project_id') else None
    dependency = OperatingTask.objects.filter(
        pk=draft.get('dependency_id'), workspace=core,
    ).exclude(status=WorkStatus.ARCHIVED).first() if draft.get('dependency_id') else None
    priority = draft.get('priority') if draft.get('priority') in Priority.values else Priority.P2

    description = str(draft.get('description') or '').strip()
    links = _links(draft, ctx)
    if links:
        description += ('\n\n' if description else '') + 'Related links:\n' + '\n'.join(f'- {x["label"]}: {x["url"]}' for x in links)

    with transaction.atomic():
        task = OperatingTask.objects.create(
            workspace=core, initiative=initiative, project=project, owner=owner,
            title=draft['title'][:240], description=description[:12000], priority=priority,
            status=WorkStatus.ACTIVE, due_date=due,
            definition_of_done=draft['definition_of_done'][:8000], dependency=dependency,
        )
        record_activity(
            layer=ActivityEvent.Layer.CORE, action='task.created', actor=user, subject_user=user,
            object_type='operating_task', object_id=task.pk,
            detail={'title': task.title, 'source': 'telegram_pulsar'},
        )
        try:
            from .task_notifications import enqueue_task_event
            enqueue_task_event(task, 'task.created', actor=user, detail={'source': 'telegram_pulsar'})
        except Exception:
            logger.exception('Could not enqueue Telegram-created task notification task_id=%s', task.pk)
    return task


def _begin(user, draft, queue, lang, ctx, session):
    state = {'mode': '', 'language': lang, 'draft': draft, 'queue': queue}
    messages = _advance(state, ctx)
    _store(session, state)
    return messages


def _next(user, state, ctx, session):
    queue = list(state.get('queue') or [])
    if not queue:
        _store(session, {})
        return []
    return _begin(user, queue[0], queue[1:], state.get('language') or 'en', ctx, session)


def _confirmed(text):
    return str(text or '').strip().lower() in {'confirm', 'create', 'yes', 'ok', 'okay', 'تأیید', 'تایید', 'اوکی', 'بساز', 'ثبت کن'}


def _cancelled(text):
    return str(text or '').strip().lower() in {'cancel', 'لغو', 'بیخیال', 'بی‌خیال'}


def help_message(lang='fa'):
    return {'text': _say(
        lang,
        'من Pulsar هستم. کارها رو طبیعی بفرست؛ اگر چند تسک باشه جدا می‌کنم، KR و parent و لینک مرتبط پیشنهاد می‌دم و قبل از ساخت تأیید می‌گیرم.\n\n/new — تسک جدید\n/tasks — تسک‌های باز من\n/cancel — لغو پیش‌نویس\n/help — راهنما',
        'I am Pulsar. Send work naturally; I can split multiple tasks, suggest KR/parents/links, and confirm before creation.\n\n/new — new task\n/tasks — my open tasks\n/cancel — cancel draft\n/help — help',
    )}


def welcome_message(user, lang='fa'):
    return {'text': _say(
        lang,
        f'سلام {_name(user)}. من Pulsar هستم و به Gravitas+ شما وصل شدم. تسک‌ها و ایده‌ها رو همینجا طبیعی بفرست؛ قبل از ساخت هر چیزی تأیید می‌گیرم.',
        f'Hi {_name(user)}. I am Pulsar and I am connected to your Gravitas+ account. Send tasks and ideas naturally; I confirm before creating anything.',
    )}


def handle_message(user, text):
    text, lang = str(text or '').strip(), _lang(text)
    if not text:
        return [help_message(lang)]
    try:
        ctx = _context(user)
    except PermissionError:
        return [{'text': _say(lang, 'این اکانت Core Workspace access نداره.', 'This account has no Core Workspace access.')}]

    if text.startswith('/help'):
        return [help_message(lang)]
    if text.startswith('/cancel'):
        clear_session(user)
        return [{'text': _say(lang, 'پیش‌نویس لغو شد.', 'Draft cancelled.')}]
    if text.startswith('/tasks'):
        mine = [x for x in ctx['tasks'] if x['owner_id'] == user.pk][:12]
        if not mine:
            return [{'text': _say(lang, 'تسک باز نداری.', 'You have no open tasks.')}]
        return [{'text': '\n'.join([_say(lang, 'تسک‌های باز:', 'Open tasks:')] + [
            f'{i}. {row["title"]}' + (f' · {row["due_date"]}' if row.get('due_date') else '')
            for i, row in enumerate(mine, 1)
        ])}]

    session = _session(user)
    state = session.state or {}
    if text.startswith('/new'):
        _store(session, {})
        parts = text.split(maxsplit=1)
        text = parts[1].strip() if len(parts) > 1 else ''
        if not text:
            return [{'text': _say(lang, 'تسک یا لیست کارها رو بفرست.', 'Send a task or list of work items.')}]
        state = {}

    if state:
        mode, state_lang = state.get('mode'), state.get('language') or lang
        if _cancelled(text):
            _store(session, {})
            return [{'text': _say(state_lang, 'لغو شد.', 'Cancelled.')}]
        if mode == 'select_tasks':
            candidates = state.get('candidates') or []
            indexes = _numbers(text, len(candidates))
            if not indexes:
                return [{'text': _say(state_lang, 'شماره معتبر بفرست، مثلا 1, 3 یا همه.', 'Send valid numbers, e.g. 1, 3 or all.')}]
            selected = [candidates[i] for i in indexes]
            return _begin(user, selected[0], selected[1:], state_lang, ctx, session)
        if mode == 'ask_kr':
            ids = state.get('kr_option_ids') or []
            rows = [x for x in ctx['key_results'] if x['id'] in ids]
            raw = text.translate(DIGIT_MAP).strip()
            picked = ids[int(raw) - 1] if raw.isdigit() and 0 < int(raw) <= len(ids) else _resolve_kr(user, text, rows, ctx)
            if not picked:
                return [_kr_question(state, ctx)]
            state['draft']['key_result_id'] = picked
            messages = _advance(state, ctx)
            _store(session, state)
            return messages
        if mode == 'ask_due':
            raw, options = text.translate(DIGIT_MAP).strip(), state.get('due_options') or []
            due = options[int(raw) - 1] if raw.isdigit() and 0 < int(raw) <= len(options) else _parse_due(user, text, state_lang)
            if not due:
                return [_due_question(state, ctx)]
            state['draft']['due_date'] = due
            messages = _advance(state, ctx)
            _store(session, state)
            return messages
        if mode in {'confirm', 'edit'}:
            if _confirmed(text) and mode == 'confirm':
                return handle_callback(user, 'pulsar:create')
            state['draft'] = _edit(user, state['draft'], text, ctx)
            messages = _advance(state, ctx)
            _store(session, state)
            return messages

    payload = _interpret(user, text, ctx)
    if payload.get('intent') != 'create_tasks':
        reply = str(payload.get('reply') or '').strip() or _say(lang, 'بگو چه کمکی می‌خوای.', 'Tell me what you need.')
        return [{'text': reply[:4096]}]

    candidates = _normalize_many(payload.get('tasks'), user, ctx, text)
    if not candidates:
        candidates = _normalize_many(_fallback_tasks(text), user, ctx, text)
    if len(candidates) > 1:
        _store(session, {'mode': 'select_tasks', 'language': lang, 'candidates': candidates})
        return [_candidate_message(candidates, lang)]
    if not candidates:
        return [{'text': _say(lang, 'تسک مشخصی از پیام درنیومد؛ کمی دقیق‌تر بگو.', 'I could not extract a clear task; please be more specific.')}]
    return _begin(user, candidates[0], [], lang, ctx, session)


def handle_callback(user, action):
    session, ctx = _session(user), _context(user)
    state = session.state or {}
    lang = state.get('language') or 'en'
    if not state:
        return [{'text': _say(lang, 'پیش‌نویس فعالی نیست.', 'There is no active draft.')}]
    if action == 'pulsar:cancel':
        _store(session, {})
        return [{'text': _say(lang, 'پیش‌نویس لغو شد.', 'Draft cancelled.')}]
    if action == 'pulsar:edit':
        state['mode'] = 'edit'
        _store(session, state)
        return [{'text': _say(lang, 'چی رو تغییر بدم؟ طبیعی بنویس.', 'What should I change? Write it naturally.')}]
    if action != 'pulsar:create' or state.get('mode') != 'confirm':
        return [{'text': _say(lang, 'این اکشن معتبر نیست.', 'That action is not valid now.')}]
    task = _create(user, state['draft'], ctx)
    base = settings.PUBLIC_BASE_URL.rstrip('/')
    created = {'text': _say(
        lang,
        f'✅ ساخته شد: {task.title}\n{base}/workspace/core/tasks?task={task.pk}',
        f'✅ Created: {task.title}\n{base}/workspace/core/tasks?task={task.pk}',
    )}
    return [created, *_next(user, state, ctx, session)]
