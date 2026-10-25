from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import Workspace
from .operating_models import KeyResult, OperatingTask, StrategicObjective, TaskInAppNotification
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

    def test_no_matching_kr_notifies_manager_including_self_reports(self):
        unlinked = dict(self.draft, key_result_id=None, due_date=None)
        with override_settings(GRAVITAS_PROJECT_MANAGER_EMAIL=self.user.email):
            task = create_operating_task(self.user, unlinked, confirmed=True)
        self.assertIsNone(task.initiative_id)
        notices = TaskInAppNotification.objects.filter(
            recipient=self.user,
            event_key=f'pulsar-kr-unmatched:{task.pk}',
        )
        self.assertEqual(notices.count(), 1)

    def test_canonical_project_task_creation_uses_write_journal(self):
        """Telegram/Pulsar tasks must use the adopted project's guarded path."""
        from unittest.mock import patch

        from .canonical_journal import RecoveryRequired
        from .models import ResearchProject

        project = ResearchProject.objects.create(
            workspace=self.core,
            owner=self.user,
            title='Topic 01',
        )
        draft = dict(
            self.draft,
            project_id=project.pk,
            key_result_id=None,
            due_date=None,
            source_key='pulsar-telegram:topic01:1',
        )
        with patch('core.canonical_signals.active', return_value=True), \
             patch('core.canonical_signals.project_for', return_value=project), \
             patch('core.canonical_signals.flush_pending') as flush:
            with self.assertRaisesMessage(
                RecoveryRequired, 'use_canonical_operation_for_project_write',
            ):
                OperatingTask.objects.create(
                    workspace=self.core, project=project, owner=self.user,
                    title='Unsafe unguarded project task',
                )
            task = create_operating_task(
                self.user, draft, confirmed=True, source='telegram_pulsar',
            )
            flush.assert_called_once()
            # Repeated callback retries must reuse the source-bound task.
            repeated = create_operating_task(
                self.user, draft, confirmed=True, source='telegram_pulsar',
            )

        self.assertEqual(task.pk, repeated.pk)
        self.assertEqual(task.project_id, project.pk)
        self.assertEqual(
            OperatingTask.objects.filter(source_key=draft['source_key']).count(), 1,
        )

    def test_invalid_key_result_cannot_escape_core_workspace(self):
        other = get_user_model().objects.create_user(
            username='pulsar-task-other@example.test',
            email='pulsar-task-other@example.test',
            password='Strong-pass-123!',
        )
        other_core = Workspace.objects.create(
            name='Foreign workspace',
            kind=Workspace.Kind.PERSONAL,
            owner=other,
        )
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
