"""Regression tests for native Deck -> canonical task reconciliation."""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase

from . import cloud
from .canonical_journal import RecoveryRequired
from .canonical_projects import CanonicalConflict
from .models import Workspace
from .nextcloud_deck import _pull_card, deck_sync
from .operating_models import OperatingTask, WorkStatus


class DeckCanonicalPullTests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user(
            username='deck-canonical-owner', email='deck-canonical@example.test',
        )
        self.workspace = Workspace.objects.create(
            name='Deck canonical test', kind=Workspace.Kind.PERSONAL, owner=self.owner,
        )
        self.task = OperatingTask.objects.create(
            workspace=self.workspace, owner=self.owner, title='Original title',
            description='Keep this body', definition_of_done='Reviewed',
            status=WorkStatus.ACTIVE,
        )

    def card(self, title='Edited in Deck', newer=True):
        return {
            'stack_title': 'Active',
            'stack_id': 1,
            'card': {
                'title': title,
                'description': '',
                'duedate': None,
                'lastModified': self.task.updated_at.timestamp() + (60 if newer else -60),
            },
        }

    @patch('core.canonical_signals.export_object')
    @patch('core.canonical_signals.active', return_value=True)
    def test_newer_deck_edit_uses_canonical_boundary(self, _active, export):
        # Without canonical_operation, the pre_save signal raises
        # use_canonical_operation_for_project_write and no SQL is written.
        result = _pull_card(self.task, self.card())
        self.assertEqual(result, 'pulled')
        self.task.refresh_from_db()
        self.assertEqual(self.task.title, 'Edited in Deck')
        self.assertEqual(self.task.description, 'Keep this body')
        export.assert_called_once()
        self.assertEqual(export.call_args.args[0].pk, self.task.pk)

    @patch('core.canonical_signals.export_object', side_effect=cloud.CloudError('DAV unavailable'))
    @patch('core.canonical_signals.active', return_value=True)
    def test_failed_canonical_export_rolls_back_task(self, _active, _export):
        with self.assertRaisesMessage(cloud.CloudError, 'DAV unavailable'):
            _pull_card(self.task, self.card())
        self.task.refresh_from_db()
        self.assertEqual(self.task.title, 'Original title')

    @patch('core.canonical_signals.export_object')
    @patch('core.canonical_signals.active', return_value=True)
    def test_older_deck_edit_does_not_write_to_canonical_task(self, _active, export):
        self.assertEqual(_pull_card(self.task, self.card(newer=False)), 'local_newer')
        self.task.refresh_from_db()
        self.assertEqual(self.task.title, 'Original title')
        export.assert_not_called()


class DeckSyncErrorResponseTests(TestCase):
    @patch('core.nextcloud_deck._is_admin', return_value=True)
    @patch('core.nextcloud_deck.sync_tasks_to_deck',
           side_effect=RecoveryRequired('use_canonical_operation_for_project_write'))
    def test_canonical_recovery_returns_retryable_error(self, _sync, _admin):
        request = RequestFactory().post('/api/platform/admin/deck/sync/')
        response = deck_sync(request)
        self.assertEqual(response.status_code, 503)
        self.assertIn(b'deck_sync_failed', response.content)

    @patch('core.nextcloud_deck._is_admin', return_value=True)
    @patch('core.nextcloud_deck.sync_tasks_to_deck',
           side_effect=CanonicalConflict('task.md', '', '', '', 'etag'))
    def test_canonical_conflict_returns_actionable_error(self, _sync, _admin):
        request = RequestFactory().post('/api/platform/admin/deck/sync/')
        response = deck_sync(request)
        self.assertEqual(response.status_code, 409)
        self.assertIn(b'deck_sync_conflict', response.content)
