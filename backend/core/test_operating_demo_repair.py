from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from core.models import WorkspaceMembership
from core.operating_models import Initiative, KeyResult, OperatingTask, StrategicObjective, WorkStatus
from core.platform_runtime_v3 import ensure_platform_workspaces
from core.roadmap_execution import ROADMAP_EXECUTION_PLANS, seed_workspace_roadmap_execution
from core.roadmap_models import RoadmapOKRSyncState
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


class RoadmapExecutionRepairTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.hossein = User.objects.create_user(
            username='hossein.darestani@example.com',
            email='hossein.darestani@example.com',
            first_name='Hossein',
            last_name='Darestani',
            password='StrongPass!123',
        )
        self.ahmad = User.objects.create_user(
            username='ahmad@example.com',
            email='ahmad@example.com',
            first_name='Ahmad',
            password='StrongPass!123',
        )
        self.kiarash = User.objects.create_user(
            username='kiarash@example.com',
            email='kiarash@example.com',
            first_name='Kiarash',
            password='StrongPass!123',
        )
        self.sajjad = User.objects.create_user(
            username='sajjad@example.com',
            email='sajjad@example.com',
            first_name='Sajjad',
            password='StrongPass!123',
        )
        self.core = ensure_platform_workspaces(self.hossein)['core']
        for user in (self.ahmad, self.kiarash, self.sajjad):
            WorkspaceMembership.objects.create(
                workspace=self.core,
                user=user,
                role=WorkspaceMembership.Role.MEMBER,
            )

        self.content_objective = StrategicObjective.objects.create(
            workspace=self.core,
            title='O1 · Content engine',
            owner=self.hossein,
            quarter=ROADMAP_PERIOD,
            status=WorkStatus.ACTIVE,
        )
        self.longform_kr = KeyResult.objects.create(
            objective=self.content_objective,
            title='12 long-form videos, 8–20 minutes each',
            owner=self.hossein,
            status=WorkStatus.ACTIVE,
        )
        self.operating_objective = StrategicObjective.objects.create(
            workspace=self.core,
            title='O4 · Operating system',
            owner=self.hossein,
            quarter=ROADMAP_PERIOD,
            status=WorkStatus.ACTIVE,
        )
        self.scientific_review_kr = KeyResult.objects.create(
            objective=self.operating_objective,
            title='Scientific Review for at least 90% of deep content',
            owner=self.hossein,
            status=WorkStatus.ACTIVE,
        )
        RoadmapOKRSyncState.objects.create(
            workspace=self.core,
            source_url='https://example.com/i18n.js',
            bindings={
                'objectives': {
                    'O1': self.content_objective.pk,
                    'O4': self.operating_objective.pk,
                },
                'key_results': {
                    'O1-KR1': self.longform_kr.pk,
                    'O4-KR3': self.scientific_review_kr.pk,
                },
            },
        )

    def test_execution_catalog_covers_every_roadmap_key_result(self):
        expected = {
            f'O{objective}-KR{kr}'
            for objective in range(1, 5)
            for kr in range(1, 9)
        }
        self.assertEqual(set(ROADMAP_EXECUTION_PLANS), expected)

    def test_execution_seed_assigns_real_team_roles(self):
        result = seed_workspace_roadmap_execution(self.core)
        self.assertEqual(result['planned'], 2)

        longform = Initiative.objects.get(
            workspace=self.core,
            key_result=self.longform_kr,
            title__startswith='Roadmap O1-KR1 ·',
        )
        scientific_review = Initiative.objects.get(
            workspace=self.core,
            key_result=self.scientific_review_kr,
            title__startswith='Roadmap O4-KR3 ·',
        )
        self.assertEqual(longform.owner, self.ahmad)
        self.assertEqual(scientific_review.owner, self.sajjad)

        longform_owners = set(longform.tasks.values_list('owner_id', flat=True))
        self.assertEqual(
            longform_owners,
            {self.hossein.pk, self.ahmad.pk, self.kiarash.pk, self.sajjad.pk},
        )
        review_owners = set(scientific_review.tasks.values_list('owner_id', flat=True))
        self.assertEqual(
            review_owners,
            {self.hossein.pk, self.ahmad.pk, self.kiarash.pk, self.sajjad.pk},
        )
        self.assertTrue(all(task.definition_of_done for task in OperatingTask.objects.filter(workspace=self.core)))
        self.assertTrue(all(task.due_date for task in OperatingTask.objects.filter(workspace=self.core)))

    def test_execution_seed_is_idempotent_and_preserves_completion_state(self):
        first = seed_workspace_roadmap_execution(self.core)
        initiative_count = Initiative.objects.filter(workspace=self.core).count()
        task_count = OperatingTask.objects.filter(workspace=self.core).count()
        completed = OperatingTask.objects.filter(workspace=self.core).order_by('id').first()
        completed.status = WorkStatus.DONE
        completed.save(update_fields=['status', 'updated_at'])

        second = seed_workspace_roadmap_execution(self.core)
        completed.refresh_from_db()
        self.assertEqual(completed.status, WorkStatus.DONE)
        self.assertEqual(Initiative.objects.filter(workspace=self.core).count(), initiative_count)
        self.assertEqual(OperatingTask.objects.filter(workspace=self.core).count(), task_count)
        self.assertGreater(first['tasks_created'], 0)
        self.assertEqual(second['initiatives_created'], 0)
        self.assertEqual(second['tasks_created'], 0)
