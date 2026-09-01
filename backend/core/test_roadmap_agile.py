from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase

from core.operating_models import Initiative, KeyResult, OperatingCycle, OperatingTask, StrategicObjective, WorkStatus
from core.platform_runtime_v3 import ensure_platform_workspaces
from core.roadmap_agile import ROADMAP_END_DATE, ROADMAP_START_DATE
from core.roadmap_assignment import reconcile_workspace_roadmap_assignments
from core.roadmap_models import RoadmapOKRSyncState
from core.roadmap_okr import ROADMAP_PERIOD


class AgileRoadmapScheduleTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.hossein = User.objects.create_user(
            username='hossein.agile@example.com',
            email='hossein.agile@example.com',
            first_name='Hossein',
            last_name='Darestani',
            password='StrongPass!123',
        )
        self.core = ensure_platform_workspaces(self.hossein)['core']
        self.objective = StrategicObjective.objects.create(
            workspace=self.core,
            title='O1 · Content engine',
            owner=self.hossein,
            quarter=ROADMAP_PERIOD,
            status=WorkStatus.ACTIVE,
        )
        self.kr = KeyResult.objects.create(
            objective=self.objective,
            title='12 long-form videos, 8–20 minutes each',
            owner=self.hossein,
            status=WorkStatus.ACTIVE,
        )
        RoadmapOKRSyncState.objects.create(
            workspace=self.core,
            source_url='https://example.com/i18n.js',
            bindings={
                'objectives': {'O1': self.objective.pk},
                'key_results': {'O1-KR1': self.kr.pk},
            },
        )

    def test_roadmap_starts_sep_12_and_uses_agile_sprints(self):
        result = reconcile_workspace_roadmap_assignments(self.core)
        self.assertEqual(result['cycles_created'], 14)
        self.assertEqual(result['kickoff_tasks_created'], 4)

        self.objective.refresh_from_db()
        self.assertEqual(self.objective.start_date, ROADMAP_START_DATE)
        self.assertEqual(self.objective.due_date, ROADMAP_END_DATE)

        initiative = Initiative.objects.get(
            workspace=self.core,
            title__startswith='Roadmap O1-KR1 ·',
        )
        self.assertEqual(initiative.start_date, date(2026, 9, 12))
        self.assertEqual(initiative.due_date, date(2027, 3, 12))

        kickoff = OperatingCycle.objects.get(
            workspace=self.core,
            name='Roadmap Kickoff · Character lock & production setup',
        )
        sprint_one = OperatingCycle.objects.get(
            workspace=self.core,
            name='Roadmap Sprint 01 · Video flow & pilot',
        )
        closeout = OperatingCycle.objects.get(
            workspace=self.core,
            name='Roadmap Closeout · Six-month review & next roadmap',
        )
        self.assertEqual((kickoff.start_date, kickoff.end_date), (date(2026, 9, 12), date(2026, 9, 18)))
        self.assertEqual((sprint_one.start_date, sprint_one.end_date), (date(2026, 9, 19), date(2026, 10, 2)))
        self.assertEqual((closeout.start_date, closeout.end_date), (date(2027, 3, 6), date(2027, 3, 12)))
        self.assertEqual(
            OperatingCycle.objects.filter(workspace=self.core).exclude(status=WorkStatus.ARCHIVED).count(),
            14,
        )

        character = OperatingTask.objects.get(
            workspace=self.core,
            title='Finalize the Gravitas on-screen character and visual rules',
        )
        integration = OperatingTask.objects.get(
            workspace=self.core,
            title='Lock character implementation inside the reusable video scene and prompt pack',
        )
        flow = OperatingTask.objects.get(
            workspace=self.core,
            title='Lock the video production flow from scientific brief to publish',
        )
        review = OperatingTask.objects.get(
            workspace=self.core,
            title='Lock the scientific review gate and handoff SLA for the video flow',
        )
        calendar = OperatingTask.objects.get(
            workspace=self.core,
            title='Lock the six-month long-form calendar and production slots',
        )
        self.assertEqual(character.due_date, date(2026, 9, 16))
        self.assertEqual(integration.due_date, date(2026, 9, 18))
        self.assertEqual(flow.due_date, date(2026, 9, 22))
        self.assertEqual(review.due_date, date(2026, 9, 24))
        self.assertEqual(calendar.due_date, date(2026, 9, 26))
        self.assertEqual(calendar.dependency, review)

    def test_rerun_is_idempotent(self):
        reconcile_workspace_roadmap_assignments(self.core)
        cycle_count = OperatingCycle.objects.filter(workspace=self.core).count()
        task_count = OperatingTask.objects.filter(workspace=self.core).count()
        second = reconcile_workspace_roadmap_assignments(self.core)
        self.assertEqual(second['cycles_created'], 0)
        self.assertEqual(second['kickoff_tasks_created'], 0)
        self.assertEqual(OperatingCycle.objects.filter(workspace=self.core).count(), cycle_count)
        self.assertEqual(OperatingTask.objects.filter(workspace=self.core).count(), task_count)
