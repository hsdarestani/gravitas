import json
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

from django.contrib.auth import authenticate, get_user_model
from django.core import mail
from django.test import TestCase, override_settings

from .email_verification import EMAIL_VERIFIED_GROUP
from .layer_models import CommunityProfile
from .platform_models import ResearcherProfile


User = get_user_model()


class PublicAccountFlowTests(TestCase):
    def post_json(self, path, payload):
        return self.client.post(path, json.dumps(payload), content_type='application/json')

    def test_signup_requires_email_confirmation_before_login_and_saves_optional_phone(self):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.post_json('/api/auth/signup/', {
                'name': 'Verified Researcher',
                'email': 'verify-first@gravitas.test',
                'phone': '+49 170 1234567',
                'password': 'A-secure-password-456!',
            })
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()['pending_confirmation'])
        self.assertFalse(self.client.get('/api/auth/me/').json()['authenticated'])

        user = User.objects.get(email='verify-first@gravitas.test')
        self.assertTrue(
            CommunityProfile.objects.get(user=user).email_verification_required
        )
        self.assertEqual(
            ResearcherProfile.objects.get(user=user).phone,
            '+49 170 1234567',
        )
        self.assertEqual(len(mail.outbox), 1)

        blocked = self.post_json('/api/auth/login/', {
            'email': user.email,
            'password': 'A-secure-password-456!',
        })
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()['error'], 'email_not_verified')

        link = next(
            line for line in mail.outbox[0].body.splitlines()
            if line.startswith('http')
        )
        parsed = urlparse(link)
        confirmed = self.client.get(parsed.path + '?' + parsed.query)
        self.assertEqual(confirmed.status_code, 302)
        self.assertTrue(
            user.groups.model.objects.filter(
                name=EMAIL_VERIFIED_GROUP,
                user=user,
            ).exists()
        )

        logged_in = self.post_json('/api/auth/login/', {
            'email': user.email,
            'password': 'A-secure-password-456!',
            'keep': True,
        })
        self.assertEqual(logged_in.status_code, 200)
        self.assertTrue(logged_in.json()['user']['email_verified'])

    def test_signed_out_verification_resend_is_generic_and_delivers_for_pending_account(self):
        user = User.objects.create_user(
            username='pending-resend@gravitas.test',
            email='pending-resend@gravitas.test',
            password='A-secure-password-789!',
        )
        CommunityProfile.objects.update_or_create(
            user=user,
            defaults={'email_verification_required': True},
        )
        mail.outbox.clear()

        response = self.post_json('/api/auth/email-confirm/resend/', {
            'email': user.email,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)

        unknown = self.post_json('/api/auth/email-confirm/resend/', {
            'email': 'nobody@gravitas.test',
        })
        self.assertEqual(unknown.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)


class PasswordResetEmailTests(TestCase):
    def post_json(self, path, payload):
        return self.client.post(path, json.dumps(payload), content_type='application/json')

    def setUp(self):
        self.user = User.objects.create_user(
            username='reset-me@gravitas.test',
            email='reset-me@gravitas.test',
            password='Old-secure-password-123!',
        )
        mail.outbox.clear()

    def test_reset_email_link_changes_password_and_is_one_time(self):
        requested = self.post_json('/api/auth/password-reset/', {
            'email': self.user.email,
        })
        self.assertEqual(requested.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].subject, 'Reset your Gravitas+ password')

        link = next(
            line for line in mail.outbox[0].body.splitlines()
            if line.startswith('http')
        )
        query = parse_qs(urlparse(link).query)
        uid = query['reset_uid'][0]
        token = query['reset_token'][0]

        changed = self.post_json('/api/auth/password-reset/confirm/', {
            'uid': uid,
            'token': token,
            'password': 'New-secure-password-987!',
        })
        self.assertEqual(changed.status_code, 200)
        self.assertIsNone(authenticate(
            username=self.user.email,
            password='Old-secure-password-123!',
        ))
        self.assertIsNotNone(authenticate(
            username=self.user.email,
            password='New-secure-password-987!',
        ))

        reused = self.post_json('/api/auth/password-reset/confirm/', {
            'uid': uid,
            'token': token,
            'password': 'Another-secure-password-123!',
        })
        self.assertEqual(reused.status_code, 400)
        self.assertEqual(reused.json()['error'], 'invalid_or_expired_link')

    def test_reset_request_does_not_reveal_unknown_email(self):
        response = self.post_json('/api/auth/password-reset/', {
            'email': 'unknown-person@gravitas.test',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)


@override_settings(
    GOOGLE_OAUTH_CLIENT_ID='test-client.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET='test-secret',
    GOOGLE_OAUTH_REDIRECT_URI='https://gravitasplus.com/api/auth/google/callback/',
    PUBLIC_BASE_URL='https://gravitasplus.com',
)
class GoogleOAuthFlowTests(TestCase):
    def test_google_start_uses_configured_client_and_secure_state(self):
        response = self.client.get('/api/auth/google/start/')
        self.assertEqual(response.status_code, 302)
        parsed = urlparse(response['Location'])
        self.assertEqual(parsed.scheme, 'https')
        self.assertEqual(parsed.netloc, 'accounts.google.com')
        query = parse_qs(parsed.query)
        self.assertEqual(query['client_id'], ['test-client.apps.googleusercontent.com'])
        self.assertEqual(
            query['redirect_uri'],
            ['https://gravitasplus.com/api/auth/google/callback/'],
        )
        self.assertEqual(query['scope'], ['openid email profile'])
        self.assertTrue(query['state'][0])
        self.assertEqual(
            self.client.session['google_oauth_state'],
            query['state'][0],
        )

    @patch('core.views.requests.get')
    @patch('core.views.requests.post')
    def test_verified_google_account_creates_member_and_logs_in(self, token_post, userinfo_get):
        token_response = Mock()
        token_response.raise_for_status.return_value = None
        token_response.json.return_value = {'access_token': 'google-access-token'}
        token_post.return_value = token_response

        info_response = Mock()
        info_response.raise_for_status.return_value = None
        info_response.json.return_value = {
            'email': 'google-new@gravitas.test',
            'email_verified': True,
            'name': 'Google Member',
        }
        userinfo_get.return_value = info_response

        started = self.client.get('/api/auth/google/start/')
        state = parse_qs(urlparse(started['Location']).query)['state'][0]
        callback = self.client.get(
            '/api/auth/google/callback/',
            {'code': 'authorization-code', 'state': state},
        )
        self.assertEqual(callback.status_code, 302)
        self.assertEqual(callback['Location'], 'https://gravitasplus.com/workspace')

        user = User.objects.get(email='google-new@gravitas.test')
        self.assertFalse(user.has_usable_password())
        self.assertTrue(
            CommunityProfile.objects.get(user=user).email_verification_required
        )
        self.assertTrue(
            user.groups.model.objects.filter(
                name=EMAIL_VERIFIED_GROUP,
                user=user,
            ).exists()
        )
        self.assertTrue(self.client.get('/api/auth/me/').json()['authenticated'])
        self.assertEqual(
            token_post.call_args.kwargs['data']['redirect_uri'],
            'https://gravitasplus.com/api/auth/google/callback/',
        )

    @patch('core.views.requests.get')
    @patch('core.views.requests.post')
    def test_google_login_reuses_existing_account_by_verified_email(self, token_post, userinfo_get):
        user = User.objects.create_user(
            username='existing-google@gravitas.test',
            email='existing-google@gravitas.test',
            password='Existing-secure-password-123!',
        )
        CommunityProfile.objects.update_or_create(
            user=user,
            defaults={'email_verification_required': True},
        )

        token_response = Mock()
        token_response.raise_for_status.return_value = None
        token_response.json.return_value = {'access_token': 'google-access-token'}
        token_post.return_value = token_response
        info_response = Mock()
        info_response.raise_for_status.return_value = None
        info_response.json.return_value = {
            'email': user.email,
            'email_verified': True,
            'name': 'Ignored Provider Name',
        }
        userinfo_get.return_value = info_response

        started = self.client.get('/api/auth/google/start/')
        state = parse_qs(urlparse(started['Location']).query)['state'][0]
        callback = self.client.get(
            '/api/auth/google/callback/',
            {'code': 'authorization-code', 'state': state},
        )
        self.assertEqual(callback.status_code, 302)
        self.assertEqual(User.objects.filter(email=user.email).count(), 1)
        self.assertTrue(self.client.get('/api/auth/me/').json()['authenticated'])

    def test_google_callback_rejects_invalid_state_before_provider_exchange(self):
        response = self.client.get(
            '/api/auth/google/callback/',
            {'code': 'authorization-code', 'state': 'forged-state'},
        )
        self.assertEqual(response.status_code, 302)
        self.assertIn('google_error=state', response['Location'])
