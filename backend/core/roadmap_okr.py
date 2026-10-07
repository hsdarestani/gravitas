import hashlib
import json
import re
from datetime import timedelta
from decimal import Decimal
from urllib.request import Request, urlopen

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import WorkspaceMembership
from .operating_models import KeyResult, StrategicObjective, WorkStatus
from .roadmap_models import RoadmapOKRSyncState


ROADMAP_PAGE_URL = 'https://gravitas-roadmap.pages.dev/'
ROADMAP_SOURCE_URL = 'https://raw.githubusercontent.com/hsdarestani/Gravitas-roadmap/main/i18n.js'
ROADMAP_PERIOD = 'Roadmap · 6 months'
AUTO_SYNC_INTERVAL = timedelta(hours=1)
ERROR_RETRY_INTERVAL = timedelta(minutes=15)

OBJECTIVE_SUMMARY_KEYS = [
    'چهار نتیجه‌ای که باید تا پایان ماه ششم ثابت شوند',
    'چهار چیزی که باید در شش ماه ثابت کنیم',
]
DETAIL_KEYS = {
    'O1': 'ساختن موتور محتوایی قابل‌تشخیص و تکرار',
    'O2': 'تبدیل مخاطب گذری به جامعه‌ای فعال',
    'O3': 'اعتبارسنجی مدل درآمدی',
    'O4': 'ساختن سیستم اجرایی مبتنی بر داده',
}
NUMBER_WORDS = {
    'one': 1,
    'two': 2,
    'three': 3,
    'four': 4,
    'five': 5,
    'six': 6,
    'seven': 7,
    'eight': 8,
    'nine': 9,
    'ten': 10,
    'twelve': 12,
    'eighteen': 18,
    'twenty': 20,
    'thirty': 30,
    'fifty': 50,
    'hundred': 100,
}


def _decode_js_string(value):
    return json.loads('"' + value + '"')


def _balanced(source, start, opening='{', closing='}'):
    if start < 0 or start >= len(source) or source[start] != opening:
        raise ValueError('roadmap_structure_changed')
    depth = 0
    quoted = False
    escaped = False
    for index in range(start, len(source)):
        char = source[index]
        if quoted:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                quoted = False
            continue
        if char == '"':
            quoted = True
        elif char == opening:
            depth += 1
        elif char == closing:
            depth -= 1
            if depth == 0:
                return source[start:index + 1]
    raise ValueError('roadmap_structure_changed')


def _entry(source, key):
    marker = json.dumps(key, ensure_ascii=False)
    pos = source.find(marker)
    if pos < 0:
        raise ValueError(f'roadmap_entry_missing:{key}')
    start = source.find('{', pos + len(marker))
    return _balanced(source, start)


def _array(block, field):
    match = re.search(r'\b' + re.escape(field) + r'\s*:\s*\[', block)
    if not match:
        return None
    start = block.find('[', match.start())
    return _balanced(block, start, '[', ']')


def _string_property(block, field):
    match = re.search(r'\b' + re.escape(field) + r'\s*:\s*"((?:\\.|[^"\\])*)"', block)
    return _decode_js_string(match.group(1)) if match else ''


def _array_strings(block, field):
    arr = _array(block, field)
    if not arr:
        return []
    return [_decode_js_string(item) for item in re.findall(r'"((?:\\.|[^"\\])*)"', arr)]


def _array_objects(block, field):
    arr = _array(block, field)
    if not arr:
        return []
    objects = []
    index = 1
    while index < len(arr) - 1:
        start = arr.find('{', index)
        if start < 0:
            break
        item = _balanced(arr, start)
        objects.append(item)
        index = start + len(item)
    return objects


def parse_roadmap_okr(source):
    summary = None
    for key in OBJECTIVE_SUMMARY_KEYS:
        try:
            summary = _entry(source, key)
            break
        except ValueError:
            continue
    if not summary:
        raise ValueError('roadmap_objective_summary_missing')

    objective_cards = {}
    for card in _array_objects(summary, 'cards'):
        title = _string_property(card, 'title')
        description = _string_property(card, 'text')
        match = re.match(r'\s*(O[1-4])\s*[—–-]\s*(.+)', title)
        if match:
            objective_cards[match.group(1)] = {
                'title': match.group(2).strip(),
                'description': description.strip(),
            }

    objectives = []
    for code in ('O1', 'O2', 'O3', 'O4'):
        card = objective_cards.get(code)
        if not card:
            raise ValueError(f'roadmap_objective_missing:{code}')
        detail = _entry(source, DETAIL_KEYS[code])
        detail_title = _string_property(detail, 'title')
        bullets = _array_strings(detail, 'bullets')
        if not bullets:
            raise ValueError(f'roadmap_key_results_missing:{code}')
        objectives.append({
            'key': code,
            'title': f'{code} · {card["title"]}',
            'description': card['description'],
            'detail_title': detail_title,
            'key_results': [
                {'key': f'{code}-KR{index}', 'title': text}
                for index, text in enumerate(bullets, start=1)
            ],
        })
    return objectives


