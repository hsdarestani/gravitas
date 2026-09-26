from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from .google_calendar_api import decrypt_refresh_token, encrypt_refresh_token
from .operating_models import (
    GoogleCalendarConnection,
    GoogleCalendarEventLink,
    OperatingMeeting,
)
from .workspace_api import provision_personal_workspace


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
        provision_personal_workspace(self.user)
        self.client.force_login(self.user)

    def test_calendar_connect_requests_offline_calendar_scope(self):
        response = self.client.get(
            '/api/calendar/google/connect/',
            {'next': '/workspace/core/tasks?calendar_task=44'},
        )
        self.assertEqual(response.status_code, 302)
        parsed = urlparse(response['Location'])
        query = parse_qs(parsed.query)
        self.assertEqual(parsed.netloc, 'accounts.google.com')
        self.assertIn('https://www.googleapis.com/auth/calendar.events', query['scope'][0])
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

        started = self.client.get('/api/calendar/google/connect/')
        state = parse_qs(urlparse(started['Location']).query)['state'][0]
        response = self.client.get(
            '/api/auth/google/callback/',
            {'code': 'code', 'state': state},
        )
        self.assertEqual(response.status_code, 302)
        self.assertIn('calendar_connected=1', response['Location'])
        connection = GoogleCalendarConnection.objects.get(user=self.user)
        self.assertEqual(connection.google_email, 'calendar-owner@gmail.com')
        self.assertEqual(
            decrypt_refresh_token(connection.refresh_token_encrypted),
            'refresh-token',
        )

    @patch('core.google_calendar_api.requests.post')
    def test_meeting_sync_creates_google_calendar_event(self, post):
        workspace = self.user.gravitas_workspace_memberships.select_related('workspace').first().workspace
        meeting = OperatingMeeting.objects.create(
            workspace=workspace,
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

        response = self.client.post(f'/api/calendar/google/meetings/{meeting.pk}/sync/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['event']['event_id'], 'event-123')
        link = GoogleCalendarEventLink.objects.get(user=self.user, meeting=meeting)
        self.assertEqual(link.event_id, 'event-123')
        event_call = post.call_args_list[1]
        self.assertIn('/calendar/v3/calendars/primary/events', event_call.args[0])
        self.assertEqual(event_call.kwargs['json']['summary'], 'Gravitas Weekly')
