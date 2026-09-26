import base64
import hashlib
import json
import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote, urlencode

import requests
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.http import FileResponse, HttpResponseRedirect, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .operating_models import (
    GoogleCalendarConnection,
    GoogleCalendarEventLink,
    GoogleCalendarMeetingAttachment,
    GoogleCalendarMeetingMinute,
    GoogleTaskLink,
    OperatingMeeting,
    OperatingTask,
)
from .workspace_api import _accessible_workspaces


logger = logging.getLogger(__name__)
GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
CALENDAR_API_ROOT = 'https://www.googleapis.com/calendar/v3'
TASKS_API_ROOT = 'https://tasks.googleapis.com/tasks/v1'


class GoogleCalendarError(RuntimeError):
    pass


def _fernet():
    digest = hashlib.sha256(settings.SECRET_KEY.encode('utf-8')).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_refresh_token(value):
    return _fernet().encrypt(str(value).encode('utf-8')).decode('ascii')


def decrypt_refresh_token(value):
    try:
        return _fernet().decrypt(str(value).encode('ascii')).decode('utf-8')
    except (InvalidToken, ValueError, TypeError) as exc:
        raise GoogleCalendarError('calendar_token_unreadable') from exc


def _safe_next(value):
    value = str(value or '').strip()
    if not value.startswith('/workspace'):
        return '/workspace/core/tasks'
    if value.startswith('//') or '\\' in value:
        return '/workspace/core/tasks'
    return value[:1200]


def google_calendar_connect(request):
    if not request.user.is_authenticated:
        return HttpResponseRedirect('/login')
    client_id = str(getattr(settings, 'GOOGLE_OAUTH_CLIENT_ID', '') or '').strip()
    if not client_id:
        return HttpResponseRedirect('/workspace/core/tasks?calendar_error=not_configured')

    state = secrets.token_urlsafe(32)
    request.session['google_oauth_state'] = state
    request.session['google_oauth_flow'] = 'calendar'
    request.session['google_calendar_next'] = _safe_next(request.GET.get('next'))
    params = {
        'client_id': client_id,
        'redirect_uri': settings.GOOGLE_OAUTH_REDIRECT_URI,
        'response_type': 'code',
        'scope': f'openid email profile {GOOGLE_CALENDAR_SCOPE} {GOOGLE_TASKS_SCOPE}',
        'state': state,
        'access_type': 'offline',
        'prompt': 'consent',
        'include_granted_scopes': 'true',
    }
    return HttpResponseRedirect(
        'https://accounts.google.com/o/oauth2/v2/auth?' + urlencode(params)
    )


def finish_calendar_oauth(user, info, token_data):
    if not user or not user.is_authenticated:
        raise GoogleCalendarError('calendar_authentication_required')
    email = str((info or {}).get('email') or '').strip().lower()
    refresh_token = str((token_data or {}).get('refresh_token') or '').strip()
    connection = GoogleCalendarConnection.objects.filter(user=user).first()
    if not refresh_token and not connection:
        raise GoogleCalendarError('calendar_refresh_token_missing')

    defaults = {
        'google_email': email,
        'calendar_id': (connection.calendar_id if connection else 'primary'),
    }
    if refresh_token:
        defaults['refresh_token_encrypted'] = encrypt_refresh_token(refresh_token)
    elif connection:
        defaults['refresh_token_encrypted'] = connection.refresh_token_encrypted
    connection, _ = GoogleCalendarConnection.objects.update_or_create(
        user=user,
        defaults=defaults,
    )
    return connection


def _access_token(connection):
    response = requests.post(
        TOKEN_URL,
        data={
            'client_id': settings.GOOGLE_OAUTH_CLIENT_ID,
            'client_secret': settings.GOOGLE_OAUTH_CLIENT_SECRET,
            'refresh_token': decrypt_refresh_token(connection.refresh_token_encrypted),
            'grant_type': 'refresh_token',
        },
        timeout=(5, 20),
    )
    try:
        response.raise_for_status()
        access_token = str(response.json().get('access_token') or '')
    except (requests.RequestException, ValueError, TypeError) as exc:
        raise GoogleCalendarError('calendar_token_refresh_failed') from exc
    if not access_token:
        raise GoogleCalendarError('calendar_access_token_missing')
    return access_token


