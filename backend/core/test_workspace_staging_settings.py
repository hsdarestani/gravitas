import os
import runpy
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase


class WorkspaceStagingSettingsTests(SimpleTestCase):
    def settings_for(self, **overrides):
        env = {
            'GQ_STAGING_DB_PASSWORD': 'test-database-password',
            'GQ_STAGING_DB_HOST': 'postgres-staging',
            'GQ_STAGING_SECRET_KEY': 'test-django-key',
            'GQ_STAGING_NEXTCLOUD_INTERNAL_URL': 'http://nextcloud-staging:80',
            'GQ_STAGING_NEXTCLOUD_PUBLIC_URL': 'https://staging.graviquest.com/nextcloud',
            'GQ_STAGING_NEXTCLOUD_ADMIN_USER': 'test-staging-admin',
            'GQ_STAGING_NEXTCLOUD_ADMIN_PASSWORD': 'test-nextcloud-password',
            'GQ_STAGING_NEXTCLOUD_OIDC_PROVIDER_ID': '1',
            'GQ_STAGING_OIDC_CLIENT_SECRET': 'test-oidc-secret',
            'GQ_STAGING_OIDC_PRIVATE_KEY_B64': 'dGVzdA==',
            'WORKSPACE_STUDIO_ENABLED': '1',
            'DJANGO_DB_NAME': 'gravitas',
            'NEXTCLOUD_PUBLIC_URL': 'https://cloud.graviquest.com',
            'DJANGO_ALLOWED_HOSTS': 'graviquest.com',
        }
        with patch.dict(os.environ, {**env, **overrides}, clear=True):
            return runpy.run_module('gravitas_backend.workspace_staging_settings')

    def test_staging_uses_its_own_sessions_data_and_origin(self):
        config = self.settings_for()
        self.assertTrue(config['WORKSPACE_STUDIO_ENABLED'])
        self.assertFalse(config['DEBUG'])
        self.assertEqual(config['ALLOWED_HOSTS'], ['staging.graviquest.com'])
        self.assertEqual(config['SESSION_COOKIE_NAME'], 'gravitas_staging_sessionid')
        self.assertEqual(config['CSRF_COOKIE_NAME'], 'gravitas_staging_csrftoken')
        self.assertEqual(config['DATABASES']['default']['NAME'], 'gravitas_workspace_staging')
        self.assertEqual(config['NEXTCLOUD_PUBLIC_URL'], 'https://staging.graviquest.com/nextcloud')
        self.assertEqual(config['CORE_UPLOAD_ROOT'].parent, config['STAGING_STATE'])

    def test_rejects_missing_staging_settings_and_production_nextcloud(self):
        with self.assertRaisesMessage(ImproperlyConfigured, 'GQ_STAGING_DB_PASSWORD'):
            self.settings_for(GQ_STAGING_DB_PASSWORD='')
        for url in ('https://cloud.graviquest.com', 'http://127.0.0.1:8081'):
            with self.subTest(url=url), self.assertRaises(ImproperlyConfigured):
                self.settings_for(GQ_STAGING_NEXTCLOUD_INTERNAL_URL=url)
        with self.assertRaises(ImproperlyConfigured):
            self.settings_for(GQ_STAGING_NEXTCLOUD_PUBLIC_URL='https://cloud.graviquest.com')