def _infer_target(text):
    candidates = []
    for match in re.finditer(r'(?<![\w])\d[\d,]*(?:\.\d+)?', text):
        raw = match.group(0).replace(',', '')
        try:
            candidates.append((match.start(), Decimal(raw)))
        except Exception:
            pass
    for word, value in NUMBER_WORDS.items():
        match = re.search(r'\b' + word + r'\b', text, re.I)
        if match:
            candidates.append((match.start(), Decimal(value)))
    if not candidates:
        return None, ''
    position, target = min(candidates, key=lambda item: item[0])
    lower = text.lower()
    if '€' in text or 'revenue' in lower and ('contract' in lower or 'signed' in lower):
        unit = 'EUR'
    elif '%' in text[position:position + 20] or 'percent' in lower:
        unit = '%'
    elif 'short' in lower:
        unit = 'shorts'
    elif 'long-form video' in lower or 'main video' in lower:
        unit = 'videos'
    elif 'newsletter subscriber' in lower:
        unit = 'subscribers'
    elif 'newsletter edition' in lower:
        unit = 'editions'
    elif 'registered member' in lower or 'active member' in lower or 'paid member' in lower:
        unit = 'members'
    elif 'contribution' in lower:
        unit = 'contributions'
    elif 'participant' in lower:
        unit = 'participants'
    elif 'session' in lower or 'study club' in lower or 'live discussion' in lower:
        unit = 'sessions'
    elif 'proposal' in lower:
        unit = 'proposals'
    elif 'paid project' in lower:
        unit = 'projects'
    elif 'offer' in lower:
        unit = 'offers'
    elif 'workshop' in lower:
        unit = 'workshops'
    elif 'experiment kit' in lower:
        unit = 'kits'
    elif 'game' in lower or 'quiz' in lower or 'simulation' in lower or 'interactive experience' in lower or 'tool' in lower:
        unit = 'outputs'
    elif 'article' in lower or 'dossier' in lower:
        unit = 'outputs'
    elif 'people contributing' in lower:
        unit = 'contributors'
    else:
        unit = ''
    return target, unit


def _fetch_source():
    request = Request(
        ROADMAP_SOURCE_URL,
        headers={'User-Agent': 'Gravitas-Roadmap-OKR-Sync/1.0'},
    )
    with urlopen(request, timeout=6) as response:
        payload = response.read()
    return payload.decode('utf-8')


def _sync_owner(workspace, actor=None):
    if actor and getattr(actor, 'is_authenticated', False):
        membership = WorkspaceMembership.objects.filter(workspace=workspace, user=actor, user__is_active=True).first()
        if membership:
            return actor
    membership = (
        WorkspaceMembership.objects.filter(
            workspace=workspace,
            user__is_active=True,
            role__in=[WorkspaceMembership.Role.OWNER, WorkspaceMembership.Role.ADMIN],
        )
        .select_related('user')
        .order_by('id')
        .first()
    )
    if not membership:
        membership = (
            WorkspaceMembership.objects.filter(workspace=workspace, user__is_active=True)
            .select_related('user')
            .order_by('id')
            .first()
        )
    if not membership:
        raise ValueError('core_workspace_has_no_active_member')
    return membership.user


def _state(workspace):
    state, _ = RoadmapOKRSyncState.objects.get_or_create(
        workspace=workspace,
        defaults={'source_url': ROADMAP_SOURCE_URL},
    )
    return state


def _valid_bound_id(mapping, key):
    try:
        return int((mapping or {}).get(key))
    except (TypeError, ValueError):
        return None


