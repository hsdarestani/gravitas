import json
from urllib.parse import parse_qs, urlparse

from django.contrib.auth import authenticate, get_user_model
from django.core import mail
from django.test import TestCase

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
