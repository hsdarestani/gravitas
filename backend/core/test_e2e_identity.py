import contextlib
import io
import json
from pathlib import Path
import runpy
from unittest.mock import patch
from urllib.parse import urlsplit
from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model


class DisposableIdentityTests(TestCase):
    def provision(self, email, password='Fixture-secure-password-123!'):
        script = Path(__file__).resolve().parents[2] / 'ops/provision_e2e_identity.py'
        result = io.StringIO()
        payload = {'email': email, 'password': password}
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

    @override_settings(AUTH_PASSWORD_VALIDATORS=[{'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'}])
    def test_attribute_similarity_is_kept_and_independent_fixture_password_is_accepted(self):
        import secrets
        email = 'auth-e2e-37791686327-1@example.com'
        with self.assertRaisesMessage(RuntimeError, 'error=password_invalid'):
            self.provision(email, 'E2E-37791686327-example-com-aA1!')
        self.provision(email, secrets.token_urlsafe(64) + '-aA1!')

    def test_only_workspace_fixtures_receive_research_and_never_core_access(self):
        from core.layer_access import module_access
        from core.layer_models import ModuleGrant
        self.provision('workspace-a-456-1@example.com')
        self.provision('auth-e2e-456-1@example.com')
        User = get_user_model()
        researcher = User.objects.get(email='workspace-a-456-1@example.com')
        ordinary = User.objects.get(email='auth-e2e-456-1@example.com')
        self.assertTrue(module_access(researcher, ModuleGrant.Module.RESEARCH))
        self.assertFalse(module_access(ordinary, ModuleGrant.Module.RESEARCH))
        self.assertFalse(module_access(researcher, ModuleGrant.Module.CORE))
        self.assertFalse(ModuleGrant.objects.filter(user=ordinary, module=ModuleGrant.Module.RESEARCH).exists())
