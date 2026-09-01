from django.contrib.auth import get_user_model
from django.test import TestCase

from core.models import WorkspaceMembership
from core.operating_models import Initiative, KeyResult, OperatingTask, StrategicObjective, WorkStatus
from core.platform_runtime_v3 import ensure_platform_workspaces
from core.roadmap_assignment import ROLE_BLOCK_PREFIX, reconcile_workspace_roadmap_assignments
from core.roadmap_models import RoadmapOKRSyncState
from core.roadmap_okr import ROADMAP_PERIOD


class RoadmapAssignmentTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.hossein = User.objects.create_user(
            username='hossein.darestani@example.com',
            email='hossein.darestani@example.com',
            first_name='Hossein',
            last_name='Darestani',
            password='StrongPass!123',
        )
        self.sajjad = User.objects.create_user(
            username='sajjad@example.com',
            email='sajjad@example.com',
            first_name='Sajjad',
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
        self.core = ensure_platform_workspaces(self.hossein)['core']
        WorkspaceMembership.objects.create(
            workspace=self.core,
            user=self.sajjad,
            role=WorkspaceMembership.Role.MEMBER,
        )

        objective = StrategicObjective.objects.create(
            workspace=self.core,
            title='O1 · Content engine',
            owner=self.hossein,
            quarter=ROADMAP_PERIOD,
            status=WorkStatus.ACTIVE,
        )
        self.kr = KeyResult.objects.create(
            objective=objective,
            title='12 long-form videos, 8–20 minutes each',
            owner=self.hossein,
            status=WorkStatus.ACTIVE,
        )
        RoadmapOKRSyncState.objects.create(
            workspace=self.core,
            source_url='https://example.com/i18n.js',
            bindings={
                'objectives': {'O1': objective.pk},
                'key_results': {'O1-KR1': self.kr.pk},
            },
        )

    def test_unlinked_team_roles_are_blocked_instead_of_silently_misassigned(self):
        result = reconcile_workspace_roadmap_assignments(self.core)
        self.assertEqual(result['unresolved_roles'], ['ahmad', 'kiarash'])
        initiative = Initiative.objects.get(
            workspace=self.core,
            title__startswith='Roadmap O1-KR1 ·',
        )
        self.assertEqual(initiative.owner, self.hossein)
        self.assertIn('Intended accountable team member: Ahmad', initiative.description)

        ahmad_task = initiative.tasks.get(title='Produce, edit and QA the long-form release batch')
        kiarash_task = initiative.tasks.get(title='Define and maintain the reusable long-form visual system')
        sajjad_task = initiative.tasks.get(title='Prepare evidence maps and scientific briefs for the next video batch')
        self.assertEqual(ahmad_task.status, WorkStatus.BLOCKED)
        self.assertEqual(kiarash_task.status, WorkStatus.BLOCKED)
        self.assertTrue(ahmad_task.blocked_reason.startswith(ROLE_BLOCK_PREFIX))
        self.assertTrue(kiarash_task.blocked_reason.startswith(ROLE_BLOCK_PREFIX))
        self.assertEqual(sajjad_task.status, WorkStatus.ACTIVE)
        self.assertIn('Intended team owner: Ahmad', ahmad_task.description)

    def test_linking_team_members_reconciles_existing_tasks_without_duplicates(self):
        reconcile_workspace_roadmap_assignments(self.core)
        initial_initiatives = Initiative.objects.filter(workspace=self.core).count()
        initial_tasks = OperatingTask.objects.filter(workspace=self.core).count()

        WorkspaceMembership.objects.create(
            workspace=self.core,
            user=self.ahmad,
            role=WorkspaceMembership.Role.MEMBER,
        )
        WorkspaceMembership.objects.create(
            workspace=self.core,
            user=self.kiarash,
            role=WorkspaceMembership.Role.MEMBER,
        )
        result = reconcile_workspace_roadmap_assignments(self.core)

        initiative = Initiative.objects.get(
            workspace=self.core,
            title__startswith='Roadmap O1-KR1 ·',
        )
        self.assertEqual(initiative.owner, self.ahmad)
        ahmad_task = initiative.tasks.get(title='Produce, edit and QA the long-form release batch')
        kiarash_task = initiative.tasks.get(title='Define and maintain the reusable long-form visual system')
        self.assertEqual(ahmad_task.owner, self.ahmad)
        self.assertEqual(kiarash_task.owner, self.kiarash)
        self.assertEqual(ahmad_task.status, WorkStatus.ACTIVE)
        self.assertEqual(kiarash_task.status, WorkStatus.ACTIVE)
        self.assertEqual(ahmad_task.blocked_reason, '')
        self.assertEqual(kiarash_task.blocked_reason, '')
        self.assertEqual(result['unresolved_roles'], [])
        self.assertEqual(Initiative.objects.filter(workspace=self.core).count(), initial_initiatives)
        self.assertEqual(OperatingTask.objects.filter(workspace=self.core).count(), initial_tasks)
