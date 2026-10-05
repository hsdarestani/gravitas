from django.contrib.auth import get_user_model
from django.test import TestCase

from .operating_models import KeyResult, OperatingTask, StrategicObjective
from .platform_runtime_v3 import ensure_platform_workspaces
from .pulsar_runtime.errors import PulsarApprovalRequired
from .pulsar_runtime.tool_executor import PulsarToolExecutor
from .pulsar_task_service import create_operating_task


class PulsarTaskActionTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='pulsar-task-action@example.test',
            email='pulsar-task-action@example.test',
            password='Strong-pass-123!',
        )
        spaces = ensure_platform_workspaces(self.user)
        self.core = spaces['core']
        self.objective = StrategicObjective.objects.create(
            workspace=self.core,
            title='Pulsar execution',
            owner=self.user,
        )
        self.kr = KeyResult.objects.create(
            objective=self.objective,
            title='Ship safe agent actions',
            owner=self.user,
            baseline_value=0,
            target_value=10,
            current_value=0,
            unit='items',
        )
        self.draft = {
            'title': 'Implement the shared action path',
            'description': 'Use one task service across Pulsar surfaces.',
            'definition_of_done': 'The action path is tested and merged.',
            'priority': 'p1',
            'due_date': '2026-10-20',
            'owner_id': self.user.pk,
            'key_result_id': self.kr.pk,
        }

    def test_shared_service_requires_explicit_r2_approval(self):
        with self.assertRaises(PulsarApprovalRequired):
            create_operating_task(
                self.user,
                self.draft,
                confirmed=False,
            )
        self.assertFalse(
            OperatingTask.objects.filter(
                title=self.draft['title'],
            ).exists()
        )

    def test_shared_service_creates_valid_core_task_after_approval(self):
        task = create_operating_task(
            self.user,
            self.draft,
            confirmed=True,
            source='test_pulsar',
        )
        self.assertEqual(task.workspace, self.core)
        self.assertEqual(task.owner, self.user)
        self.assertEqual(task.initiative.key_result, self.kr)
        self.assertEqual(task.priority, 'p1')
        self.assertEqual(task.due_date.isoformat(), '2026-10-20')
        self.assertEqual(task.status, 'active')

    def test_generic_agent_tool_uses_same_approved_service(self):
        executor = PulsarToolExecutor()
        with self.assertRaises(PulsarApprovalRequired):
            executor.execute(
                self.user,
                'tasks.create',
                self.draft,
                confirmed=False,
            )

        result = executor.execute(
            self.user,
            'tasks.create',
            self.draft,
            confirmed=True,
        )
        self.assertEqual(result.tool, 'tasks.create')
        task = OperatingTask.objects.get(pk=result.data['task_id'])
        self.assertEqual(task.initiative.key_result_id, self.kr.pk)
        self.assertEqual(result.sources[0]['kind'], 'task')

    def test_invalid_key_result_cannot_escape_core_workspace(self):
        other = get_user_model().objects.create_user(
            username='pulsar-task-other@example.test',
            email='pulsar-task-other@example.test',
            password='Strong-pass-123!',
        )
        other_core = ensure_platform_workspaces(other)['core']
        other_objective = StrategicObjective.objects.create(
            workspace=other_core,
            title='Other objective',
            owner=other,
        )
        other_kr = KeyResult.objects.create(
            objective=other_objective,
            title='Other KR',
            owner=other,
        )
        bad = dict(self.draft)
        bad['key_result_id'] = other_kr.pk

        with self.assertRaises(ValueError):
            create_operating_task(
                self.user,
                bad,
                confirmed=True,
            )
        self.assertFalse(
            OperatingTask.objects.filter(title=bad['title']).exists()
        )
