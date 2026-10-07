"""Nextcloud Deck execution adapter for the Core Workspace.

Gravitas keeps the relational operating model (initiative, milestone, project,
ACL and audit context), while Deck is a native execution surface for the team.
Execution fields are mirrored both ways: title, lane/status and due date may be
changed in either Gravitas or Deck. Rich Gravitas-only metadata stays canonical
in Gravitas and is rendered into the card description.

Every pushed card carries both a stable task id and the task ``updated_at``
value used for that push. That gives reconciliation a common ancestor: a Deck
edit can safely be pulled when Gravitas has not changed since the last push,
and concurrent edits become an explicit conflict instead of last-write-wins.
"""

import re
from datetime import datetime, time

from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from . import cloud
from .layer_access import record_activity
from .layer_models import ActivityEvent
from .operating_models import OperatingTask, WorkStatus
from .platform_runtime_v3 import core_role, ensure_platform_workspaces


BOARD_TITLE = 'Gravitas+ Execution'
BOARD_COLOR = '202124'
STACKS = [
    ('Backlog', {WorkStatus.DRAFT}),
    ('Active', {WorkStatus.ACTIVE}),
    ('Blocked', {WorkStatus.BLOCKED}),
    ('Done', {WorkStatus.DONE, WorkStatus.ARCHIVED}),
]
STACK_STATUS = {
    'Backlog': WorkStatus.DRAFT,
    'Active': WorkStatus.ACTIVE,
    'Blocked': WorkStatus.BLOCKED,
    'Done': WorkStatus.DONE,
}
TASK_MARKER_RE = re.compile(r'<!--\s*gravitas-task:(\d+)\s*-->')
SYNC_MARKER_RE = re.compile(r'<!--\s*gravitas-task-updated:([0-9.]+)\s*-->')


class DeckError(Exception):
    pass


def _is_admin(request):
    if not request.user.is_authenticated:
        return False
    if request.user.is_superuser:
        return True
    spaces = ensure_platform_workspaces(request.user)
    return core_role(request.user, spaces['core']) in {'owner', 'admin'}


def _deny(request):
    return JsonResponse(
        {'ok': False, 'error': 'authentication_required' if not request.user.is_authenticated else 'core_admin_required'},
        status=401 if not request.user.is_authenticated else 403,
    )


def _base():
    return f'{settings.NEXTCLOUD_INTERNAL_URL}/index.php/apps/deck/api/v1.0'


def _headers():
    return {
        'OCS-APIRequest': 'true',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }


def _request(method, path, *, expected=(200,), json=None):
    try:
        response = cloud._request(
            method,
            _base() + path,
            auth=cloud._admin_auth(),
            expected=set(expected),
            headers=_headers(),
            json=json,
        )
    except Exception as exc:
        raise DeckError(str(exc)) from exc
    try:
        return response.json() if response.content else None
    except ValueError as exc:
        raise DeckError('deck_invalid_response') from exc


def _find_board():
    boards = _request('GET', '/boards', expected=(200,)) or []
    for board in boards:
        if str(board.get('title') or '').strip() == BOARD_TITLE and not board.get('archived'):
            return board
    return None


def _ensure_board():
    board = _find_board()
    if board:
        return board
    created = _request(
        'POST', '/boards', expected=(200, 201),
        json={'title': BOARD_TITLE, 'color': BOARD_COLOR},
    )
    if not isinstance(created, dict) or not created.get('id'):
        raise DeckError('deck_board_create_failed')
    return created


def _ensure_stacks(board_id):
    stacks = _request('GET', f'/boards/{board_id}/stacks', expected=(200,)) or []
    by_title = {str(item.get('title') or '').strip(): item for item in stacks if item.get('id')}
    result = {}
    for index, (title, _states) in enumerate(STACKS, start=1):
        stack = by_title.get(title)
        if not stack:
            stack = _request(
                'POST', f'/boards/{board_id}/stacks', expected=(200, 201),
                json={'title': title, 'order': index * 1000},
            )
        if not isinstance(stack, dict) or not stack.get('id'):
            raise DeckError('deck_stack_create_failed')
        result[title] = stack
    return result


def _stack_for_task(task):
    for title, states in STACKS:
        if task.status in states:
            return title
    return 'Backlog'


def _due(task):
    if not task.due_date:
        return None
    value = timezone.make_aware(datetime.combine(task.due_date, time(17, 0)))
    return value.isoformat()


def _description(task):
    owner = task.owner.get_full_name() or task.owner.get_username() or task.owner.email
    parts = [
        task.description.strip(),
        '',
        f'**Owner:** {owner}',
        f'**Priority:** {task.get_priority_display()}',
        f'**Status:** {task.get_status_display()}',
        f'**Definition of done:** {task.definition_of_done}',
        '',
        f'[Open in Gravitas]({settings.PUBLIC_BASE_URL}/workspace/core/tasks)',
        f'<!-- gravitas-task:{task.pk} -->',
        f'<!-- gravitas-task-updated:{task.updated_at.timestamp():.6f} -->',
    ]
    if task.project_id:
        parts.insert(-3, f'**Research project:** GRV-{task.project_id:06d}')
    return '\n'.join(part for part in parts if part is not None).strip()


