from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from core.operating_models import KeyResult, StrategicObjective, WorkStatus
from core.platform_runtime_v3 import ensure_platform_workspaces
from core.roadmap_okr import ROADMAP_PERIOD


class OperatingDemoRepairTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='demo-repair@example.com',
            email='demo-repair@example.com',
            password='StrongPass!123',
        )
        self.core = ensure_platform_workspaces(self.user)['core']

    def seed_roadmap(self):
        objectives = []
        for index in range(4):
            objective = StrategicObjective.objects.create(
                workspace=self.core,
                title=f'Roadmap objective {index + 1}',
                owner=self.user,
                quarter=ROADMAP_PERIOD,
                status=WorkStatus.ACTIVE,
            )
            KeyResult.objects.create(
                objective=objective,
                title=f'Roadmap KR {index + 1}',
                owner=self.user,
                status=WorkStatus.ACTIVE,
            )
            objectives.append(objective)
        return objectives

    @patch('core.management.commands.repair_core_roadmap_okr.sync_workspace_okr')
    def test_missing_roadmap_is_repaired_in_canonical_core(self, sync):
        sync.side_effect = lambda workspace: self.seed_roadmap()
        out = StringIO()
        call_command('repair_core_roadmap_okr', stdout=out)
        sync.assert_called_once_with(self.core)
        self.assertIn('objectives=4', out.getvalue())
        self.assertIn('key_results=4', out.getvalue())
        self.assertIn('repaired=true', out.getvalue())

    @patch('core.management.commands.repair_core_roadmap_okr.sync_workspace_okr')
    def test_complete_roadmap_does_not_hit_remote_source(self, sync):
        self.seed_roadmap()
        out = StringIO()
        call_command('repair_core_roadmap_okr', stdout=out)
        sync.assert_not_called()
        self.assertIn('repaired=false', out.getvalue())

    def test_operating_dashboard_reads_canonical_core_counts(self):
        self.seed_roadmap()
        self.client.force_login(self.user)
        response = self.client.get('/api/operating/dashboard/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['workspace']['id'], self.core.pk)
        self.assertEqual(data['counts']['objectives'], 4)
        self.assertEqual(data['counts']['key_results'], 4)
