from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from core.operating_models import Initiative, KeyResult, OperatingProcess, Priority, StrategicObjective
from core.platform_runtime_v3 import ensure_platform_workspaces


User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False)
class OperatingDashboardRecencyTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='operating-recency@example.com',
            email='operating-recency@example.com',
            password='test-password-123',
        )
        self.workspace = ensure_platform_workspaces(self.user)['core']
        self.client.force_login(self.user)
        # The first dashboard request provisions the fixed five-process model.
        response = self.client.get('/api/operating/dashboard/')
        self.assertEqual(response.status_code, 200)
        self.process = OperatingProcess.objects.get(workspace=self.workspace, key='research')
        self.objective = StrategicObjective.objects.create(
            workspace=self.workspace,
            title='Recency objective',
            owner=self.user,
        )
        self.kr = KeyResult.objects.create(
            objective=self.objective,
            title='Recency KR',
            owner=self.user,
        )

    def test_recent_initiatives_are_newest_first_not_priority_first(self):
        # Initiative.Meta sorts priority before updated_at. Eight P0 rows would
        # therefore exclude a newly created P1 from a naive [:8] dashboard slice.
        for index in range(8):
            Initiative.objects.create(
                workspace=self.workspace,
                key_result=self.kr,
                process=self.process,
                title=f'Older P0 initiative {index}',
                owner=self.user,
                priority=Priority.P0,
            )

        newest = Initiative.objects.create(
            workspace=self.workspace,
            key_result=self.kr,
            process=self.process,
            title='Newest P1 initiative',
            owner=self.user,
            priority=Priority.P1,
        )

        response = self.client.get('/api/operating/dashboard/')
        self.assertEqual(response.status_code, 200)
        recent = response.json()['recent_initiatives']
        ids = [item['id'] for item in recent]

        self.assertEqual(len(recent), 8)
        self.assertEqual(ids[0], newest.pk)
        self.assertIn(newest.pk, ids)