def _meeting_for_user(user, meeting_id):
    return (
        OperatingMeeting.objects
        .select_related('workspace', 'owner')
        .filter(pk=meeting_id, workspace__in=_accessible_workspaces(user))
        .first()
    )


def _event_payload(meeting):
    action_items = list(
        meeting.action_items.select_related('owner')
        .exclude(status='archived')
        .order_by('due_date', 'id')[:40]
    )
    description = ['Gravitas+ meeting']
    if meeting.notes:
        description.extend(['', meeting.notes.strip()])
    if meeting.decisions:
        description.extend(['', 'Decisions', meeting.decisions.strip()])
    if action_items:
        description.extend(['', 'Linked tasks'])
        for task in action_items:
            owner = task.owner.get_full_name() or task.owner.email
            due = task.due_date.isoformat() if task.due_date else 'no due date'
            description.append(f'• {task.title} — {owner} — {due}')

    start = meeting.scheduled_for
    end = start + timedelta(minutes=max(1, int(meeting.duration_minutes or 60)))
    return {
        'summary': meeting.title,
        'description': '\n'.join(description),
        'start': {'dateTime': start.isoformat()},
        'end': {'dateTime': end.isoformat()},
        'extendedProperties': {
            'private': {
                'gravitas_meeting_id': str(meeting.pk),
                'gravitas_workspace_id': str(meeting.workspace_id),
            },
        },
    }


def sync_meeting_to_google(user, meeting):
    connection = GoogleCalendarConnection.objects.filter(user=user).first()
    if not connection:
        raise GoogleCalendarError('calendar_not_connected')
    token = _access_token(connection)
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
    calendar_id = connection.calendar_id or 'primary'
    link = GoogleCalendarEventLink.objects.filter(user=user, meeting=meeting).first()
    payload = _event_payload(meeting)

    response = None
    if link:
        event_url = (
            f'{CALENDAR_API_ROOT}/calendars/{quote(calendar_id, safe="")}/events/'
            f'{quote(link.event_id, safe="")}'
        )
        response = requests.put(event_url, headers=headers, json=payload, timeout=(5, 20))
        if response.status_code == 404:
            link.delete()
            link = None

    if not link:
        event_url = f'{CALENDAR_API_ROOT}/calendars/{quote(calendar_id, safe="")}/events'
        response = requests.post(event_url, headers=headers, json=payload, timeout=(5, 20))

    try:
        response.raise_for_status()
        event = response.json()
    except (requests.RequestException, ValueError, TypeError) as exc:
        logger.warning('Google Calendar sync failed for meeting %s', meeting.pk)
        raise GoogleCalendarError('calendar_sync_failed') from exc

    event_id = str(event.get('id') or '')
    if not event_id:
        raise GoogleCalendarError('calendar_event_id_missing')
    link, _ = GoogleCalendarEventLink.objects.update_or_create(
        user=user,
        meeting=meeting,
        defaults={
            'calendar_id': calendar_id,
            'event_id': event_id,
            'html_link': str(event.get('htmlLink') or ''),
        },
    )
    return link


def sync_existing_meeting_links(meeting):
    for link in list(meeting.google_calendar_links.select_related('user').all()):
        try:
            sync_meeting_to_google(link.user, meeting)
        except Exception:
            logger.exception(
                'Could not refresh linked Google Calendar event meeting_id=%s user_id=%s',
                meeting.pk,
                link.user_id,
            )


def delete_existing_meeting_events(meeting):
    links = list(meeting.google_calendar_links.select_related('user').all())
    for link in links:
        connection = GoogleCalendarConnection.objects.filter(user=link.user).first()
        if not connection:
            continue
        try:
            token = _access_token(connection)
            url = (
                f'{CALENDAR_API_ROOT}/calendars/{quote(link.calendar_id or "primary", safe="")}/events/'
                f'{quote(link.event_id, safe="")}'
            )
            response = requests.delete(
                url,
                headers={'Authorization': f'Bearer {token}'},
                timeout=(5, 20),
            )
            if response.status_code not in (204, 404):
                response.raise_for_status()
        except Exception:
            logger.exception(
                'Could not remove linked Google Calendar event meeting_id=%s user_id=%s',
                meeting.pk,
                link.user_id,
            )


