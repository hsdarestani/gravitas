from django.contrib.auth import get_user_model
from django.test import TestCase

from .platform_models import CoreAsset
from .platform_runtime_v3 import ensure_platform_workspaces


User = get_user_model()


class CoreAssetLinkTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='assets-link@gravitas.test',
            email='assets-link@gravitas.test',
            password='Assets-link-password-123!',
        )
        ensure_platform_workspaces(self.user)
        self.client.force_login(self.user)

    def test_core_assets_accept_http_link_items(self):
        response = self.client.post(
            '/api/platform/core-assets/',
            {
                'title': 'Platform Changelog',
                'folder_path': 'Platform',
                'source_url': 'https://docs.google.com/document/d/example/edit',
                'visible_to_all_core': '1',
            },
            secure=True,
        )
        self.assertEqual(response.status_code, 201, response.content)
        payload = response.json()['asset']
        self.assertEqual(payload['kind'], 'url')
        self.assertEqual(payload['title'], 'Platform Changelog')
        self.assertEqual(payload['folder_path'], 'Platform')
        self.assertEqual(
            payload['source_url'],
            'https://docs.google.com/document/d/example/edit',
        )
        self.assertEqual(CoreAsset.objects.count(), 1)
        self.assertEqual(CoreAsset.objects.get().kind, CoreAsset.Kind.URL)

    def test_core_assets_reject_non_http_link_items(self):
        response = self.client.post(
            '/api/platform/core-assets/',
            {
                'title': 'Unsafe link',
                'source_url': 'javascript:alert(1)',
            },
            secure=True,
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()['error'], 'invalid_source_url')
        self.assertFalse(CoreAsset.objects.exists())

    def test_core_asset_link_can_be_updated_but_remains_http_only(self):
        asset = CoreAsset.objects.create(
            title='Reference',
            folder_path='Platform',
            kind=CoreAsset.Kind.URL,
            source_url='https://example.com/old',
            uploader=self.user,
            visible_to_all_core=True,
        )

        changed = self.client.patch(
            f'/api/platform/core-assets/{asset.pk}/',
            data='{"source_url":"https://example.com/new"}',
            content_type='application/json',
            secure=True,
        )
        self.assertEqual(changed.status_code, 200, changed.content)
        asset.refresh_from_db()
        self.assertEqual(asset.source_url, 'https://example.com/new')

        rejected = self.client.patch(
            f'/api/platform/core-assets/{asset.pk}/',
            data='{"source_url":"data:text/html,bad"}',
            content_type='application/json',
            secure=True,
        )
        self.assertEqual(rejected.status_code, 400, rejected.content)
        self.assertEqual(rejected.json()['error'], 'invalid_source_url')


class CoreAssetLinkUiContractTests(TestCase):
    def test_assets_ui_exposes_file_and_link_actions(self):
        source = open('assets/ws/ws-core-assets.js', encoding='utf-8').read()
        self.assertIn("'Upload files'", source)
        self.assertIn("'Add link'", source)
        self.assertIn("sourceUrl.type = 'url'", source)
        self.assertIn("'Open link'", source)
        self.assertIn("'Edit link'", source)
