"""The Core task dashboard must not wait on the Nextcloud HTTP API."""
import json
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from .nextcloud_deck import deck_status


@override_settings(
    NEXTCLOUD_ADMIN_USER='deck-service',
    NEXTCLOUD_ADMIN_PASSWORD='dummy-secret',
)
class DeckStatusLatencyTests(SimpleTestCase):
    @patch('core.nextcloud_deck.OperatingTask.objects.count', return_value=387)
    @patch('core.nextcloud_deck._find_board')
    @patch('core.nextcloud_deck._is_admin', return_value=True)
    def test_status_reads_only_local_task_count(self, _admin, find_board, count):
        response = deck_status(RequestFactory().get('/api/platform/admin/deck/'))
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertTrue(data['configured'])
        self.assertIsNone(data['available'])
        self.assertEqual(data['task_count'], 387)
        self.assertIsNone(data['board'])
        find_board.assert_not_called()
        count.assert_called_once_with()