@require_http_methods(['GET'])
def google_calendar_status(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    connection = GoogleCalendarConnection.objects.filter(user=request.user).first()
    result = {
        'ok': True,
        'connected': bool(connection),
        'google_email': connection.google_email if connection else '',
        'calendar_id': connection.calendar_id if connection else '',
        'event': None,
    }
    meeting_id = request.GET.get('meeting_id')
    if meeting_id:
        try:
            meeting_id = int(meeting_id)
        except (TypeError, ValueError):
            return JsonResponse({'ok': False, 'error': 'invalid_meeting'}, status=400)
        meeting = _meeting_for_user(request.user, meeting_id)
        if not meeting:
            return JsonResponse({'ok': False, 'error': 'meeting_not_found'}, status=404)
        link = GoogleCalendarEventLink.objects.filter(
            user=request.user,
            meeting=meeting,
        ).first()
        if link:
            result['event'] = {
                'event_id': link.event_id,
                'html_link': link.html_link,
                'synced_at': link.updated_at.isoformat(),
            }
    return JsonResponse(result)


@require_http_methods(['POST'])
def google_calendar_meeting_sync(request, meeting_id):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    meeting = _meeting_for_user(request.user, meeting_id)
    if not meeting:
        return JsonResponse({'ok': False, 'error': 'meeting_not_found'}, status=404)
    try:
        link = sync_meeting_to_google(request.user, meeting)
    except GoogleCalendarError as exc:
        error = str(exc)
        status = 409 if error == 'calendar_not_connected' else 502
        return JsonResponse({'ok': False, 'error': error}, status=status)
    return JsonResponse({
        'ok': True,
        'event': {
            'event_id': link.event_id,
            'html_link': link.html_link,
            'synced_at': link.updated_at.isoformat(),
        },
    })


def _core_workspace(request):
    from . import operating_api as operating
    return operating._workspace(request)


def _can_edit_core(request, workspace):
    from . import operating_api as operating
    return bool(workspace and operating._editable(request, workspace))


def _task_for_user(user, task_id):
    return (
        OperatingTask.objects
        .select_related('workspace', 'owner', 'initiative__key_result__objective')
        .filter(pk=task_id, workspace__in=_accessible_workspaces(user))
        .first()
    )


def _provider_failure(response, default='calendar_provider_error'):
    try:
        detail = response.json()
    except (ValueError, TypeError):
        detail = {}
    message = str(
        ((detail.get('error') or {}).get('message') if isinstance(detail.get('error'), dict) else '')
        or detail.get('error_description')
        or ''
    ).strip()
    logger.warning(
        'Google Calendar provider error status=%s message=%s',
        response.status_code,
        message[:500],
    )
    if response.status_code == 401:
        raise GoogleCalendarError('calendar_reconnect_required')
    if response.status_code == 403:
        raise GoogleCalendarError('calendar_permission_denied')
    raise GoogleCalendarError(default)


def _google_task_payload(task):
    if not task.due_date:
        raise GoogleCalendarError('task_due_date_required')
    owner = task.owner.get_full_name() or task.owner.email
    notes = [
        'Gravitas+ task',
        '',
        f'Owner: {owner}',
        f'Status: {task.status}',
    ]
    if task.description:
        notes.extend(['', task.description.strip()])
    if task.definition_of_done:
        notes.extend(['', 'Definition of done', task.definition_of_done.strip()])
    task_url = f'{str(getattr(settings, "PUBLIC_BASE_URL", "") or "").rstrip("/")}/workspace/core/tasks?task={task.pk}'
    if task_url.startswith('http'):
        notes.extend(['', task_url])

    payload = {
        'title': task.title,
        'notes': '\n'.join(notes),
        # Google Tasks stores a due *date* even though its API uses RFC3339.
        'due': f'{task.due_date.isoformat()}T00:00:00.000Z',
        'status': 'completed' if task.status == 'done' else 'needsAction',
    }
    if task.status == 'done':
        completed = task.completed_at or timezone.now()
        payload['completed'] = completed.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
    return payload


def sync_task_to_google(user, task):
    connection = GoogleCalendarConnection.objects.filter(user=user).first()
    if not connection:
        raise GoogleCalendarError('calendar_not_connected')
    token = _access_token(connection)
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
    link = GoogleTaskLink.objects.filter(user=user, task=task).first()
    tasklist_id = link.tasklist_id if link else '@default'
    payload = _google_task_payload(task)

    response = None
    if link:
        task_url = (
            f'{TASKS_API_ROOT}/lists/{quote(tasklist_id, safe="@")}/tasks/'
            f'{quote(link.google_task_id, safe="")}'
        )
        response = requests.patch(task_url, headers=headers, json=payload, timeout=(5, 20))
        if response.status_code == 404:
            link.delete()
            link = None
        elif not response.ok:
            _provider_failure(response, 'google_task_sync_failed')

    if not link:
        tasklist_id = '@default'
        task_url = f'{TASKS_API_ROOT}/lists/{quote(tasklist_id, safe="@")}/tasks'
        response = requests.post(task_url, headers=headers, json=payload, timeout=(5, 20))
        if not response.ok:
            _provider_failure(response, 'google_task_sync_failed')

    try:
        google_task = response.json()
    except (ValueError, TypeError) as exc:
        raise GoogleCalendarError('google_task_sync_failed') from exc

    google_task_id = str(google_task.get('id') or '')
    if not google_task_id:
        raise GoogleCalendarError('google_task_id_missing')
    link, _ = GoogleTaskLink.objects.update_or_create(
        user=user,
        task=task,
        defaults={
            'tasklist_id': tasklist_id,
            'google_task_id': google_task_id,
        },
    )
    return link


def sync_existing_task_links(task):
    for link in list(task.google_task_links.select_related('user').all()):
        try:
            sync_task_to_google(link.user, task)
        except Exception:
            logger.exception(
                'Could not refresh native Google Task task_id=%s user_id=%s',
                task.pk,
                link.user_id,
            )


def delete_existing_task_events(task):
    links = list(task.google_task_links.select_related('user').all())
    for link in links:
        connection = GoogleCalendarConnection.objects.filter(user=link.user).first()
        if not connection:
            continue
        try:
            token = _access_token(connection)
            url = (
                f'{TASKS_API_ROOT}/lists/{quote(link.tasklist_id or "@default", safe="@")}/tasks/'
                f'{quote(link.google_task_id, safe="")}'
            )
            response = requests.delete(
                url,
                headers={'Authorization': f'Bearer {token}'},
                timeout=(5, 20),
            )
            if response.status_code not in (204, 404) and not response.ok:
                _provider_failure(response, 'google_task_delete_failed')
        except Exception:
            logger.exception(
                'Could not remove native Google Task task_id=%s user_id=%s',
                task.pk,
                link.user_id,
            )


def _task_link_json(link):
    return {
        'google_task_id': link.google_task_id,
        'tasklist_id': link.tasklist_id,
        'calendar_url': 'https://calendar.google.com/calendar/u/0/r/tasks',
        'synced_at': link.updated_at.isoformat(),
    } if link else None


@require_http_methods(['GET'])
def google_calendar_task_status(request, task_id):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    task = _task_for_user(request.user, task_id)
    if not task:
        return JsonResponse({'ok': False, 'error': 'task_not_found'}, status=404)
    connection = GoogleCalendarConnection.objects.filter(user=request.user).first()
    link = GoogleTaskLink.objects.filter(user=request.user, task=task).first()
    return JsonResponse({
        'ok': True,
        'connected': bool(connection),
        'google_email': connection.google_email if connection else '',
        'google_task': _task_link_json(link),
    })


@require_http_methods(['POST'])
def google_calendar_task_sync(request, task_id):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    task = _task_for_user(request.user, task_id)
    if not task:
        return JsonResponse({'ok': False, 'error': 'task_not_found'}, status=404)
    try:
        link = sync_task_to_google(request.user, task)
    except GoogleCalendarError as exc:
        error = str(exc)
        status = 409 if error in ('calendar_not_connected', 'task_due_date_required') else 502
        return JsonResponse({'ok': False, 'error': error}, status=status)
    return JsonResponse({'ok': True, 'google_task': _task_link_json(link)})


def _event_moment(value):
    from django.utils.dateparse import parse_date, parse_datetime

    if not isinstance(value, dict):
        return None
    raw = str(value.get('dateTime') or '').strip()
    if raw:
        return parse_datetime(raw)
    raw_date = str(value.get('date') or '').strip()
    day = parse_date(raw_date) if raw_date else None
    if not day:
        return None
    return timezone.make_aware(datetime.combine(day, datetime.min.time()), timezone.get_current_timezone())


def _minute_json(minute):
    if not minute:
        return None
    return {
        'id': minute.pk,
        'ical_uid': minute.ical_uid,
        'notes': minute.notes,
        'reference_url': minute.reference_url,
        'updated_at': minute.updated_at.isoformat(),
        'updated_by': {
            'id': minute.updated_by_id,
            'name': minute.updated_by.get_full_name() or minute.updated_by.email,
            'email': minute.updated_by.email,
        } if minute.updated_by else None,
        'attachments': [
            {
                'id': row.pk,
                'name': row.name,
                'mime_type': row.mime_type,
                'size': row.size,
                'created_at': row.created_at.isoformat(),
                'download_url': f'/api/calendar/google/minutes/{minute.pk}/attachments/{row.pk}/download/',
            }
            for row in minute.attachments.select_related('uploader').all()
        ],
    }


def _event_json(event, minute=None):
    conference_link = str(event.get('hangoutLink') or '')
    if not conference_link:
        for entry in ((event.get('conferenceData') or {}).get('entryPoints') or []):
            if entry.get('entryPointType') == 'video' and entry.get('uri'):
                conference_link = str(entry.get('uri'))
                break
    attendees = []
    for row in (event.get('attendees') or [])[:40]:
        attendees.append({
            'email': str(row.get('email') or ''),
            'name': str(row.get('displayName') or ''),
            'response_status': str(row.get('responseStatus') or ''),
            'self': bool(row.get('self')),
        })
    return {
        'id': str(event.get('id') or ''),
        'ical_uid': str(event.get('iCalUID') or event.get('id') or ''),
        'title': str(event.get('summary') or 'Untitled meeting'),
        'status': str(event.get('status') or ''),
        'html_link': str(event.get('htmlLink') or ''),
        'location': str(event.get('location') or ''),
        'description': str(event.get('description') or ''),
        'conference_link': conference_link,
        'start': event.get('start') or {},
        'end': event.get('end') or {},
        'organizer': event.get('organizer') or {},
        'attendees': attendees,
        'minute': _minute_json(minute),
    }


def _list_google_events(connection):
    token = _access_token(connection)
    headers = {'Authorization': f'Bearer {token}'}
    now = timezone.now()
    params = {
        'singleEvents': 'true',
        'orderBy': 'startTime',
        'showDeleted': 'false',
        'maxResults': '250',
        'timeMin': (now - timedelta(days=120)).isoformat(),
        'timeMax': (now + timedelta(days=240)).isoformat(),
    }
    calendar_id = connection.calendar_id or 'primary'
    url = f'{CALENDAR_API_ROOT}/calendars/{quote(calendar_id, safe="")}/events'
    events = []
    for _ in range(4):
        response = requests.get(url, headers=headers, params=params, timeout=(5, 25))
        if not response.ok:
            _provider_failure(response, 'calendar_events_failed')
        try:
            payload = response.json()
        except (ValueError, TypeError) as exc:
            raise GoogleCalendarError('calendar_events_failed') from exc
        for event in payload.get('items') or []:
            private = ((event.get('extendedProperties') or {}).get('private') or {})
            if private.get('gravitas_task_id'):
                continue
            if event.get('status') == 'cancelled':
                continue
            events.append(event)
        token_value = str(payload.get('nextPageToken') or '')
        if not token_value:
            break
        params['pageToken'] = token_value
    return events


@require_http_methods(['GET'])
def google_calendar_events(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    workspace = _core_workspace(request)
    if not workspace:
        return JsonResponse({'ok': False, 'error': 'core_workspace_required'}, status=403)
    connection = GoogleCalendarConnection.objects.filter(user=request.user).first()
    if not connection:
        return JsonResponse({
            'ok': True,
            'connected': False,
            'google_email': '',
            'events': [],
        })
    try:
        events = _list_google_events(connection)
    except GoogleCalendarError as exc:
        return JsonResponse({
            'ok': False,
            'error': str(exc),
            'connected': True,
            'google_email': connection.google_email,
        }, status=502)

    uids = [str(event.get('iCalUID') or event.get('id') or '') for event in events]
    minutes = {
        row.ical_uid: row
        for row in GoogleCalendarMeetingMinute.objects.filter(
            workspace=workspace,
            ical_uid__in=[uid for uid in uids if uid],
        ).select_related('updated_by').prefetch_related('attachments')
    }
    return JsonResponse({
        'ok': True,
        'connected': True,
        'google_email': connection.google_email,
        'calendar_id': connection.calendar_id,
        'events': [
            _event_json(event, minutes.get(str(event.get('iCalUID') or event.get('id') or '')))
            for event in events
        ],
    })


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _google_event(connection, event_id):
    token = _access_token(connection)
    calendar_id = connection.calendar_id or 'primary'
    url = (
        f'{CALENDAR_API_ROOT}/calendars/{quote(calendar_id, safe="")}/events/'
        f'{quote(str(event_id), safe="")}'
    )
    response = requests.get(url, headers={'Authorization': f'Bearer {token}'}, timeout=(5, 20))
    if not response.ok:
        _provider_failure(response, 'calendar_event_lookup_failed')
    try:
        return response.json()
    except (ValueError, TypeError) as exc:
        raise GoogleCalendarError('calendar_event_lookup_failed') from exc


@require_http_methods(['POST'])
def google_calendar_minutes(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    workspace = _core_workspace(request)
    if not workspace:
        return JsonResponse({'ok': False, 'error': 'core_workspace_required'}, status=403)
    if not _can_edit_core(request, workspace):
        return JsonResponse({'ok': False, 'error': 'permission_denied'}, status=403)
    connection = GoogleCalendarConnection.objects.filter(user=request.user).first()
    if not connection:
        return JsonResponse({'ok': False, 'error': 'calendar_not_connected'}, status=409)
    payload = _body(request)
    event_id = str(payload.get('event_id') or '').strip()
    if not event_id:
        return JsonResponse({'ok': False, 'error': 'event_id_required'}, status=400)
    notes = str(payload.get('notes') or '').strip()
    reference_url = str(payload.get('reference_url') or '').strip()
    if len(notes) > 100000:
        return JsonResponse({'ok': False, 'error': 'notes_too_long'}, status=400)
    if reference_url and (
        len(reference_url) > 1600
        or not (reference_url.startswith('https://') or reference_url.startswith('http://'))
    ):
        return JsonResponse({'ok': False, 'error': 'invalid_reference_url'}, status=400)
    try:
        event = _google_event(connection, event_id)
    except GoogleCalendarError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=502)

    private = ((event.get('extendedProperties') or {}).get('private') or {})
    if private.get('gravitas_task_id'):
        return JsonResponse({'ok': False, 'error': 'task_event_not_meeting'}, status=400)
    ical_uid = str(event.get('iCalUID') or event.get('id') or '').strip()
    if not ical_uid:
        return JsonResponse({'ok': False, 'error': 'calendar_event_uid_missing'}, status=502)

    minute, _ = GoogleCalendarMeetingMinute.objects.update_or_create(
        workspace=workspace,
        ical_uid=ical_uid,
        defaults={
            'google_event_id': str(event.get('id') or ''),
            'title': str(event.get('summary') or '')[:500],
            'start_at': _event_moment(event.get('start')),
            'end_at': _event_moment(event.get('end')),
            'notes': notes,
            'reference_url': reference_url,
            'updated_by': request.user,
        },
    )
    return JsonResponse({'ok': True, 'minute': _minute_json(minute)})


def _minute_for_request(request, minute_id):
    workspace = _core_workspace(request)
    if not workspace:
        return None, None
    minute = (
        GoogleCalendarMeetingMinute.objects
        .select_related('workspace', 'updated_by')
        .filter(pk=minute_id, workspace=workspace)
        .first()
    )
    return workspace, minute


def _safe_filename(value):
    name = Path(str(value or '')).name.strip() or 'file'
    safe = ''.join(ch if ch.isalnum() or ch in '._ -' else '_' for ch in name)
    return safe[:255] or 'file'


@require_http_methods(['GET', 'POST'])
def google_calendar_minute_attachments(request, minute_id):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    workspace, minute = _minute_for_request(request, minute_id)
    if not workspace:
        return JsonResponse({'ok': False, 'error': 'core_workspace_required'}, status=403)
    if not minute:
        return JsonResponse({'ok': False, 'error': 'minute_not_found'}, status=404)

    if request.method == 'GET':
        return JsonResponse({'ok': True, 'attachments': (_minute_json(minute) or {}).get('attachments', [])})

    if not _can_edit_core(request, workspace):
        return JsonResponse({'ok': False, 'error': 'permission_denied'}, status=403)
    uploaded = request.FILES.get('file')
    if not uploaded:
        return JsonResponse({'ok': False, 'error': 'file_required'}, status=400)
    if uploaded.size <= 0 or uploaded.size > settings.CONTENT_ATTACHMENT_MAX_BYTES:
        return JsonResponse({
            'ok': False,
            'error': 'file_size_invalid',
            'max_bytes': settings.CONTENT_ATTACHMENT_MAX_BYTES,
        }, status=413)

    name = _safe_filename(uploaded.name)
    root = Path(settings.CORE_UPLOAD_ROOT) / 'meeting-minutes' / str(minute.pk)
    root.mkdir(parents=True, exist_ok=True)
    file_path = root / f'{uuid.uuid4().hex}-{name}'
    with file_path.open('wb') as handle:
        for chunk in uploaded.chunks():
            handle.write(chunk)

    row = GoogleCalendarMeetingAttachment.objects.create(
        minute=minute,
        uploader=request.user,
        name=name,
        storage_path=str(file_path),
        mime_type=(uploaded.content_type or '')[:160],
        size=uploaded.size,
    )
    return JsonResponse({
        'ok': True,
        'attachment': {
            'id': row.pk,
            'name': row.name,
            'mime_type': row.mime_type,
            'size': row.size,
            'created_at': row.created_at.isoformat(),
            'download_url': f'/api/calendar/google/minutes/{minute.pk}/attachments/{row.pk}/download/',
        },
    }, status=201)


@require_http_methods(['GET'])
def google_calendar_minute_attachment_download(request, minute_id, attachment_id):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    _, minute = _minute_for_request(request, minute_id)
    if not minute:
        return JsonResponse({'ok': False, 'error': 'minute_not_found'}, status=404)
    row = GoogleCalendarMeetingAttachment.objects.filter(pk=attachment_id, minute=minute).first()
    if not row or not os.path.isfile(row.storage_path):
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    return FileResponse(open(row.storage_path, 'rb'), as_attachment=True, filename=row.name)


@require_http_methods(['DELETE'])
def google_calendar_minute_attachment_delete(request, minute_id, attachment_id):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    workspace, minute = _minute_for_request(request, minute_id)
    if not workspace:
        return JsonResponse({'ok': False, 'error': 'core_workspace_required'}, status=403)
    if not minute:
        return JsonResponse({'ok': False, 'error': 'minute_not_found'}, status=404)
    if not _can_edit_core(request, workspace):
        return JsonResponse({'ok': False, 'error': 'permission_denied'}, status=403)
    row = GoogleCalendarMeetingAttachment.objects.filter(pk=attachment_id, minute=minute).first()
    if not row:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    file_path = row.storage_path
    row.delete()
    try:
        os.remove(file_path)
    except FileNotFoundError:
        pass
    return JsonResponse({'ok': True})


@require_http_methods(['DELETE'])
def google_calendar_disconnect(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    GoogleCalendarEventLink.objects.filter(user=request.user).delete()
    GoogleTaskLink.objects.filter(user=request.user).delete()
    GoogleCalendarConnection.objects.filter(user=request.user).delete()
    return JsonResponse({'ok': True})
