import base64
import hashlib
import json
import logging
import os
import secrets
import uuid
from datetime import timedelta
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
    GoogleCalendarTaskEventLink,
    OperatingMeeting,
    OperatingTask,
)
from .workspace_api import _accessible_workspaces


logger = logging.getLogger(__name__)
GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
CALENDAR_API_ROOT = 'https://www.googleapis.com/calendar/v3'


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
        'scope': f'openid email profile {GOOGLE_CALENDAR_SCOPE}',
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


@require_http_methods(['DELETE'])
def google_calendar_disconnect(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    GoogleCalendarEventLink.objects.filter(user=request.user).delete()
    GoogleCalendarConnection.objects.filter(user=request.user).delete()
    return JsonResponse({'ok': True})
