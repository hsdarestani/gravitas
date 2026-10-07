from types import SimpleNamespace
from unittest.mock import call, patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import Workspace, WorkspaceMembership
from .nextcloud_deck_access import CORE_GROUP_ID, ensure_core_deck_access
from .platform_models import WorkspaceProfile


class DeckCoreAccessMirrorTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(username='core-owner', email='owner@example.com')
        self.member = User.objects.create_user(username='core-member', email='member@example.com')
        self.revoked = User.objects.create_user(username='former-core', email='former@example.com')
        self.workspace = Workspace.objects.create(name='Gravitas Core', kind=Workspace.Kind.PERSONAL, owner=self.owner)
        WorkspaceProfile.objects.create(
            workspace=self.workspace,
            purpose=WorkspaceProfile.Purpose.CORE,
            is_default=True,
        )
        WorkspaceMembership.objects.create(workspace=self.workspace, user=self.owner, role=WorkspaceMembership.Role.OWNER)
        WorkspaceMembership.objects.create(workspace=self.workspace, user=self.member, role=WorkspaceMembership.Role.MEMBER)

    @patch('core.nextcloud_deck_access._request')
    @patch('core.nextcloud_deck_access._group_users')
    @patch('core.nextcloud_deck_access.cloud.remove_user_from_group')
    @patch('core.nextcloud_deck_access.cloud.add_user_to_group')
    @patch('core.nextcloud_deck_access.cloud.ensure_group')
    @patch('core.nextcloud_deck_access.ensure_user')
    def test_core_members_get_personal_identities_and_group_board_edit_access(
        self, ensure_user, ensure_group, add_to_group, remove_from_group, group_users, deck_request,
    ):
        ensure_user.side_effect = lambda user: SimpleNamespace(username=f'gravitas-u-{user.pk}')
        group_users.return_value = {f'gravitas-u-{self.owner.pk}', 'stale-native-user'}
        deck_request.return_value = {'id': 44, 'acl': []}

        result = ensure_core_deck_access(44)

        self.assertEqual(result['member_count'], 2)
        ensure_group.assert_called_once_with(CORE_GROUP_ID)
        add_to_group.assert_has_calls([
            call(f'gravitas-u-{self.owner.pk}', CORE_GROUP_ID),
            call(f'gravitas-u-{self.member.pk}', CORE_GROUP_ID),
        ], any_order=True)
        remove_from_group.assert_called_once_with('stale-native-user', CORE_GROUP_ID)
        self.assertEqual(deck_request.call_args_list[-1].args[:2], ('POST', '/boards/44/acl'))
        payload = deck_request.call_args_list[-1].kwargs['json']
        self.assertEqual(payload['type'], 1)
        self.assertEqual(payload['participant'], CORE_GROUP_ID)
        self.assertTrue(payload['permissionEdit'])
        self.assertFalse(payload['permissionShare'])
        self.assertFalse(payload['permissionManage'])

    @patch('core.nextcloud_deck_access._request')
    @patch('core.nextcloud_deck_access._group_users', return_value=set())
    @patch('core.nextcloud_deck_access.cloud.add_user_to_group')
    @patch('core.nextcloud_deck_access.cloud.ensure_group')
    @patch('core.nextcloud_deck_access.ensure_user')
    def test_existing_correct_group_acl_is_idempotent(
        self, ensure_user, _ensure_group, _add_to_group, _group_users, deck_request,
    ):
        ensure_user.side_effect = lambda user: SimpleNamespace(username=f'gravitas-u-{user.pk}')
        deck_request.return_value = {
            'id': 44,
            'acl': [{
                'id': 7,
                'type': 1,
                'participant': {'uid': CORE_GROUP_ID},
                'permissionEdit': True,
                'permissionShare': False,
                'permissionManage': False,
            }],
        }

        ensure_core_deck_access(44)

        self.assertEqual(deck_request.call_count, 1)
        self.assertEqual(deck_request.call_args.args[:2], ('GET', '/boards/44'))