def sync_workspace_okr(workspace, actor=None, source_text=None):
    state = _state(workspace)
    now = timezone.now()
    state.last_attempted_at = now
    state.source_url = ROADMAP_SOURCE_URL
    state.save(update_fields=['last_attempted_at', 'source_url', 'updated_at'])

    try:
        source = source_text if source_text is not None else _fetch_source()
        spec = parse_roadmap_okr(source)
        revision = hashlib.sha256(source.encode('utf-8')).hexdigest()[:24]
        owner = _sync_owner(workspace, actor)

        with transaction.atomic():
            state = RoadmapOKRSyncState.objects.select_for_update().get(pk=state.pk)
            previous = state.bindings or {}
            previous_objectives = previous.get('objectives') or {}
            previous_krs = previous.get('key_results') or {}
            next_objectives = {}
            next_krs = {}
            created_objectives = 0
            created_krs = 0
            updated_objectives = 0
            updated_krs = 0

            for source_objective in spec:
                objective_id = _valid_bound_id(previous_objectives, source_objective['key'])
                objective = StrategicObjective.objects.filter(pk=objective_id, workspace=workspace).first() if objective_id else None
                if objective is None:
                    objective = StrategicObjective.objects.create(
                        workspace=workspace,
                        title=source_objective['title'],
                        description=source_objective['description'],
                        owner=owner,
                        quarter=ROADMAP_PERIOD,
                        status=WorkStatus.ACTIVE,
                    )
                    created_objectives += 1
                else:
                    changed = False
                    desired = {
                        'title': source_objective['title'],
                        'description': source_objective['description'],
                        'quarter': ROADMAP_PERIOD,
                        'status': WorkStatus.ACTIVE,
                    }
                    for field, value in desired.items():
                        if getattr(objective, field) != value:
                            setattr(objective, field, value)
                            changed = True
                    if changed:
                        objective.save(update_fields=['title', 'description', 'quarter', 'status', 'updated_at'])
                        updated_objectives += 1
                next_objectives[source_objective['key']] = objective.pk

                for source_kr in source_objective['key_results']:
                    kr_id = _valid_bound_id(previous_krs, source_kr['key'])
                    kr = KeyResult.objects.filter(pk=kr_id, objective__workspace=workspace).first() if kr_id else None
                    target, unit = _infer_target(source_kr['title'])
                    if kr is None:
                        kr = KeyResult.objects.create(
                            objective=objective,
                            title=source_kr['title'],
                            owner=owner,
                            metric_name='Roadmap target' if target is not None else 'Roadmap outcome',
                            unit=unit,
                            baseline_value=Decimal('0') if target is not None else None,
                            target_value=target,
                            status=WorkStatus.ACTIVE,
                        )
                        created_krs += 1
                    else:
                        changed = False
                        desired = {
                            'objective': objective,
                            'title': source_kr['title'],
                            'metric_name': 'Roadmap target' if target is not None else 'Roadmap outcome',
                            'unit': unit,
                            'target_value': target,
                            'status': WorkStatus.ACTIVE,
                        }
                        for field, value in desired.items():
                            if getattr(kr, field) != value:
                                setattr(kr, field, value)
                                changed = True
                        if target is not None and kr.baseline_value is None:
                            kr.baseline_value = Decimal('0')
                            changed = True
                        if changed:
                            kr.save(update_fields=['objective', 'title', 'metric_name', 'unit', 'baseline_value', 'target_value', 'status', 'updated_at'])
                            updated_krs += 1
                    next_krs[source_kr['key']] = kr.pk

            state.source_revision = revision
            state.bindings = {'objectives': next_objectives, 'key_results': next_krs}
            state.last_synced_at = now
            state.last_error = ''
            state.save(update_fields=['source_revision', 'bindings', 'last_synced_at', 'last_error', 'updated_at'])

        return {
            'created_objectives': created_objectives,
            'updated_objectives': updated_objectives,
            'created_key_results': created_krs,
            'updated_key_results': updated_krs,
            'revision': revision,
        }
    except Exception as exc:
        state.last_error = str(exc)[:2000]
        state.save(update_fields=['last_error', 'updated_at'])
        raise


def ensure_roadmap_okr_sync(workspace, actor=None):
    state = _state(workspace)
    now = timezone.now()
    if state.last_synced_at and now - state.last_synced_at < AUTO_SYNC_INTERVAL:
        return state, False
    if state.last_error and state.last_attempted_at and now - state.last_attempted_at < ERROR_RETRY_INTERVAL:
        return state, False
    try:
        sync_workspace_okr(workspace, actor=actor)
    except Exception:
        pass
    state.refresh_from_db()
    return state, True


def sync_status(workspace, user=None, auto=True):
    state = _state(workspace)
    attempted = False
    if auto:
        state, attempted = ensure_roadmap_okr_sync(workspace, actor=user)
    bindings = state.bindings or {}
    return {
        'source': {
            'name': 'Gravitas Roadmap',
            'page_url': ROADMAP_PAGE_URL,
            'source_url': state.source_url or ROADMAP_SOURCE_URL,
            'revision': state.source_revision,
        },
        'auto_sync': {
            'enabled': True,
            'interval_minutes': int(AUTO_SYNC_INTERVAL.total_seconds() // 60),
            'attempted_now': attempted,
        },
        'last_attempted_at': state.last_attempted_at.isoformat() if state.last_attempted_at else None,
        'last_synced_at': state.last_synced_at.isoformat() if state.last_synced_at else None,
        'last_error': state.last_error,
        'counts': {
            'objectives': len((bindings.get('objectives') or {})),
            'key_results': len((bindings.get('key_results') or {})),
        },
    }


@require_http_methods(['GET', 'POST'])
def roadmap_okr_sync(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)

    from .platform_runtime_v3 import core_access, core_role, ensure_platform_workspaces

    core = ensure_platform_workspaces(request.user)['core']
    if not core_access(request.user, core):
        return JsonResponse({'ok': False, 'error': 'core_workspace_for_internal_team_only'}, status=403)

    role = core_role(request.user, core)
    can_sync = request.user.is_superuser or role in {WorkspaceMembership.Role.OWNER, WorkspaceMembership.Role.ADMIN}
    if request.method == 'POST':
        if not can_sync:
            return JsonResponse({'ok': False, 'error': 'core_admin_required'}, status=403)
        try:
            result = sync_workspace_okr(core, actor=request.user)
        except Exception as exc:
            return JsonResponse({'ok': False, 'error': 'roadmap_sync_failed', 'detail': str(exc)}, status=502)
        return JsonResponse({'ok': True, 'sync': sync_status(core, request.user, auto=False), 'result': result, 'can_sync': can_sync})

    return JsonResponse({'ok': True, 'sync': sync_status(core, request.user, auto=True), 'can_sync': can_sync})
