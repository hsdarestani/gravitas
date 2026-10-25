import hashlib
import json
import logging
import re
from datetime import timedelta
from pathlib import Path

import requests
from django.db import transaction

from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_date

from .lms_models import Course
from .models import ResearchProject, WorkspaceMembership
from .operating_models import KeyResult, OperatingTask, OperatingTaskAttachment, Priority, TelegramPulsarSession, WorkStatus
from .platform_runtime_v3 import core_access, ensure_platform_workspaces
from .pulsar import PLATFORM_CONTEXT, PulsarError, PulsarPermissionError, complete, configured
from .pulsar_runtime.profiles import assert_skill_allowed
from .pulsar_task_service import create_operating_task


logger = logging.getLogger(__name__)
PERSIAN_RE = re.compile(r'[\u0600-\u06ff]')
URL_RE = re.compile(r'https?://[^\s<>()]+', re.I)
DIGIT_MAP = str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
MAX_ROWS = 40
TELEGRAM_THREAD_KEY = 'primary'


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
            'key_result_id': row.initiative.key_result_id if row.initiative_id else None,
            'project_id': row.project_id,
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


# A question is not a work log or a task, even when it mentions a known
# task, project or research feature. Explicit creation requests are still
# routed to the normal task proposal/confirmation flow.
_INFORMATION_START_RE = re.compile(
    r'^(?:where|what|why|when|who|whose|which|how|is|are|do|does|did|can|could|'
    r'was|were|whereabouts|'
    r'کجا(?:ست|یه|یی)?|کدام|چرا|چی(?:ست|ه)?|چه|چطور|چگونه|آیا|'
    r'wo|was|warum|wann|wer|wie|welche|welcher|ist|sind)\b',
    re.I,
)
_ACTION_REQUEST_RE = re.compile(
    r'\b(?:create|add|make|assign|schedule|log|record|update|submit|save)\s+'
    r'(?:me\s+|a\s+|an\s+|the\s+|my\s+|this\s+|a new\s+)?'
    r'(?:task|report|work log|daily update)\b|'
    r'(?:تسک|وظیفه|گزارش)\s+(?:بساز|ایجاد|ثبت|اضافه|بده)|'
    r'(?:ثبت|ایجاد|بساز|اضافه)\s+(?:کن|کردن)?\s*(?:تسک|وظیفه|گزارش)',
    re.I,
)


def is_information_request(text):
    value = ' '.join(str(text or '').strip().split())
    if not value or value.startswith('/'):
        return False
    if _ACTION_REQUEST_RE.search(value):
        return False
    if value.endswith(('?', '؟')):
        return True
    if _INFORMATION_START_RE.search(value):
        return True
    return False


# An explicit inventory request is not a work log. Never let a model invent
# a project's existing tasks from the bounded general-purpose prompt catalog.
_PROJECT_TASKS_CMD = re.compile(r'^/projecttasks(?:@\w+)?\s+(\d+)(?:\s+(\d+))?\s*$', re.I)
_PROJECT_ID_IN_TEXT = re.compile(r'\b(?:research\s+)?project\s*(?:id\s*[:#]?\s*|#\s*|:\s*)(\d+)\b', re.I)
_PROJECT_TASKS_READ = re.compile(
    r'\b(?:list|show|review|audit|find|display|inspect)\b.{0,180}\b(?:tasks?|project|scientific lab)\b'
    r'|(?:لیست|فهرست|نمایش|بررسی|ببین|بگو).{0,180}(?:تسک|وظیفه|وظایف|کارها|پروژه)',
    re.I | re.S,
)


def _requested_project_inventory(text):
    """Return project/page for an authorized, read-only listing, otherwise None."""
    normalized = str(text or '').translate(DIGIT_MAP).strip()
    command = _PROJECT_TASKS_CMD.fullmatch(normalized)
    if command:
        return int(command.group(1)), int(command.group(2) or 1)
    match = _PROJECT_ID_IN_TEXT.search(normalized)
    if match and _PROJECT_TASKS_READ.search(normalized):
        return int(match.group(1)), 1
    return None


