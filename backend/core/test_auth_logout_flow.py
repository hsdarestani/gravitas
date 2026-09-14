from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings


@override_settings(SECURE_SSL_REDIRECT=False)
class AuthLogoutFlowTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='logout-contract@example.com',
            email='logout-contract@example.com',
            password='test-pass-123',
        )

    def test_logout_ends_the_session_with_csrf_protection_enabled(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)

        csrf = client.get('/api/auth/csrf/')
        self.assertEqual(csrf.status_code, 200, csrf.content)
        token = client.cookies['csrftoken'].value

        response = client.post('/api/auth/logout/', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()['ok'])

        me = client.get('/api/auth/me/')
        self.assertEqual(me.status_code, 200, me.content)
        self.assertFalse(me.json()['authenticated'])

    def test_workspace_client_sends_csrf_for_bodyless_unsafe_requests(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / 'assets' / 'ws' / 'ws-platform.js').read_text(encoding='utf-8')

        self.assertIn("const unsafe = !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(verb);", source)
        self.assertIn("if (unsafe) headers['X-CSRFToken'] = await csrfToken();", source)
        self.assertIn("call('/auth/logout/', { method: 'POST' })", source)
        self.assertIn("localStorage.removeItem(ACCESS_MEMO)", source)
