import hashlib
import json
from io import StringIO
from urllib.parse import urlparse

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core import mail
from django.core.management import call_command
from django.test import TestCase

from .email_verification import EMAIL_VERIFIED_GROUP
from .models import WorkspaceMembership
from .platform_models import WorkspaceProfile

User = get_user_model()


class AccountEmailVerificationTests(TestCase):
    def _post(self, url, data):
        return self.client.post(url, json.dumps(data), content_type='application/json')

    def test_public_signup_sends_real_account_confirmation_and_link_marks_verified(self):
        response = self._post('/api/auth/signup/', {
            'name': 'Ada Researcher',
            'email': 'ada@gravitas.test',
            'password': 'A-secure-password-456!',
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].subject, 'Confirm your Gravitas+ email')

        link = next(line for line in mail.outbox[0].body.splitlines() if line.startswith('http'))
        confirm = self.client.get(urlparse(link).path + '?' + urlparse(link).query)
        self.assertEqual(confirm.status_code, 302)
        self.assertIn('email_verified=1', confirm['Location'])

        user = User.objects.get(email='ada@gravitas.test')
        self.assertTrue(user.groups.filter(name=EMAIL_VERIFIED_GROUP).exists())

    def test_authenticated_user_can_resend_confirmation(self):
        user = User.objects.create_user(
            username='resend@gravitas.test',
            email='resend@gravitas.test',
            password='A-secure-password-789!',
        )
        mail.outbox.clear()
        self.client.force_login(user)
        response = self._post('/api/auth/email-confirm/resend/', {})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['sent'])
        self.assertEqual(len(mail.outbox), 1)


class CoreMemberHashProvisionTests(TestCase):
    def test_existing_registered_user_is_promoted_without_plaintext_email_argument(self):
        user = User.objects.create_user(
            username='video.owner@gravitas.test',
            email='video.owner@gravitas.test',
            password='A-secure-password-123!',
            first_name='Registered User',
        )
        mail.outbox.clear()
        digest = hashlib.sha256(user.email.lower().encode('utf-8')).hexdigest()
        stdout = StringIO()

        call_command(
            'provision_core_member_by_email_hash',
            email_sha256=digest,
            name='Ahmad',
            role='member',
            send_verification=True,
            stdout=stdout,
        )

        user.refresh_from_db()
        core = WorkspaceProfile.objects.get(purpose=WorkspaceProfile.Purpose.CORE).workspace
        membership = WorkspaceMembership.objects.get(workspace=core, user=user)
        self.assertEqual(user.first_name, 'Ahmad')
        self.assertTrue(user.is_active)
        self.assertEqual(membership.role, WorkspaceMembership.Role.MEMBER)
        self.assertIn(f'user_id={user.pk}', stdout.getvalue())
        self.assertNotIn(user.email, stdout.getvalue())
        self.assertEqual(len(mail.outbox), 1)
        self.assertFalse(Group.objects.filter(name=EMAIL_VERIFIED_GROUP, user=user).exists())