def _project_task_inventory(user, ctx, project_id, page=1, lang='en'):
    """Read canonical project-linked tasks directly; never change the draft."""
    from .platform_access import can_view

    if page < 1 or page > 1000:
        return {'text': _say(lang, 'شماره صفحه معتبر نیست.', 'Invalid page number.')}
    project = ResearchProject.objects.filter(
        pk=project_id, archived=False,
        workspace_id__in=(ctx['core'].pk, ctx['research'].pk),
    ).first()
    if not project or not can_view(user, project):
        return {'text': _say(
            lang, 'پروژه پیدا نشد یا مجوز مشاهده آن را نداری.',
            'Project not found or you do not have permission to view it.',
        )}
    # Do not use ctx['tasks']; that list is capped and intentionally excludes
    # DONE and ARCHIVED items. The per-object ACL may be more restrictive.
    visible = [
        task for task in OperatingTask.objects.filter(
            project=project, workspace=ctx['core'],
        ).select_related('owner', 'project').order_by('pk')
        if can_view(user, task)
    ]
    per_page = 15
    total_pages = max(1, (len(visible) + per_page - 1) // per_page)
    if page > total_pages:
        return {'text': _say(lang, f'صفحه آخر {total_pages} است.', f'Last page is {total_pages}.')}
    begin = (page - 1) * per_page
    shown = visible[begin:begin + per_page]
    base = settings.PUBLIC_BASE_URL.rstrip('/')
    lines = [
        f'{project.title} (#{project.pk})',
        _say(
            lang,
            f'{len(visible)} تسک قابل مشاهده · صفحه {page}/{total_pages} · همه وضعیت‌ها',
            f'{len(visible)} visible tasks · page {page}/{total_pages} · all statuses',
        ),
    ]
    if not shown:
        lines.append(_say(lang, 'هیچ تسکی پیدا نشد.', 'No tasks found.'))
    for task in shown:
        lines.append(
            f'#{task.pk} · {task.title} · {task.status}'
            + f'\n{base}/workspace/core/tasks?task={task.pk}'
        )
    # Compare full accessible inventory, not just the current page.
    by_title = {}
    for task in visible:
        key = ' '.join(task.title.casefold().split())
        by_title.setdefault(key, []).append(task.pk)
    duplicates = [(name, ids) for name, ids in by_title.items() if len(ids) > 1]
    if duplicates:
        lines.append(_say(lang, 'عنوان‌های تکراری احتمالی:', 'Potential duplicate titles:'))
        for name, ids in duplicates[:8]:
            lines.append(f'{name[:75]}: ' + ', '.join(f'#{pk}' for pk in ids))
        if len(duplicates) > 8:
            lines.append(_say(lang, 'موارد بیشتری نیز وجود دارد.', 'More possible duplicates exist.'))
    if page < total_pages:
        lines.append(f'/projecttasks {project.pk} {page + 1}')
    lines.append(_say(
        lang, 'این فقط یک گزارش خواندنی است؛ چیزی تغییر نکرد.',
        'Read-only inventory. No tasks or reports were changed.',
    ))
    return {'text': '\n'.join(lines)[:4096]}


def _navigation_reply(text):
    normalized = ' '.join(str(text or '').casefold().split()).rstrip('?.!؟ ')
    if 'research intelligence' in normalized and is_information_request(text):
        return {
            'text': (
                'Research Intelligence is in Research Workspace → Overview, '
                'below the project summary. It has Funding Calls, Papers & Tools, '
                'AI Developments and History. Core members can open it here:\n'
                'https://graviquest.com/workspace/research#research-intelligence-title'
            ),
        }
    return None


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
        return {'intent': 'chat', 'reply': _say(_lang(text),
            'پالسار فعلاً نمی‌تواند پیام را با اطمینان تفسیر کند. لطفاً دوباره تلاش کن.',
            'Pulsar cannot interpret this message right now. Please try again.'), 'tasks': []}
    system = (
        'You are Pulsar, the authenticated GraviQuest assistant in Telegram. '
        'The user may ask informational questions, chat, report completed work, or explicitly request new tasks. '
        'STRICT: informational questions (where/what/how/why/when, navigation, status requests) are chat. '
        'A project or task name in a question is NOT work progress or a command to create a task. '
        'Choose create_tasks only when the user actually asks to assign/create future work. '
        'Choose log_update only when the user clearly reports work already done, not what they want to know. '
        'When uncertain use chat, NEVER create a task or daily report. '
        'For chat answer the question directly in 1-3 brief sentences, with no unrelated evidence dumps. '
        'Use intent log_update for clear work already performed, instead of creating a duplicate task. '
        'Return ONLY JSON and never invent IDs. Use only IDs from the authorized catalog. '
        'Reply in the user language. Keep task titles/descriptions/DoD concise professional English. '
        'Split only independent deliverables into tasks; merge small steps taking 15 minutes or less. '
        'Every created task requires a concrete deliverable and should take more than 15 minutes. '
        'Never invent a deadline. '
        'If owner is unstated use the current user. Match a KR automatically only when confident; otherwise return null. '
        'Never ask the user to choose a KR. No KR is valid and requires project manager review. '
        'Project, dependency and course references are optional and must be semantically relevant. '
        'Schema: {"intent":"create_tasks"|"log_update"|"chat","reply":"string","tasks":[{"title":"string","description":"string",'
        '"definition_of_done":"string","priority":"p0|p1|p2|p3","due_date":"YYYY-MM-DD|null","owner_id":1,'
        '"key_result_id":1,"key_result_suggestions":[1,2],"project_id":1,"dependency_id":1,'
        '"related_course_ids":[1,2],"requires_attachment":false,'
        '"confidence":{"key_result_id":0.0,"project_id":0.0,"dependency_id":0.0}}]}. '
        'Set requires_attachment true only when the user mentions a required file/evidence. '
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
            thread_id=TELEGRAM_THREAD_KEY,
            operation='interpret',
            user_id=user.pk,
            actor=user,
        ))
    except PulsarError:
        logger.exception('Telegram Pulsar interpretation failed user_id=%s', user.pk)
        return {'intent': 'chat', 'reply': _say(_lang(text),
            'فعلاً نمی‌توانم با اطمینان تشخیص بدهم. هیچ تسک یا گزارشی ثبت نشد.',
            'I could not interpret that safely. No task or report was created.'), 'tasks': []}


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
        'requires_attachment': raw.get('requires_attachment') is True,
    }