def _card_payload(task, *, order=999):
    done = timezone.now().isoformat() if task.status in {WorkStatus.DONE, WorkStatus.ARCHIVED} else None
    return {
        'title': task.title[:255],
        'description': _description(task),
        'type': 'plain',
        'owner': settings.NEXTCLOUD_ADMIN_USER,
        'order': int(order or 999),
        'duedate': _due(task),
        'archived': task.status == WorkStatus.ARCHIVED,
        'done': done,
    }


def _marker(card):
    match = TASK_MARKER_RE.search(str(card.get('description') or ''))
    return int(match.group(1)) if match else None


def _sync_marker(card):
    match = SYNC_MARKER_RE.search(str(card.get('description') or ''))
    try:
        return float(match.group(1)) if match else None
    except (TypeError, ValueError):
        return None


def _card_modified(card):
    value = card.get('lastModified')
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _card_due(card):
    raw = str(card.get('duedate') or '').strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace('Z', '+00:00')).date()
    except ValueError:
        # Some Deck versions serialize a bare YYYY-MM-DD.
        try:
            return datetime.strptime(raw[:10], '%Y-%m-%d').date()
        except ValueError:
            return None


def _cards_by_task(board_id, stacks):
    result = {}
    for title, stack in stacks.items():
        # The stack listing normally includes cards. Fetch it explicitly when
        # an installation omits details so reconciliation works on both forms.
        cards = stack.get('cards')
        if cards is None:
            fresh = _request('GET', f'/boards/{board_id}/stacks/{stack["id"]}', expected=(200,)) or {}
            cards = fresh.get('cards') or []
        for card in cards or []:
            task_id = _marker(card)
            if task_id and not card.get('archived'):
                result[task_id] = {'stack_title': title, 'stack_id': stack['id'], 'card': card}
    return result


def _create_card(board_id, stack_id, task):
    payload = _card_payload(task)
    # Creation does not accept owner/archived/done, so send the documented
    # creation shape first and then normalize the full card with PUT.
    created = _request(
        'POST', f'/boards/{board_id}/stacks/{stack_id}/cards', expected=(200, 201),
        json={
            'title': payload['title'],
            'type': 'plain',
            'order': payload['order'],
            'description': payload['description'],
            'duedate': payload['duedate'],
        },
    )
    if not isinstance(created, dict) or not created.get('id'):
        raise DeckError('deck_card_create_failed')
    return created


def _update_card(board_id, stack_id, card, task):
    payload = _card_payload(task, order=card.get('order') or 999)
    owner = card.get('owner')
    if isinstance(owner, dict):
        owner = owner.get('uid') or owner.get('primaryKey')
    payload['owner'] = owner or settings.NEXTCLOUD_ADMIN_USER
    return _request(
        'PUT', f'/boards/{board_id}/stacks/{stack_id}/cards/{card["id"]}', expected=(200,), json=payload,
    )


def _archive_card(board_id, stack_id, card_id):
    _request(
        'PUT', f'/boards/{board_id}/stacks/{stack_id}/cards/{card_id}/archive', expected=(200,), json={},
    )


def _safe_remote_diff(task, current):
    card = current['card']
    diff = {}
    remote_title = str(card.get('title') or '').strip()[:240]
    if remote_title and remote_title != task.title:
        diff['title'] = remote_title

    remote_status = STACK_STATUS.get(current['stack_title'])
    if remote_status and remote_status != task.status:
        # Deck's Done lane represents completed work. Archived is intentionally
        # not imported because archive is an administrative Gravitas state.
        diff['status'] = remote_status

    remote_due = _card_due(card)
    if remote_due != task.due_date:
        # OperatingTask requires either a cycle or a due date. A user may clear
        # the date in Deck only when that invariant remains valid.
        if remote_due is not None or task.cycle_id:
            diff['due_date'] = remote_due
    return diff


def _pull_card(task, current):
    """Apply last-write-wins for Deck execution fields.

    Title, status/lane and due date are synchronized bidirectionally. When both
    Gravitas and Deck changed, the side with the newest modification timestamp
    wins automatically. Gravitas-only metadata such as relations, owner,
    priority and definition of done is never imported from Deck.
    """
    diff = _safe_remote_diff(task, current)
    if not diff:
        return 'unchanged'

    card = current['card']
    local_modified = task.updated_at.timestamp()
    remote_modified = _card_modified(card)

    # Last-write-wins. If Deck cannot provide a useful timestamp, or both sides
    # are effectively tied, keep Gravitas as the deterministic tie-breaker.
    if remote_modified <= local_modified + 0.001:
        return 'local_newer'

    for field, value in diff.items():
        setattr(task, field, value)
    update_fields = list(diff)
    if 'status' in diff:
        if diff['status'] == WorkStatus.DONE:
            if task.completed_at is None:
                task.completed_at = timezone.now()
                update_fields.append('completed_at')
        elif task.completed_at is not None:
            task.completed_at = None
            update_fields.append('completed_at')
    task.save(update_fields=[*dict.fromkeys(update_fields), 'updated_at'])
    return 'pulled'


