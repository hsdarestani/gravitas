from types import SimpleNamespace
from unittest.mock import patch
from django.test import SimpleTestCase, override_settings
from . import cloud
from .canonical_acl import desired_rules


@override_settings(NEXTCLOUD_ADMIN_USER='service-admin', NEXTCLOUD_ADMIN_PASSWORD='test-only')
class CanonicalNativeCeilingTests(SimpleTestCase):
    def setUp(self):
        self.project = SimpleNamespace(pk=71)

    def test_service_ceiling_rejects_a_group_containing_another_user(self):
        with patch('core.cloud.ensure_group'), patch('core.cloud.group_users', return_value={'unexpected-user'}), \
             patch('core.cloud.add_user_to_group') as add, patch('core.cloud._attach_permission_ceiling') as attach:
            with self.assertRaises(cloud.CloudError):
                cloud.prepare_canonical_service_access(self.project, 9)
        add.assert_not_called(); attach.assert_not_called()

    def test_verified_exclusive_service_identity_can_bootstrap_journals(self):
        groups = cloud.canonical_native_groups(self.project)
        with patch('core.cloud.ensure_group'), patch('core.cloud.group_users', side_effect=[set(), {'service-admin'}]), \
             patch('core.cloud.add_user_to_group') as add, patch('core.cloud._attach_permission_ceiling') as attach:
            cloud.prepare_canonical_service_access(self.project, 9)
        add.assert_called_once_with('service-admin', groups['service'])
        attach.assert_called_once_with(9, groups['service'], 31)

    def test_writer_ceiling_excludes_viewers_and_removes_revoked_writers(self):
        group = cloud.canonical_native_groups(self.project)['writers']
        with patch('core.cloud.group_users', side_effect=[{'revoked', 'viewer'}, {'owner'}]), \
             patch('core.cloud.add_user_to_group') as add, patch('core.cloud.remove_user_from_group') as remove, \
             patch('core.cloud._attach_permission_ceiling') as attach, patch('core.canonical_acl.read_acl', return_value={'rules': []}):
            cloud.sync_canonical_writer_access(self.project, 9, {'owner': 'manage', 'viewer': 'view', 'commenter': 'comment', 'service-admin': 'manage'}, root_rules=[])
        self.assertEqual({call.args for call in remove.call_args_list}, {('revoked', group), ('viewer', group)})
        add.assert_called_once_with('owner', group)
        attach.assert_called_once_with(9, group, 15)

    def test_changed_root_acl_stops_before_any_writer_membership_or_ceiling_change(self):
        with patch('core.canonical_acl.read_acl', return_value={'rules': [{'external': True}]}), \
             patch('core.cloud.group_users') as members, patch('core.cloud._attach_permission_ceiling') as attach:
            with self.assertRaises(cloud.CloudError):
                cloud.sync_canonical_writer_access(self.project, 9, {'owner': 'manage'}, root_rules=[])
        members.assert_not_called(); attach.assert_not_called()

    def test_private_acl_denies_all_native_ceiling_groups(self):
        groups = cloud.canonical_native_groups(self.project)
        rules = desired_rules(cloud.project_group_id(self.project), {'owner': 'manage'}, 'private', groups.values())
        denied = {rule['id'] for rule in rules if rule['type'] == 'group' and rule['permissions'] == 0}
        self.assertEqual(denied, {cloud.project_group_id(self.project), *groups.values()})
        self.assertEqual({rule['id'] for rule in rules if rule['type'] == 'user'}, {'owner', 'service-admin'})

    def test_native_ceiling_readback_mismatch_fails_closed(self):
        from unittest.mock import Mock
        reply = Mock()
        with patch('core.cloud._request', return_value=reply), patch('core.cloud._ocs_data', return_value={}), \
             patch('core.cloud.list_team_folders', return_value=[{'id': 9, 'groups': {'writers': 1}}]):
            with self.assertRaises(cloud.CloudError):
                cloud._attach_permission_ceiling(9, 'writers', 15)