def _normalize_many(rows, user, ctx, source_text, source_key=None):
    result = []
    for raw in rows if isinstance(rows, list) else []:
        item = _normalize(raw, user, ctx, source_text)
        if item:
            if source_key:
                item['source_key'] = f'pulsar-telegram:{str(source_key)[:170]}:{len(result) + 1}'
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
            thread_id=TELEGRAM_THREAD_KEY,
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
            thread_id=TELEGRAM_THREAD_KEY,
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
        _say(lang, '📋 تسک پیشنهادی:', '📋 Proposed task:'),
        d['title'],
        f'Output: {d["definition_of_done"][:300]}',
        f'Project: {project["title"] if project else "Core"}',
    ]
    if d.get('due_date'):
        lines.append(f'Due: {d["due_date"]}')
    if kr:
        lines.append(f'KR: {kr["title"]}')
    if not kr:
        lines.append(_say(lang, 'KR نامشخص: برای بررسی به مدیر پروژه اطلاع داده می‌شود.',
                          'No KR match: the project manager will be notified.'))
    if d.get('requires_attachment'):
        lines.append(_say(lang, 'پس از ایجاد تسک، فایل موردنیاز را ارسال کن.',
                          'After creating the task, send its required attachment.'))
    links = _links(d, ctx)
    if links:
        lines += ['', _say(lang, 'لینک‌های پیشنهادی:', 'Suggested links:')]
        lines += [f'{i}. {row["label"]} — {row["url"]}' for i, row in enumerate(links, 1)]
    lines += ['', _say(lang, 'تأیید کن یا «اصلاح» رو بزن.', 'Confirm or tap Edit to change this task.')]
    return {
        'text': '\n'.join(lines),
        'reply_markup': {'inline_keyboard': [[
            {'text': '✅ ' + _say(lang, 'تأیید', 'Create'), 'callback_data': 'pulsar:create'},
            {'text': '✏️ ' + _say(lang, 'اصلاح', 'Edit'), 'callback_data': 'pulsar:edit'},
            {'text': '❌ ' + _say(lang, 'لغو', 'Cancel'), 'callback_data': 'pulsar:cancel'},
        ]]},
    }