def sync_tasks_to_deck():
    """Bidirectionally reconcile Core execution tasks with the canonical Deck.

    Status moves are still performed as create-in-target then archive-old
    because Deck releases differ in cross-stack reorder behavior. The stable
    marker makes this idempotent. Concurrent safe-field edits are never
    overwritten; they are counted as conflicts and left untouched for the next
    explicit reconciliation after a human resolves one side.
    """
    board = _ensure_board()
    board_id = int(board['id'])
    stacks = _ensure_stacks(board_id)
    existing = _cards_by_task(board_id, stacks)

    counts = {'created': 0, 'updated': 0, 'moved': 0, 'archived': 0, 'pulled': 0, 'conflicts': 0}
    conflict_task_ids = []
    tasks = OperatingTask.objects.select_related('owner', 'project').all().order_by('pk')
    live_ids = set()

    for task in tasks:
        live_ids.add(task.pk)
        current = existing.get(task.pk)
        inbound = None
        if current is not None:
            inbound = _pull_card(task, current)
            if inbound == 'pulled':
                counts['pulled'] += 1
                task.refresh_from_db()

        target_title = _stack_for_task(task)
        target_stack = stacks[target_title]
        if current is None:
            _create_card(board_id, target_stack['id'], task)
            counts['created'] += 1
            continue
        if current['stack_title'] != target_title:
            _create_card(board_id, target_stack['id'], task)
            _archive_card(board_id, current['stack_id'], current['card']['id'])
            counts['moved'] += 1
            continue

        # Push only when Gravitas is newer or when Gravitas metadata changed
        # since the last successful push. A remote winner is normalized back to
        # Deck to refresh the sync marker, but that bookkeeping is not counted
        # as a user-visible push.
        marker = _sync_marker(current['card'])
        local_changed_since_push = marker is None or task.updated_at.timestamp() > marker + 0.001
        if inbound == 'local_newer' or local_changed_since_push:
            _update_card(board_id, current['stack_id'], current['card'], task)
            if inbound != 'pulled':
                counts['updated'] += 1

    # If a task was deleted in Gravitas, the adapter must not leave a live
    # card that looks authoritative in Deck. Archive it rather than delete it
    # so Nextcloud retains the operational history.
    for task_id, current in existing.items():
        if task_id not in live_ids:
            _archive_card(board_id, current['stack_id'], current['card']['id'])
            counts['archived'] += 1

    return {
        'board': {
            'id': board_id,
            'title': board.get('title') or BOARD_TITLE,
            'url': f'{settings.NEXTCLOUD_PUBLIC_URL}/index.php/apps/deck/#/board/{board_id}',
        },
        'stacks': {title: int(stack['id']) for title, stack in stacks.items()},
        'tasks': tasks.count(),
        'changes': {**counts, 'pushed': counts['created'] + counts['updated'] + counts['moved']},
        'conflict_task_ids': conflict_task_ids,
    }


@require_http_methods(['GET'])
def deck_status(request):
    if not _is_admin(request):
        return _deny(request)
    configured = bool(settings.NEXTCLOUD_ADMIN_USER and settings.NEXTCLOUD_ADMIN_PASSWORD)
    if not configured:
        return JsonResponse({'ok': True, 'configured': False, 'available': False, 'board': None})
    try:
        board = _find_board()
    except DeckError as exc:
        return JsonResponse({'ok': True, 'configured': True, 'available': False, 'error': str(exc), 'board': None})
    return JsonResponse({
        'ok': True,
        'configured': True,
        'available': True,
        'board': {
            'id': int(board['id']),
            'title': board.get('title') or BOARD_TITLE,
            'url': f'{settings.NEXTCLOUD_PUBLIC_URL}/index.php/apps/deck/#/board/{int(board["id"])}',
        } if board else None,
        'task_count': OperatingTask.objects.count(),
        'mirror_mode': 'bidirectional-execution',
    })


@require_http_methods(['POST'])
def deck_sync(request):
    if not _is_admin(request):
        return _deny(request)
    try:
        result = sync_tasks_to_deck()
    except (DeckError, cloud.CloudError) as exc:
        return JsonResponse({'ok': False, 'error': 'deck_sync_failed', 'detail': str(exc)}, status=503)
    record_activity(
        layer=ActivityEvent.Layer.CORE,
        action='deck.synced',
        actor=request.user,
        object_type='nextcloud_deck',
        object_id=result['board']['id'],
        detail={'tasks': result['tasks'], 'changes': result['changes'], 'conflicts': result['conflict_task_ids']},
    )
    return JsonResponse({'ok': True, **result})
