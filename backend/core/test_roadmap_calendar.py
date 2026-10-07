from django.contrib.auth import get_user_model
from django.test import TestCase

from core.operating_models import (
    KeyResult,
    OperatingCycle,
    OperatingMilestone,
    OperatingTask,
    OperatingWorkPackage,
    StrategicObjective,
    WorkStatus,
)
from core.platform_runtime_v3 import ensure_platform_workspaces
from core.roadmap_calendar import seed_workspace_roadmap_calendar
from core.roadmap_execution import seed_workspace_roadmap_execution
from core.roadmap_models import RoadmapOKRSyncState
from core.roadmap_okr import ROADMAP_PERIOD


class RoadmapCalendarTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.hossein = User.objects.create_user(
            username='hossein.calendar@example.com',
            email='hossein.calendar@example.com',
            first_name='Hossein',
            last_name='Darestani',
            password='StrongPass!123',
        )
        self.core = ensure_platform_workspaces(self.hossein)['core']

        objective_specs = {
            'O1': ('Content engine', 'O1-KR1', '12 long-form videos'),
            'O3': ('Revenue engine', 'O3-KR1', 'Four packaged scientific offers'),
            'O4': ('Operating system', 'O4-KR3', 'Scientific review coverage'),
        }
        objective_bindings = {}
        kr_bindings = {}
        for objective_key, (title, kr_key, kr_title) in objective_specs.items():
            objective = StrategicObjective.objects.create(
                workspace=self.core,
                title=f'{objective_key} · {title}',
                owner=self.hossein,
                quarter=ROADMAP_PERIOD,
                status=WorkStatus.ACTIVE,
            )
            kr = KeyResult.objects.create(
                objective=objective,
                title=kr_title,
                owner=self.hossein,
                status=WorkStatus.ACTIVE,
            )
            objective_bindings[objective_key] = objective.pk
            kr_bindings[kr_key] = kr.pk

        RoadmapOKRSyncState.objects.create(
            workspace=self.core,
            source_url='https://example.com/i18n.js',
            bindings={
                'objectives': objective_bindings,
                'key_results': kr_bindings,
            },
        )
        seed_workspace_roadmap_execution(self.core)

    def test_calendar_materializes_cycles_milestones_packages_and_task_links(self):
        result = seed_workspace_roadmap_calendar(self.core)

        self.assertEqual(result['cycles_created'], 6)
        self.assertEqual(result['milestones_created'], 3)
        self.assertEqual(result['work_packages_created'], 1)
        self.assertEqual(OperatingCycle.objects.filter(workspace=self.core).count(), 6)
        self.assertEqual(OperatingMilestone.objects.filter(workspace=self.core).count(), 3)
        self.assertEqual(OperatingWorkPackage.objects.filter(workspace=self.core).count(), 1)

        roadmap_tasks = OperatingTask.objects.filter(workspace=self.core)
        self.assertTrue(roadmap_tasks.exists())
        self.assertFalse(roadmap_tasks.filter(cycle__isnull=True).exists())
        self.assertFalse(roadmap_tasks.filter(milestone__isnull=True).exists())

        commercial_tasks = roadmap_tasks.filter(initiative__title__startswith='Roadmap O3-KR1 ·')
        self.assertTrue(commercial_tasks.exists())
        self.assertFalse(commercial_tasks.filter(work_package__isnull=True).exists())

    def test_calendar_is_idempotent_and_preserves_manual_task_cycle(self):
        seed_workspace_roadmap_calendar(self.core)
        cycles = list(OperatingCycle.objects.filter(workspace=self.core).order_by('start_date'))
        task = OperatingTask.objects.filter(workspace=self.core).order_by('id').first()
        task.cycle = cycles[-1]
        task.save(update_fields=['cycle', 'updated_at'])

        result = seed_workspace_roadmap_calendar(self.core)
        task.refresh_from_db()

        self.assertEqual(result['cycles_created'], 0)
        self.assertEqual(result['milestones_created'], 0)
        self.assertEqual(result['work_packages_created'], 0)
        self.assertEqual(task.cycle_id, cycles[-1].pk)
        self.assertEqual(OperatingCycle.objects.filter(workspace=self.core).count(), 6)
        self.assertEqual(OperatingMilestone.objects.filter(workspace=self.core).count(), 3)
        self.assertEqual(OperatingWorkPackage.objects.filter(workspace=self.core).count(), 1)
