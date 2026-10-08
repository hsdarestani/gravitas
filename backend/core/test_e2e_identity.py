import contextlib
import io
import json
from pathlib import Path
import runpy
from unittest.mock import patch
from urllib.parse import urlsplit
from django.test import TestCase
from django.contrib.auth import get_user_model


class DisposableIdentityTests(TestCase):
    def provision(self, email):
        script = Path(__file__).resolve().parents[2] / 'ops/provision_e2e_identity.py'
        result = io.StringIO()
        payload = {'email': email, 'password': 'Fixture-secure-password-123!'}
        with patch('sys.stdin', io.StringIO(json.dumps(payload))), contextlib.redirect_stdout(result):
            runpy.run_path(str(script), run_name='__main__')
        return json.loads(result.getvalue())

    def test_fixture_requires_real_signed_confirmation_before_login(self):
        email = 'auth-e2e-123-2@example.com'
        result = self.provision(email)
        data = json.dumps({'email': email, 'password': 'Fixture-secure-password-123!'})
        blocked = self.client.post('/api/auth/login/', data, content_type='application/json')
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()['error'], 'email_not_verified')
        link = urlsplit(result['verification_url'])
        self.assertEqual(self.client.get(link.path + '?' + link.query).status_code, 302)
        accepted = self.client.post('/api/auth/login/', data, content_type='application/json')
        self.assertEqual(accepted.status_code, 200)
        self.assertTrue(accepted.json()['user']['email_verified'])

    def test_fixture_refuses_real_or_unscoped_accounts(self):
        for email in ['real@example.com', 'auth-e2e-123@example.com', 'auth-e2e-123-2@other.test']:
            with self.subTest(email=email), self.assertRaises(ValueError):
                self.provision(email)
        self.assertEqual(get_user_model().objects.count(), 0)

    def test_operating_fixture_matches_existing_strict_core_grant_identity(self):
        email = 'operating-e2e-234-3@example.com'
        self.provision(email)
        user = get_user_model().objects.get(email=email)
        self.assertEqual(user.first_name, 'Operating Production E2E')
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
