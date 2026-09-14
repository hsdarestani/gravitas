"""Mirror Core workspace membership into the native Nextcloud Deck board.

The canonical execution board is owned by the Gravitas service account because
its lifecycle is managed server-side. Humans should still use it with their own
SSO identity. A dedicated ``gravitas-core`` Nextcloud group is therefore kept
in lock-step with the canonical Core workspace membership and that group gets
edit access to the board.
"""

import json
from urllib.parse import quote

from django.conf import settings
from django.http import JsonResponse

from . import cloud
from .models import WorkspaceMembership
from .nextcloud_bridge import ensure_user
from .nextcloud_deck import _request, deck_sync as _deck_sync
from .platform_models import WorkspaceProfile


CORE_GROUP_ID = 'gravitas-core'


class DeckAccessError(Exception):
    pass


def _core_workspace():
    profile = (
        WorkspaceProfile.objects.select_related('workspace')
        .filter(purpose=WorkspaceProfile.Purpose.CORE)
        .order_by('-is_default', 'workspace_id')
        .first()
    )
    return profile.workspace if profile else None


def _group_users(group_id):
    response = cloud._request(
        'GET',
        f'{settings.NEXTCLOUD_INTERNAL_URL}/ocs/v1.php/cloud/groups/{quote(group_id, safe="")}/users',
        auth=cloud._admin_auth(),
        expected={200},
        headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
        params={'format': 'json'},
    )
    payload = cloud._ocs_data(response, 'Could not list Core cloud group users') or {}
    if isinstance(payload, dict):
        users = payload.get('users') or []
    else:
        users = payload if isinstance(payload, list) else []
    result = set()
    for item in users:
        if isinstance(item, str):
            result.add(item)
        elif isinstance(item, dict):
            value = item.get('id') or item.get('uid') or item.get('name')
            if value:
                result.add(str(value))
    return result


def _participant_id(acl):
    participant = acl.get('participant') if isinstance(acl, dict) else None
    if isinstance(participant, str):
        return participant
    if isinstance(participant, dict):
        return str(participant.get('uid') or participant.get('primaryKey') or participant.get('id') or '')
    return ''


def _participant_type(acl):
    try:
        return int(acl.get('type'))
    except (TypeError, ValueError, AttributeError):
        return None


def ensure_core_deck_access(board_id):
    """Make the Core Deck board available to exactly the Core team identities."""
    workspace = _core_workspace()
    if workspace is None:
        raise DeckAccessError('core_workspace_missing')

    cloud.ensure_group(CORE_GROUP_ID)
    memberships = (
        WorkspaceMembership.objects.filter(workspace=workspace)
        .select_related('user')
        .order_by('user_id')
    )
    desired = set()
    for membership in memberships:
        if not membership.user.is_active:
            continue
        identity = ensure_user(membership.user)
        desired.add(identity.username)
        cloud.add_user_to_group(identity.username, CORE_GROUP_ID)

    # This group is dedicated to the Core workspace. Remove identities whose
    # Core membership was revoked so native Deck access never lingers after
    # Gravitas access has been removed.
    existing = _group_users(CORE_GROUP_ID)
    service_user = settings.NEXTCLOUD_ADMIN_USER
    for username in sorted(existing - desired - ({service_user} if service_user else set())):
        cloud.remove_user_from_group(username, CORE_GROUP_ID)

    board = _request('GET', f'/boards/{int(board_id)}', expected=(200,)) or {}
    acl = board.get('acl') or []
    group_acl = next(
        (
            entry for entry in acl
            if _participant_type(entry) == 1 and _participant_id(entry) == CORE_GROUP_ID
        ),
        None,
    )
    permissions = {
        'permissionEdit': True,
        'permissionShare': False,
        'permissionManage': False,
    }
    if group_acl is None:
        _request(
            'POST', f'/boards/{int(board_id)}/acl', expected=(200,),
            json={'type': 1, 'participant': CORE_GROUP_ID, **permissions},
        )
    else:
        acl_id = group_acl.get('id')
        needs_update = any(bool(group_acl.get(key)) != value for key, value in permissions.items())
        if acl_id and needs_update:
            _request(
                'PUT', f'/boards/{int(board_id)}/acl/{int(acl_id)}', expected=(200,), json=permissions,
            )

    return {
        'group_id': CORE_GROUP_ID,
        'workspace_id': workspace.pk,
        'member_count': len(desired),
        'usernames': sorted(desired),
    }


def deck_sync_with_access(request):
    """Run the existing task reconciliation and the membership mirror together.

    The Core Admin button must mean "reconcile Deck", not only "reconcile
    cards". The periodic timer already does both; this wrapper gives the manual
    endpoint the exact same contract without creating an import cycle inside
    the low-level Deck adapter.
    """
    response = _deck_sync(request)
    if response.status_code != 200:
        return response
    try:
        payload = json.loads(response.content.decode('utf-8'))
        board_id = int(payload['board']['id'])
        payload['access'] = ensure_core_deck_access(board_id)
    except Exception as exc:
        return JsonResponse(
            {'ok': False, 'error': 'deck_access_sync_failed', 'detail': str(exc)},
            status=503,
        )
    return JsonResponse(payload)
