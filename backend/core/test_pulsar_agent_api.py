import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from .pulsar_runtime.agent import AgentOutcome


class PulsarAgentApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='pulsar-agent-api@example.test',
            email='pulsar-agent-api@example.test',
            password='Strong-pass-123!',
        )

    def test_agent_endpoint_requires_authentication(self):
        response = self.client.post(
            '/api/platform/pulsar/agent/',
            json.dumps({'message': 'hello'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 401)

    @patch('core.pulsar_agent_api.PulsarAgent.run')
    def test_agent_endpoint_returns_tool_and_source_contract(self, run):
        run.return_value = AgentOutcome(
            status='completed',
            reply='Grounded answer',
            run_id='run-1',
            tool='research.search',
            sources=[{'id': '1', 'title': 'Source'}],
            data={'count': 1},
        )
        self.client.force_login(self.user)
        response = self.client.post(
            '/api/platform/pulsar/agent/',
            json.dumps({
                'message': 'What did we find?',
                'surface': 'research',
                'thread_id': 'primary',
                'metadata': {'project_id': 9},
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['ok'])
        self.assertEqual(payload['status'], 'completed')
        self.assertEqual(payload['tool'], 'research.search')
        self.assertEqual(payload['sources'][0]['title'], 'Source')
        kwargs = run.call_args.kwargs
        self.assertEqual(kwargs['surface'], 'research')
        self.assertEqual(kwargs['metadata']['project_id'], 9)
