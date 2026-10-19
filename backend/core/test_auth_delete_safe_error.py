"""Regression: account deletion must not return 500 or orphan cloud identities."""
import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import NewsletterCampaign, NewsletterSubscriber


@override_settings(SECURE_SSL_REDIRECT=False)
class AccountDeletionErrorTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='account-delete-protected@example.com',
            email='account-delete-protected@example.com',
            password='A-secure-delete-password-123!',
        )
        self.client.force_login(self.user)

    def delete(self):
        return self.client.post(
            '/api/auth/delete/',
            data=json.dumps({
                'password': 'A-secure-delete-password-123!',
                'confirmation': 'delete',
            }),
            content_type='application/json',
        )

    @patch('core.views.cloud.delete_identity')
    def test_protected_records_are_reported_as_409_without_logout_or_cloud_delete(self, native_delete):
        NewsletterCampaign.objects.create(
            created_by=self.user, subject='Protected editorial', body='Important shared content',
        )
        NewsletterSubscriber.objects.create(email=self.user.email)
        answer = self.delete()
        self.assertEqual(answer.status_code, 409, answer.content)
        self.assertEqual(answer.json()['error'], 'account_has_protected_records')
        self.assertTrue(get_user_model().objects.filter(pk=self.user.pk).exists())
        self.assertTrue(NewsletterSubscriber.objects.filter(email=self.user.email).exists())
        self.assertTrue(self.client.get('/api/auth/me/').json()['authenticated'])
        native_delete.assert_not_called()

    @patch('core.views.cloud.delete_identity')
    def test_delete_plain_account_removes_user_and_logs_out(self, native_delete):
        answer = self.delete()
        self.assertEqual(answer.status_code, 200, answer.content)
        self.assertTrue(answer.json()['deleted'])
        self.assertFalse(get_user_model().objects.filter(pk=self.user.pk).exists())
        self.assertFalse(self.client.get('/api/auth/me/').json()['authenticated'])
        native_delete.assert_not_called()
