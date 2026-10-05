from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import PulsarThread
from .pulsar_runtime.agent import PulsarAgent
from .pulsar_runtime.errors import PulsarApprovalRequired, PulsarPermissionError
from .pulsar_runtime.policy import ActionPolicy
from .pulsar_runtime.tool_executor import ToolExecutionResult
from .pulsar_runtime.tools import ToolRegistry


class FakeHarness:
    def __init__(self, *texts):
        self.texts = list(texts)
        self.calls = []

    def run_text(self, **kwargs):
        self.calls.append(kwargs)
        text = self.texts.pop(0)
        return SimpleNamespace(text=text, run_id=f'run-{len(self.calls)}')


class FakeExecutor:
    def __init__(self):
        self.tools = ToolRegistry()
        self.calls = []

    def supported_names(self, *, skill_name, profile):
        if skill_name == 'research':
            return ('research.search',)
        if skill_name == 'learning':
            return ('lms.read', 'learning.notes')
        if skill_name == 'project_task':
            return ('tasks.read', 'tasks.draft')
        return ()

    def execute(self, actor, tool_name, args=None, *, confirmed=False):
        self.calls.append({
            'tool': tool_name,
            'args': dict(args or {}),
            'confirmed': confirmed,
        })
        if tool_name == 'learning.notes' and not confirmed:
            raise PulsarApprovalRequired('pulsar_approval_required:learning.notes')
        return ToolExecutionResult(
            tool=tool_name,
            content=f'grounded result from {tool_name}',
            data={'confirmed': confirmed},
            sources=[{'id': '1', 'title': 'Source One', 'kind': 'note'}],
        )


class PulsarAgentTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='pulsar-agent@example.test',
            email='pulsar-agent@example.test',
            password='Strong-pass-123!',
        )

    def test_agent_plans_one_read_tool_then_returns_grounded_answer(self):
        harness = FakeHarness(
            '{"action":"tool","tool":"research.search","args":{"query":"replication"}}',
            'Grounded answer',
        )
        executor = FakeExecutor()
        result = PulsarAgent(harness=harness, executor=executor).run(
            self.user,
            'What do our notes say about replication?',
            surface='research',
            metadata={'project_id': 7},
        )

        self.assertEqual(result.status, 'completed')
        self.assertEqual(result.reply, 'Grounded answer')
        self.assertEqual(result.tool, 'research.search')
        self.assertEqual(executor.calls[0]['args']['project_id'], 7)
        self.assertFalse(executor.calls[0]['confirmed'])
        self.assertEqual(harness.calls[0]['operation'], 'route')
        self.assertEqual(harness.calls[1]['operation'], 'answer')

    def test_agent_stores_pending_side_effect_and_executes_only_after_confirmation(self):
        harness = FakeHarness(
            '{"action":"tool","tool":"learning.notes","args":{"course_id":4,"body":"Remember this"}}',
            'Note saved.',
        )
        executor = FakeExecutor()
        agent = PulsarAgent(harness=harness, executor=executor)

        pending = agent.run(
            self.user,
            'Save a note saying remember this.',
            surface='lms',
            skill='learning',
        )
        self.assertEqual(pending.status, 'approval_required')
        self.assertTrue(pending.approval_required)
        thread = PulsarThread.objects.get(user=self.user, thread_key='primary')
        self.assertEqual(thread.state['pending_tool']['tool'], 'learning.notes')
        self.assertFalse(executor.calls[0]['confirmed'])

        completed = agent.run(
            self.user,
            '',
            surface='lms',
            skill='learning',
            confirm=True,
        )
        self.assertEqual(completed.status, 'completed')
        self.assertEqual(completed.reply, 'Note saved.')
        self.assertTrue(executor.calls[1]['confirmed'])
        thread.refresh_from_db()
        self.assertNotIn('pending_tool', thread.state)

    def test_invalid_planner_output_falls_back_to_direct_answer(self):
        harness = FakeHarness('not valid json', 'Direct answer')
        executor = FakeExecutor()
        result = PulsarAgent(harness=harness, executor=executor).run(
            self.user,
            'Hello Pulsar',
            surface='research',
        )
        self.assertEqual(result.status, 'completed')
        self.assertEqual(result.reply, 'Direct answer')
        self.assertEqual(executor.calls, [])

    def test_planner_cannot_select_tool_outside_executable_skill_tools(self):
        harness = FakeHarness(
            '{"action":"tool","tool":"tasks.create","args":{"title":"x"}}',
        )
        with self.assertRaises(PulsarPermissionError):
            PulsarAgent(harness=harness, executor=FakeExecutor()).run(
                self.user,
                'Create a task.',
                surface='core',
                skill='project_task',
            )

    def test_profile_write_mode_can_make_r1_learning_action_require_approval(self):
        with self.assertRaises(PulsarApprovalRequired):
            ActionPolicy().decide(
                self.user,
                'learning.notes',
                confirmed=False,
            )
