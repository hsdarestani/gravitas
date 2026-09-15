from django.contrib.auth import get_user_model
from django.test import TestCase

from .kms_models import KMSState


class KMSStateApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='kms@example.com',
            email='kms@example.com',
            password='A-secure-password-123!',
        )

    def test_requires_authentication(self):
        response = self.client.get('/api/platform/kms/state/')
        self.assertEqual(response.status_code, 401)

    def test_fresh_account_has_no_demo_material(self):
        self.client.force_login(self.user)
        response = self.client.get('/api/platform/kms/state/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['state'], {
            'sources': [], 'cards': [], 'paths': [], 'skills': [], 'log': [],
        })
        self.assertFalse(KMSState.objects.filter(user=self.user).exists())

    def test_state_round_trip_is_scoped_to_account(self):
        self.client.force_login(self.user)
        state = {
            'sources': [],
            'cards': [{
                'id': 'c-live', 'front': 'What changed?', 'back': 'The durable state.',
                'pageId': '42', 'skill': None, 'rung': 0, 'due': '2026-09-15', 'lapses': 0,
            }],
            'paths': [],
            'skills': [],
            'log': [],
        }
        response = self.client.put(
            '/api/platform/kms/state/',
            data={'state': state},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['state'], state)

        response = self.client.get('/api/platform/kms/state/')
        self.assertEqual(response.json()['state'], state)

        other = get_user_model().objects.create_user(
            username='other-kms@example.com', email='other-kms@example.com', password='Other-pass-123!',
        )
        self.client.force_login(other)
        response = self.client.get('/api/platform/kms/state/')
        self.assertEqual(response.json()['state']['cards'], [])

    def test_rejects_invalid_or_oversized_collections(self):
        self.client.force_login(self.user)
        response = self.client.put(
            '/api/platform/kms/state/',
            data={'state': {'sources': {}, 'cards': [], 'paths': [], 'skills': [], 'log': []}},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'invalid_sources')

        response = self.client.put(
            '/api/platform/kms/state/',
            data={'state': {'sources': [], 'cards': [{}] * 5001, 'paths': [], 'skills': [], 'log': []}},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'cards_limit_exceeded')