def _advance(state, ctx):
    # A missing KR is allowed. Pulsar must never interrupt the user to ask for
    # strategy mapping; creation generates a manager-review notification.
    if state['draft'].get('key_result_id') and not state['draft'].get('due_date'):
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
                'Update the GraviQuest task draft from the edit instruction. Return ONLY the full JSON draft. '
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
            thread_id=TELEGRAM_THREAD_KEY,
            operation='edit',
            user_id=user.pk,
            actor=user,
        ))
        merged = {**draft, **payload}
        updated = _normalize(merged, user, ctx, instruction)
        if updated:
            if not updated.get('source_urls'):
                updated['source_urls'] = draft.get('source_urls') or []
            updated['source_key'] = draft.get('source_key')
            return updated
    except PulsarError:
        logger.exception('Telegram Pulsar edit failed user_id=%s', user.pk)
    return draft


def _create(user, draft, ctx):
    payload = dict(draft or {})
    payload['related_links'] = _links(payload, ctx)
    return create_operating_task(
        user,
        payload,
        confirmed=True,
        source='telegram_pulsar',
    )


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
        'من Pulsar هستم. تسک‌های جدید رو پیشنهاد می‌دم و برای فعالیت‌های انجام‌شده لاگ قابل تأیید می‌سازم. KR رو خودم تطبیق می‌دم.\n\n/new — تسک جدید\n/report — ثبت فعالیت\n/tasks — تسک‌های باز من\n/cancel — لغو پیش‌نویس\n/help — راهنما',
        'I am Pulsar. Send new tasks or progress updates naturally. I will match KRs and format activity logs for approval.\n\n/new — new task\n/projecttasks 213 — project task inventory\n/multi — combine consecutive messages\n/reportmulti YYYY-MM-DD — combine dated work updates\n/reports — recent reports\n/report — log progress\n/tasks — my open tasks\n/cancel — cancel draft\n/help — help',
    )}


def welcome_message(user, lang='fa'):
    return {'text': _say(
        lang,
        f'سلام {_name(user)}. من Pulsar هستم و به GraviQuest شما وصل شدم. تسک‌ها و ایده‌ها رو همینجا طبیعی بفرست؛ قبل از ساخت هر چیزی تأیید می‌گیرم.',
        f'Hi {_name(user)}. I am Pulsar and I am connected to your GraviQuest account. Send tasks and ideas naturally; I confirm before creating anything.',
    )}


def _report_proposal(user, text, source_key=None):
    """Use the durable, revisioned daily report flow for existing task logs."""
    from .telegram_work_reports import preview
    from .work_reports import propose, parse_work_date_prefix
    try:
        day, work = parse_work_date_prefix(text, user)
    except ValueError as exc:
        return {'text': f'Invalid work date: {exc}. Use YYYY-MM-DD or a recent relative date.'}
    return preview(propose(user, work, source='telegram', source_key=source_key, report_date=day))


