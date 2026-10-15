from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.test import TestCase
from core import cloud
from core.models import NextcloudIdentity


class ExistingIdentityLockTests(TestCase):
    def test_existing_identity_does_not_lock_authentication_user(self):
        user=get_user_model().objects.create_user(username='existing-native-user')
        identity=NextcloudIdentity.objects.create(user=user,username='gravitas-u-test',encrypted_password='unchanged-ciphertext')
        with patch.object(get_user_model().objects,'select_for_update') as lock, patch('core.cloud._request') as request:
            result=cloud.ensure_identity(user,1024)
        self.assertEqual(result.pk,identity.pk)
        self.assertEqual(result.encrypted_password,'unchanged-ciphertext')
        lock.assert_not_called()
        request.assert_not_called()

    def test_missing_identity_still_serializes_provisioning_and_rechecks(self):
        user=get_user_model().objects.create_user(username='racing-native-user')
        identity=NextcloudIdentity(user=user,username='already-provisioned',encrypted_password='unchanged')
        with patch('core.cloud.NextcloudIdentity.objects.filter') as query, patch.object(get_user_model().objects,'select_for_update') as lock, patch('core.cloud._request') as request:
            query.return_value.first.side_effect=[None,identity]
            result=cloud.ensure_identity(user,1024)
        lock.return_value.only.return_value.get.assert_called_once_with(pk=user.pk)
        self.assertIs(result,identity)
        request.assert_not_called()
