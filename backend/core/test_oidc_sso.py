import base64
import hashlib
import json
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .oidc_models import OIDCAuthorizationCode

User = get_user_model()


def _b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode('ascii')


def _decode_part(value):
    value += '=' * (-len(value) % 4)
    return json.loads(base64.urlsafe_b64decode(value.encode('ascii')).decode('utf-8'))


class NextcloudOIDCSSOTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = cls.private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        cls.key_b64 = base64.b64encode(pem).decode('ascii')

    def setUp(self):
        self.user = User.objects.create_user(
            username='researcher@example.com',
            email='researcher@example.com',
            password='test-password-123',
            first_name='Researcher',
        )
        self.settings = override_settings(
            GRAVITAS_OIDC_ISSUER='https://gravitasplus.com/api/oidc',
            GRAVITAS_OIDC_CLIENT_ID='gravitas-nextcloud',
            GRAVITAS_OIDC_CLIENT_SECRET='test-client-secret',
            GRAVITAS_OIDC_PRIVATE_KEY_B64=self.key_b64,
            NEXTCLOUD_PUBLIC_URL='https://cloud.gravitasplus.com',
            NEXTCLOUD_OIDC_PROVIDER_ID='7',
        )
        self.settings.enable()
        self.addCleanup(self.settings.disable)
        self.identity_patch = patch(
            'core.oidc_provider.nextcloud_bridge.ensure_user',
            return_value=SimpleNamespace(username=f'gravitas-u-{self.user.pk}'),
        )
        self.ensure_identity = self.identity_patch.start()
        self.addCleanup(self.identity_patch.stop)

    def _authorization_url(self, verifier='sso-verifier-123456789'):
        challenge = _b64url(hashlib.sha256(verifier.encode('ascii')).digest())
        return '/api/oidc/authorize/?' + '&'.join([
            'client_id=gravitas-nextcloud',
            'redirect_uri=https%3A%2F%2Fcloud.gravitasplus.com%2Fapps%2Fuser_oidc%2Fcode',
            'response_type=code',
            'scope=openid%20email%20profile',
            'state=state-123',
            'nonce=nonce-123',
            f'code_challenge={challenge}',
            'code_challenge_method=S256',
        ])

    def _authorize(self, verifier='sso-verifier-123456789'):
        self.client.force_login(self.user)
        response = self.client.get(self._authorization_url(verifier))
        self.assertEqual(response.status_code, 302)
        parsed = urlparse(response['Location'])
        query = parse_qs(parsed.query)
        self.assertEqual(query['state'], ['state-123'])
        return query['code'][0]

    def _exchange(self, code, verifier='sso-verifier-123456789'):
        credentials = base64.b64encode(b'gravitas-nextcloud:test-client-secret').decode('ascii')
        return self.client.post(
            '/api/oidc/token/',
            data={
                'grant_type': 'authorization_code',
                'code': code,
                'redirect_uri': 'https://cloud.gravitasplus.com/apps/user_oidc/code',
                'code_verifier': verifier,
            },
            HTTP_AUTHORIZATION=f'Basic {credentials}',
        )

    def test_discovery_advertises_pkce_and_rs256(self):
        response = self.client.get('/api/oidc/.well-known/openid-configuration')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['issuer'], 'https://gravitasplus.com/api/oidc')
        self.assertEqual(payload['code_challenge_methods_supported'], ['S256'])
        self.assertEqual(payload['id_token_signing_alg_values_supported'], ['RS256'])
        self.assertEqual(payload['token_endpoint_auth_methods_supported'], ['client_secret_basic', 'client_secret_post'])

    def test_anonymous_authorize_returns_to_gravitas_login(self):
        response = self.client.get(self._authorization_url())
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response['Location'].startswith('/login?oidc_next='))

    def test_authorization_code_exchange_maps_existing_nextcloud_user(self):
        code = self._authorize()
        self.assertEqual(OIDCAuthorizationCode.objects.count(), 1)
        response = self._exchange(code)
        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertEqual(payload['token_type'], 'Bearer')
        header_raw, claims_raw, signature_raw = payload['id_token'].split('.')
        header = _decode_part(header_raw)
        claims = _decode_part(claims_raw)
        self.assertEqual(header['alg'], 'RS256')
        self.assertEqual(claims['nextcloud_uid'], f'gravitas-u-{self.user.pk}')
        self.assertEqual(claims['sub'], f'gravitas:{self.user.pk}')
        self.assertEqual(claims['nonce'], 'nonce-123')
        signature_raw += '=' * (-len(signature_raw) % 4)
        signature = base64.urlsafe_b64decode(signature_raw.encode('ascii'))
        self.private_key.public_key().verify(
            signature,
            f'{header_raw}.{claims_raw}'.encode('ascii'),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        self.ensure_identity.assert_called()

        info = self.client.get(
            '/api/oidc/userinfo/',
            HTTP_AUTHORIZATION=f"Bearer {payload['access_token']}",
        )
        self.assertEqual(info.status_code, 200)
        self.assertEqual(info.json()['nextcloud_uid'], f'gravitas-u-{self.user.pk}')

    def test_authorization_code_is_one_time(self):
        code = self._authorize()
        first = self._exchange(code)
        self.assertEqual(first.status_code, 200)
        replay = self._exchange(code)
        self.assertEqual(replay.status_code, 400)
        self.assertEqual(replay.json()['error'], 'invalid_grant')

    def test_pkce_mismatch_is_rejected_without_consuming_code(self):
        code = self._authorize('correct-verifier')
        wrong = self._exchange(code, 'wrong-verifier')
        self.assertEqual(wrong.status_code, 400)
        self.assertEqual(wrong.json()['error'], 'invalid_grant')
        stored = OIDCAuthorizationCode.objects.get()
        self.assertIsNone(stored.used_at)
        good = self._exchange(code, 'correct-verifier')
        self.assertEqual(good.status_code, 200)

    def test_sso_launch_uses_provider_and_preserves_nextcloud_path(self):
        self.client.force_login(self.user)
        response = self.client.get(
            '/api/platform/nextcloud/sso/',
            {'next': 'https://cloud.gravitasplus.com/index.php/apps/notes/?note=12'},
        )
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response['Location'].startswith('https://cloud.gravitasplus.com/index.php/apps/user_oidc/login/7?'))
        params = parse_qs(urlparse(response['Location']).query)
        self.assertEqual(params['redirectUrl'], ['/index.php/apps/notes/?note=12'])

    def test_sso_launch_rejects_external_redirect(self):
        self.client.force_login(self.user)
        response = self.client.get('/api/platform/nextcloud/sso/', {'next': 'https://evil.example/phish'})
        self.assertEqual(response.status_code, 302)
        params = parse_qs(urlparse(response['Location']).query)
        self.assertEqual(params['redirectUrl'], ['/index.php/apps/files/files'])