def handle_message(user, text, source_key=None):
    text, lang = str(text or '').strip(), _lang(text)
    if not text:
        return [help_message(lang)]
    try:
        assert_skill_allowed(user, 'project_task')
    except PulsarPermissionError:
        return [{'text': _say(lang, 'دسترسی Pulsar برای مدیریت پروژه و تسک در پروفایل شما غیرفعال است.', 'Pulsar project/task capability is disabled in your profile.')}]
    try:
        ctx = _context(user)
    except PermissionError:
        return [{'text': _say(lang, 'این اکانت Core Workspace access نداره.', 'This account has no Core Workspace access.')}]

    # Opt-in multiline composition: the user can send related messages in any
    # order and ask Pulsar to interpret them ONCE, not as unrelated tasks.
    # No delayed/background batching can safely guess when the user is done.
    session_for_multi = _session(user)
    multi_state = session_for_multi.state or {}
    if text.lower() in {'/multi', '/collect'}:
        if multi_state.get('mode') and multi_state.get('mode') != 'collect':
            return [{'text': _say(lang,
                'اول پیش‌نویس فعلی را تأیید یا /cancel کن.',
                'Confirm or /cancel the current draft before starting a combined message.')}]
        _store(session_for_multi, {'mode': 'collect', 'parts': [], 'language': lang})
        return [{'text': _say(lang,
            'پیام‌های مرتبط را پشت سر هم بفرست. در پایان /done بزن تا همه را یکجا بفهمم و یک پیش‌نویس نشان بدهم.',
            'Send related messages. Use /done when finished so I can interpret them together and show one preview.')}]
    if multi_state.get('mode') == 'collect':
        if text.lower() == '/cancel':
            _store(session_for_multi, {})
            return [{'text': _say(lang, 'پیش‌نویس چندپیامی لغو شد.', 'Combined draft cancelled.')}]
        if text.lower() == '/done':
            parts = multi_state.get('parts') or []
            if not parts:
                return [{'text': _say(lang, 'اول پیام‌ها را بفرست.', 'Send some messages first.')}]
            combined = '\n'.join(parts)
            _store(session_for_multi, {})
            return handle_message(user, combined, source_key=source_key)
        if text.startswith('/'):
            return [{'text': _say(lang, 'پیام بعدی را بفرست یا /done یا /cancel بزن.',
                                  'Send the next message, /done to finish, or /cancel.')}]
        parts = [*(multi_state.get('parts') or []), text]
        if len(parts) > 25 or len('\n'.join(parts)) > 16000:
            return [{'text': _say(lang, 'متن زیاد شد؛ /done بزن.', 'Too much text; use /done now.')}]
        multi_state['parts'] = parts
        _store(session_for_multi, multi_state)
        return [{'text': _say(lang,
            f'{len(parts)} پیام در یک کانتکست ذخیره شد. ادامه بده یا /done بزن.',
            f'{len(parts)} messages in one context. Send more or /done.')}]

    if text.startswith('/help'):
        return [help_message(lang)]
    if text.startswith('/cancel'):
        clear_session(user)
        return [{'text': _say(lang, 'پیش‌نویس لغو شد.', 'Draft cancelled.')}]
    if text.startswith('/attach'):
        pieces = text.split(maxsplit=1)
        task_id = _as_int(pieces[1]) if len(pieces) == 2 else None
        task = OperatingTask.objects.filter(pk=task_id, owner=user).first() if task_id else None
        if not task:
            return [{'text': _say(lang, 'شناسه تسک معتبر متعلق به خودت را بفرست: /attach 123',
                                  'Provide your own valid task ID: /attach 123')}]
        from .platform_access import can_edit
        if not can_edit(user, task):
            return [{'text': _say(lang, 'اجازه پیوست کردن به این تسک را نداری.',
                                  'You cannot attach files to this task.')}]
        session = _session(user)
        _store(session, {'mode': 'await_attachment', 'task_id': task.pk, 'language': lang,
                         'queue': (session.state or {}).get('queue') or []})
        return [{'text': _say(lang, 'فایل را ارسال کن؛ وقتی تمام شد /done را بزن.',
                              'Send the document or image, then send /done.')}]
    # Informational requests must not consume an older pending task draft,
    # enter the daily report flow, or even ask the action classifier to decide.
    # A known in-app destination can be answered without any model call.
    if is_information_request(text):
        location = _navigation_reply(text)
        if location:
            return [location]

    inventory = _requested_project_inventory(text)
    if inventory:
        return [_project_task_inventory(user, ctx, *inventory, lang=lang)]
    if text.startswith('/projecttasks'):
        return [{'text': _say(lang, 'دستور درست: /projecttasks 213', 'Usage: /projecttasks 213')}]

    if text.startswith('/tasks'):
        from .platform_access import can_view
        mine = [
            task for task in OperatingTask.objects.filter(
                owner=user, workspace=ctx['core'],
            ).exclude(status__in=[WorkStatus.DONE, WorkStatus.ARCHIVED]).order_by('due_date', 'pk')
            if can_view(user, task)
        ][:12]
        if not mine:
            return [{'text': _say(lang, 'تسک باز نداری.', 'You have no open tasks.')}]
        return [{'text': '\n'.join([_say(lang, 'تسک‌های باز:', 'Open tasks:')] + [
            f'{i}. #{row.pk} {row.title}' + (f' · {row.due_date}' if row.due_date else '')
            for i, row in enumerate(mine, 1)
        ])}]

    session = _session(user)
    state = session.state or {}
    # An independent question must not be interpreted as "edit the currently
    # pending task". Preserve the pending draft for the actual buttons.
    if state.get('mode') in {'confirm', 'edit', 'select_tasks', 'ask_kr', 'ask_due'} and is_information_request(text):
        payload = _interpret(user, text, ctx)
        reply = str(payload.get('reply') or '').strip()
        if not reply:
            reply = _say(lang, 'این سؤال به‌عنوان تسک یا گزارش ثبت نشد.',
                         'This question was not treated as a task or report.')
        return [{'text': reply[:1500]}]
    if text.startswith('/new'):
        _store(session, {})
        parts = text.split(maxsplit=1)
        text = parts[1].strip() if len(parts) > 1 else ''
        if not text:
            return [{'text': _say(lang, 'تسک یا لیست کارها رو بفرست.', 'Send a task or list of work items.')}]
        state = {}

    if state:
        mode, state_lang = state.get('mode'), state.get('language') or lang
        if mode == 'await_attachment':
            if text.lower() in {'/done', '/skip'}:
                return handle_callback(user, 'pulsar:attachments_done')
            return [{'text': _say(lang, 'فایل را بفرست یا /done را بزن.',
                                  'Send the attachment or type /done.')}]

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
            if mode == 'confirm':
                # Incoming independent messages must not silently overwrite a
                # pending draft. Queue new tasks; persist reports separately.
                incoming = _interpret(user, text, ctx)
                if incoming.get('intent') == 'log_update':
                    return [_report_proposal(user, text, source_key)]
                if incoming.get('intent') == 'create_tasks':
                    queued = _normalize_many(incoming.get('tasks'), user, ctx, text, source_key)
                    if queued:
                        known = {x.get('source_key') for x in [state.get('draft'), *(state.get('queue') or [])] if x}
                        queued = [x for x in queued if not x.get('source_key') or x['source_key'] not in known]
                    if queued:
                        state['queue'] = [*(state.get('queue') or []), *queued][:40]
                        _store(session, state)
                        return [{'text': _say(lang, f'{len(queued)} مورد به صف اضافه شد؛ اول تسک فعلی را تأیید کن.',
                                              f'{len(queued)} item(s) queued. Confirm the current task first.')},
                                _preview(state, ctx)]
            state['draft'] = _edit(user, state['draft'], text, ctx)
            messages = _advance(state, ctx)
            _store(session, state)
            return messages

    payload = _interpret(user, text, ctx)
    if is_information_request(text):
        # Defensive boundary: a model's accidental "log_update" or
        # "create_tasks" classification must never override clear questions.
        answer = str(payload.get('reply') or '').strip()
        if payload.get('intent') != 'chat' or not answer:
            answer = _say(lang,
                'این یک سؤال است، نه گزارش یا تسک. لطفاً سؤال را دوباره بپرس اگر پاسخ نگرفتی.',
                'That is a question, not a task or daily report. Please retry if the answer was unclear.')
        return [{'text': answer[:1500]}]
    if payload.get('intent') == 'log_update':
        return [_report_proposal(user, text, source_key)]
    if payload.get('intent') != 'create_tasks':
        reply = str(payload.get('reply') or '').strip() or _say(lang, 'بگو چه کمکی می‌خوای.', 'Tell me what you need.')
        return [{'text': reply[:4096]}]

    candidates = _normalize_many(payload.get('tasks'), user, ctx, text, source_key)
    if not candidates:
        candidates = _normalize_many(_fallback_tasks(text), user, ctx, text, source_key)
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
    if action == 'pulsar:attachments_done' and state.get('mode') == 'await_attachment':
        return [{'text': _say(lang, 'پیوست‌ها ثبت شدند.', 'Attachments finished.')},
                *_next(user, state, ctx, session)]
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
    needs_file = bool(state['draft'].get('requires_attachment'))
    base = settings.PUBLIC_BASE_URL.rstrip('/')
    created = {'text': _say(
        lang,
        f'✅ ساخته شد: {task.title}\n{base}/workspace/core/tasks?task={task.pk}',
        f'✅ Created: {task.title}\n{base}/workspace/core/tasks?task={task.pk}',
    )}
    if needs_file:
        _store(session, {'mode': 'await_attachment', 'task_id': task.pk,
                         'language': lang, 'queue': state.get('queue') or []})
        return [created, {'text': _say(lang, 'فایل مربوط به این تسک را بفرست، سپس /done را بزن.',
                                      'Send the required task attachment, then type /done.')}]
    return [created, *_next(user, state, ctx, session)]

