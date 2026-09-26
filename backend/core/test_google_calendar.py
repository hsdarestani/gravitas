import json
from datetime import date, timedelta
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from .google_calendar_api import (
    GOOGLE_CALENDAR_SCOPE,
    GOOGLE_TASKS_SCOPE,
    decrypt_refresh_token,
    encrypt_refresh_token,
)
from .operating_models import (
    GoogleCalendarConnection,
    GoogleCalendarEventLink,
    GoogleCalendarMeetingMinute,
    GoogleTaskLink,
    Initiative,
    KeyResult,
    OperatingMeeting,
    OperatingProcess,
    OperatingTask,
    StrategicObjective,
)
from .platform_runtime_v3 import ensure_platform_workspaces


User = get_user_model()


@override_settings(
    GOOGLE_OAUTH_CLIENT_ID='calendar-test.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET='calendar-secret',
    GOOGLE_OAUTH_REDIRECT_URI='https://gravitasplus.com/api/auth/google/callback/',
    PUBLIC_BASE_URL='https://gravitasplus.com',
)
class GoogleCalendarIntegrationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='calendar@gravitas.test',
            email='calendar@gravitas.test',
            password='Calendar-secure-password-123!',
        )
        self.workspace = ensure_platform_workspaces(self.user)['core']
        self.client.force_login(self.user)

    def test_calendar_connect_requests_offline_calendar_scope(self):
        response = self.client.get(
            '/api/calendar/google/connect/',
            {'next': '/workspace/core/tasks?calendar_task=44'},
            secure=True,
        )
        self.assertEqual(response.status_code, 302)
        parsed = urlparse(response['Location'])
        query = parse_qs(parsed.query)
        self.assertEqual(parsed.netloc, 'accounts.google.com')
        self.assertIn(GOOGLE_CALENDAR_SCOPE, query['scope'][0])
        self.assertIn(GOOGLE_TASKS_SCOPE, query['scope'][0])
        self.assertEqual(query['access_type'], ['offline'])
        self.assertEqual(query['prompt'], ['consent'])
        self.assertEqual(
            query['redirect_uri'],
            ['https://gravitasplus.com/api/auth/google/callback/'],
        )
        session = self.client.session
        self.assertEqual(session['google_oauth_flow'], 'calendar')
        self.assertEqual(
            session['google_calendar_next'],
            '/workspace/core/tasks?calendar_task=44',
        )

    @patch('core.views.requests.get')
    @patch('core.views.requests.post')
    def test_calendar_oauth_callback_keeps_login_flow_separate_and_saves_refresh_token(
        self,
        token_post,
        userinfo_get,
    ):
        token_response = Mock()
        token_response.raise_for_status.return_value = None
        token_response.json.return_value = {
            'access_token': 'access-token',
            'refresh_token': 'refresh-token',
            'scope': f'{GOOGLE_CALENDAR_SCOPE} {GOOGLE_TASKS_SCOPE}',
        }
        token_post.return_value = token_response
        info_response = Mock()
        info_response.raise_for_status.return_value = None
        info_response.json.return_value = {
            'email': 'calendar-owner@gmail.com',
            'email_verified': True,
            'name': 'Calendar Owner',
        }
        userinfo_get.return_value = info_response

        started = self.client.get('/api/calendar/google/connect/', secure=True)
        state = parse_qs(urlparse(started['Location']).query)['state'][0]
        response = self.client.get(
            '/api/auth/google/callback/',
            {'code': 'code', 'state': state},
            secure=True,
        )
        self.assertEqual(response.status_code, 302)
        self.assertIn('calendar_connected=1', response['Location'])
        connection = GoogleCalendarConnection.objects.get(user=self.user)
        self.assertEqual(connection.google_email, 'calendar-owner@gmail.com')
        self.assertEqual(
            decrypt_refresh_token(connection.refresh_token_encrypted),
            'refresh-token',
        )
        self.assertIn(GOOGLE_TASKS_SCOPE, connection.granted_scopes)

    @patch('core.views.requests.get')
    @patch('core.views.requests.post')
    def test_calendar_oauth_scope_omission_does_not_create_reconnect_loop(
        self,
        token_post,
        userinfo_get,
    ):
        GoogleCalendarConnection.objects.create(
            user=self.user,
            google_email='calendar-owner@gmail.com',
            refresh_token_encrypted=encrypt_refresh_token('old-refresh-token'),
            granted_scopes=GOOGLE_CALENDAR_SCOPE,
        )
        token_response = Mock()
        token_response.raise_for_status.return_value = None
        token_response.json.return_value = {
            'access_token': 'access-token',
            'refresh_token': 'new-refresh-token',
        }
        token_post.return_value = token_response
        info_response = Mock()
        info_response.raise_for_status.return_value = None
        info_response.json.return_value = {
            'email': 'calendar-owner@gmail.com',
            'email_verified': True,
            'name': 'Calendar Owner',
        }
        userinfo_get.return_value = info_response

        started = self.client.get('/api/calendar/google/connect/', secure=True)
        state = parse_qs(urlparse(started['Location']).query)['state'][0]
        response = self.client.get(
            '/api/auth/google/callback/',
            {'code': 'code', 'state': state},
            secure=True,
        )
        self.assertEqual(response.status_code, 302)
        connection = GoogleCalendarConnection.objects.get(user=self.user)
        self.assertIn(GOOGLE_CALENDAR_SCOPE, connection.granted_scopes)
        self.assertIn(GOOGLE_TASKS_SCOPE, connection.granted_scopes)

    @patch('core.google_calendar_api.requests.post')
    def test_meeting_sync_creates_google_calendar_event(self, post):
        meeting = OperatingMeeting.objects.create(
            workspace=self.workspace,
            kind=OperatingMeeting.Kind.WEEKLY,
            title='Gravitas Weekly',
            scheduled_for=timezone.now(),
            duration_minutes=60,
            owner=self.user,
        )
        GoogleCalendarConnection.objects.create(
            user=self.user,
            google_email='calendar-owner@gmail.com',
            refresh_token_encrypted=encrypt_refresh_token('refresh-token'),
        )

        token_response = Mock()
        token_response.raise_for_status.return_value = None
        token_response.json.return_value = {'access_token': 'fresh-access-token'}
        event_response = Mock()
        event_response.raise_for_status.return_value = None
        event_response.json.return_value = {
            'id': 'event-123',
            'htmlLink': 'https://calendar.google.com/calendar/event?eid=event-123',
        }
        post.side_effect = [token_response, event_response]

        response = self.client.post(
            f'/api/calendar/google/meetings/{meeting.pk}/sync/',
            secure=True,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['event']['event_id'], 'event-123')
        link = GoogleCalendarEventLink.objects.get(user=self.user, meeting=meeting)
        self.assertEqual(link.event_id, 'event-123')
        event_call = post.call_args_list[1]
        self.assertIn('/calendar/v3/calendars/primary/events', event_call.args[0])
        self.assertEqual(event_call.kwargs['json']['summary'], 'Gravitas Weekly')


    def _task(self):
        process = OperatingProcess.objects.create(
            workspace=self.workspace,
            key='calendar-test',
            name='Calendar test',
        )
        objective = StrategicObjective.objects.create(
            workspace=self.workspace,
            title='Calendar objective',
            owner=self.user,
        )
        kr = KeyResult.objects.create(
            objective=objective,
            title='Calendar KR',
            owner=self.user,
        )
        initiative = Initiative.objects.create(
            workspace=self.workspace,
            key_result=kr,
            process=process,
            title='Calendar initiative',
            owner=self.user,
        )
        return OperatingTask.objects.create(
            workspace=self.workspace,
            initiative=initiative,
            owner=self.user,
            title='Prepare research brief',
            description='Prepare the brief before review.',
            definition_of_done='Brief is reviewed.',
            due_date=date.today() + timedelta(days=3),
            priority='p1',
        )

    @patch('core.google_calendar_api.requests.post')
    def test_task_sync_creates_native_google_task(self, post):
        task = self._task()
        GoogleCalendarConnection.objects.create(
            user=self.user,
            google_email='calendar-owner@gmail.com',
            refresh_token_encrypted=encrypt_refresh_token('refresh-token'),
            granted_scopes=f'{GOOGLE_CALENDAR_SCOPE} {GOOGLE_TASKS_SCOPE}',
        )

        token_response = Mock()
        token_response.raise_for_status.return_value = None
        token_response.json.return_value = {'access_token': 'fresh-access-token'}
        task_response = Mock()
        task_response.ok = True
        task_response.status_code = 200
        task_response.json.return_value = {'id': 'google-task-123'}
        post.side_effect = [token_response, task_response]

        response = self.client.post(
            f'/api/calendar/google/tasks/{task.pk}/sync/',
            secure=True,
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['google_task']['google_task_id'], 'google-task-123')
        link = GoogleTaskLink.objects.get(user=self.user, task=task)
        self.assertEqual(link.google_task_id, 'google-task-123')

        api_call = post.call_args_list[1]
        self.assertIn('/tasks/v1/lists/@default/tasks', api_call.args[0])
        payload = api_call.kwargs['json']
        self.assertEqual(payload['title'], 'Prepare research brief')
        self.assertEqual(payload['status'], 'needsAction')
        self.assertTrue(payload['due'].startswith(task.due_date.isoformat()))

    @patch('core.google_calendar_api.requests.post')
    def test_stale_scope_metadata_does_not_block_google_task_sync(self, post):
        task = self._task()
        GoogleCalendarConnection.objects.create(
            user=self.user,
            google_email='calendar-owner@gmail.com',
            refresh_token_encrypted=encrypt_refresh_token('refresh-token'),
            granted_scopes=GOOGLE_CALENDAR_SCOPE,
        )

        status = self.client.get(
            f'/api/calendar/google/tasks/{task.pk}/status/',
            secure=True,
        )
        self.assertEqual(status.status_code, 200)
        self.assertTrue(status.json()['connected'])
        self.assertFalse(status.json()['tasks_scope_granted'])
        self.assertIn(
            'authuser=calendar-owner@gmail.com',
            status.json()['calendar_url'],
        )

        token_response = Mock()
        token_response.raise_for_status.return_value = None
        token_response.json.return_value = {'access_token': 'fresh-access-token'}
        task_response = Mock()
        task_response.ok = True
        task_response.status_code = 200
        task_response.json.return_value = {'id': 'google-task-stale-scope'}
        post.side_effect = [token_response, task_response]

        sync = self.client.post(
            f'/api/calendar/google/tasks/{task.pk}/sync/',
            secure=True,
        )
        self.assertEqual(sync.status_code, 200, sync.content)
        self.assertEqual(
            sync.json()['google_task']['google_task_id'],
            'google-task-stale-scope',
        )
        self.assertIn(
            'authuser=calendar-owner@gmail.com',
            sync.json()['google_task']['calendar_url'],
        )

    @patch('core.google_calendar_api.requests.get')
    @patch('core.google_calendar_api.requests.post')
    def test_calendar_api_disabled_returns_project_and_enable_link(self, post, get):
        GoogleCalendarConnection.objects.create(
            user=self.user,
            google_email='calendar-owner@gmail.com',
            refresh_token_encrypted=encrypt_refresh_token('refresh-token'),
            granted_scopes=f'{GOOGLE_CALENDAR_SCOPE} {GOOGLE_TASKS_SCOPE}',
        )
        token_response = Mock()
        token_response.raise_for_status.return_value = None
        token_response.json.return_value = {'access_token': 'fresh-access-token'}
        post.return_value = token_response

        disabled = Mock()
        disabled.ok = False
        disabled.status_code = 403
        disabled.json.return_value = {
            'error': {
                'code': 403,
                'message': (
                    'Google Calendar API has not been used in project 123456789012 '
                    'before or it is disabled.'
                ),
                'status': 'PERMISSION_DENIED',
                'details': [{
                    '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                    'reason': 'SERVICE_DISABLED',
                    'domain': 'googleapis.com',
                    'metadata': {
                        'consumer': 'projects/123456789012',
                        'service': 'calendar-json.googleapis.com',
                    },
                }],
            },
        }
        get.return_value = disabled

        response = self.client.get('/api/calendar/google/events/', secure=True)
        self.assertEqual(response.status_code, 502, response.content)
        payload = response.json()
        self.assertEqual(payload['error'], 'google_calendar_api_disabled')
        self.assertEqual(payload['google_project_number'], '123456789012')
        self.assertIn('calendar-json.googleapis.com', payload['setup_url'])
        self.assertIn('project=123456789012', payload['setup_url'])

    @patch('core.google_calendar_api.requests.get')
    @patch('core.google_calendar_api.requests.post')
    def test_google_calendar_events_can_store_shared_minutes(self, post, get):
        GoogleCalendarConnection.objects.create(
            user=self.user,
            google_email='calendar-owner@gmail.com',
            refresh_token_encrypted=encrypt_refresh_token('refresh-token'),
            granted_scopes=f'{GOOGLE_CALENDAR_SCOPE} {GOOGLE_TASKS_SCOPE}',
        )
        token_response = Mock()
        token_response.raise_for_status.return_value = None
        token_response.json.return_value = {'access_token': 'fresh-access-token'}
        post.return_value = token_response

        event = {
            'id': 'calendar-event-9',
            'iCalUID': 'shared-meeting@example.com',
            'summary': 'Research review',
            'status': 'confirmed',
            'htmlLink': 'https://calendar.google.com/calendar/event?eid=9',
            'hangoutLink': 'https://meet.google.com/abc-defg-hij',
            'start': {'dateTime': '2026-09-29T10:00:00+02:00'},
            'end': {'dateTime': '2026-09-29T11:00:00+02:00'},
            'attendees': [{'email': 'one@example.com'}],
        }
        event_response = Mock()
        event_response.ok = True
        event_response.status_code = 200
        event_response.json.return_value = {'items': [event]}
        get.return_value = event_response

        listing = self.client.get('/api/calendar/google/events/', secure=True)
        self.assertEqual(listing.status_code, 200, listing.content)
        self.assertEqual(listing.json()['events'][0]['title'], 'Research review')
        self.assertIsNone(listing.json()['events'][0]['minute'])

        single_response = Mock()
        single_response.ok = True
        single_response.status_code = 200
        single_response.json.return_value = event
        get.return_value = single_response

        saved = self.client.post(
            '/api/calendar/google/minutes/',
            data=json.dumps({
                'event_id': 'calendar-event-9',
                'notes': 'Decision: continue with the revised protocol.',
                'reference_url': 'https://example.com/protocol',
            }),
            content_type='application/json',
            secure=True,
        )
        self.assertEqual(saved.status_code, 200, saved.content)
        minute = GoogleCalendarMeetingMinute.objects.get(
            workspace=self.workspace,
            ical_uid='shared-meeting@example.com',
        )
        self.assertIn('revised protocol', minute.notes)
        self.assertEqual(minute.reference_url, 'https://example.com/protocol')