def handle_document(user, document, source_key=None):
    """Attach Telegram evidence to an explicitly selected, authorized task.

    Uses the same local storage and attachment model as the task board. A
    stable message key avoids duplicate rows on Telegram webhook retries.
    """
    state = _session(user).state or {}
    lang = state.get('language') or 'en'
    if state.get('mode') != 'await_attachment':
        return [{'text': _say(lang, 'اول تسک را تأیید کن یا /attach ID بفرست.',
                              'Confirm a task first or use /attach ID.')}]
    from .platform_access import can_edit
    task = OperatingTask.objects.filter(pk=state.get('task_id'), owner=user).first()
    if not task or not can_edit(user, task):
        return [{'text': _say(lang, 'دسترسی پیوست به این تسک وجود ندارد.',
                              'Attachment access is not available for this task.')}]

    fid = str(document.get('file_id') or '')
    size = _as_int(document.get('file_size')) or 0
    limit = int(settings.CONTENT_ATTACHMENT_MAX_BYTES)
    if not fid or size <= 0 or size > limit:
        return [{'text': _say(lang, 'فایل خالی یا بیش از حد بزرگ است.',
                              'The file is empty or exceeds the attachment limit.')}]
    from .task_board_api import _safe_filename
    from .task_notifications import _telegram_api
    name = _safe_filename(document.get('file_name') or 'telegram-image.jpg')
    key = hashlib.sha256(str(source_key or fid).encode('utf-8')).hexdigest()[:24]
    root = Path(settings.CORE_UPLOAD_ROOT) / 'tasks' / str(task.pk)
    path = root / f'telegram-{key}-{name}'
    existing = OperatingTaskAttachment.objects.filter(task=task, storage_path=str(path)).first()
    if existing:
        return [{'text': _say(lang, 'این فایل قبلاً ثبت شده.', 'Already attached.')}]
    remote = _telegram_api('getFile', {'file_id': fid}).get('result') or {}
    file_path = str(remote.get('file_path') or '')
    if not file_path or '..' in file_path or not re.fullmatch(r'[A-Za-z0-9_./-]+', file_path):
        raise ValueError('invalid_telegram_file_path')
    root.mkdir(parents=True, exist_ok=True)
    received = 0
    try:
        with requests.get(
            f"https://api.telegram.org/file/bot{settings.GRAVITAS_TELEGRAM_BOT_TOKEN}/{file_path}",
            stream=True, timeout=(5, 15),
        ) as response:
            response.raise_for_status()
            with path.open('xb') as handle:
                for chunk in response.iter_content(chunk_size=65536):
                    received += len(chunk)
                    if received > limit:
                        raise ValueError('file_size_invalid')
                    handle.write(chunk)
        if received == 0:
            raise ValueError('file_empty')
        with transaction.atomic():
            row, _ = OperatingTaskAttachment.objects.get_or_create(
                task=task, storage_path=str(path),
                defaults={'uploader': user, 'name': name,
                          'mime_type': str(document.get('mime_type') or '')[:160],
                          'size': received},
            )
    except Exception:
        path.unlink(missing_ok=True)
        raise
    from .layer_access import record_activity
    from .layer_models import ActivityEvent
    record_activity(
        layer=ActivityEvent.Layer.CORE, action='task.attachment_added',
        actor=user, subject_user=user, object_type='operating_task',
        object_id=task.pk, detail={'attachment_id': row.pk, 'name': name,
                                   'source': 'telegram_pulsar'},
    )
    return [{'text': _say(lang, f'✅ {name} به تسک پیوست شد. فایل بعدی یا /done',
                          f'✅ Attached {name}. Send another file or /done.')}]

