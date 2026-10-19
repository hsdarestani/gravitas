import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import KnowledgeResource, Workspace


class AssistantApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            'assistant@example.com', 'assistant@example.com', 'A-secure-password-123!'
        )
        self.workspace = Workspace.objects.create(
            name='Assistant notes', kind=Workspace.Kind.PERSONAL, owner=self.user,
        )
        KnowledgeResource.objects.create(
            workspace=self.workspace, owner=self.user, kind=KnowledgeResource.Kind.NOTE,
            title='GPU decision', body='The pipeline stays on CPU until the driver is verified.',
        )
        self.client.force_login(self.user)

    def test_answer_is_grounded_and_cites_matching_pages(self):
        response = self.client.post(
            '/api/platform/ai/ask/', json.dumps({'question': 'What is the GPU decision?'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['grounded'])
        self.assertEqual(payload['sources'][0]['title'], 'GPU decision')
        self.assertIn('pipeline stays on CPU', payload['answer'])


    @patch('core.assistant_api.timezone.localdate', return_value=date(2026, 10, 6))
    @patch('core.assistant_api.run_text')
    @patch('core.assistant_api.configured', return_value=True)
    def test_core_surface_routes_to_project_task_and_hides_internal_acl_label(
        self,
        configured,
        run_text,
        localdate,
    ):
        run_text.return_value = SimpleNamespace(
            text='You have one open task.',
            provider='fake',
            run_id='core-run-1',
            skill='project_task',
            model_tier='general',
        )
        response = self.client.post(
            '/api/platform/ai/ask/',
            json.dumps({
                'question': 'What are my current project tasks?',
                'surface': 'core',
                'thread_id': 'primary',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['surface'], 'core')
        self.assertEqual(payload['skill'], 'project_task')
        kwargs = run_text.call_args.kwargs
        self.assertEqual(kwargs['surface'], 'core')
        self.assertEqual(kwargs['skill'], 'project_task')
        self.assertNotIn('ACL-checked', kwargs['system'])
        self.assertNotIn('ACL-checked', kwargs['user'])
        self.assertIn('Accessible GraviQuest context', kwargs['user'])
        self.assertIn('authoritative current date is 2026-10-06', kwargs['system'])
        self.assertIn('Current date: 2026-10-06', kwargs['user'])
        self.assertIn('only treat items explicitly assigned to the authenticated current user as theirs', kwargs['system'])

    @patch('core.assistant_api.run_text')
    @patch('core.assistant_api.configured', return_value=True)
    def test_learning_surface_selects_learning_skill(self, configured, run_text):
        run_text.return_value = SimpleNamespace(
            text='Learning answer',
            provider='fake',
            run_id='learning-run-1',
            skill='learning',
            model_tier='general',
        )
        response = self.client.post(
            '/api/platform/ai/ask/',
            json.dumps({
                'question': 'What should I learn next?',
                'surface': 'learning',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['surface'], 'learning')
        self.assertEqual(payload['skill'], 'learning')
        kwargs = run_text.call_args.kwargs
        self.assertEqual(kwargs['surface'], 'learning')
        self.assertEqual(kwargs['skill'], 'learning')

    def test_question_and_authentication_are_required(self):
        self.assertEqual(
            self.client.post('/api/platform/ai/ask/', '{}', content_type='application/json').status_code,
            400,
        )
        self.client.logout()
        self.assertEqual(
            self.client.post('/api/platform/ai/ask/', '{}', content_type='application/json').status_code,
            401,
        )

    @patch('core.assistant_api.PulsarContextEngine')
    @patch('core.assistant_api.run_text')
    def test_workspace_navigation_has_one_real_link_and_no_research_rag(self, model, context):
        response = self.client.post(
            '/api/platform/ai/ask/',
            json.dumps({'question': 'where is research intelligence'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertEqual(payload['intent'], 'navigation')
        self.assertEqual(payload['provider'], 'workspace_navigation')
        self.assertEqual(len(payload['sources']), 1)
        self.assertEqual(payload['sources'][0]['href'], '/workspace/research')
        self.assertIn('not a separate item', payload['answer'])
        self.assertLessEqual(len(payload['answer']), 180)
        self.assertNotIn('historical source evidence', str(payload).lower())
        context.assert_not_called()
        model.assert_not_called()

    @patch('core.assistant_api.run_text')
    @patch('core.assistant_api.configured', return_value=True)
    def test_pulsar_limits_generic_answers_and_source_links(self, configured, model):
        with patch('core.assistant_api.PulsarContextEngine') as engine:
            engine.return_value.workspace.return_value = SimpleNamespace(
                text='A direct answer from a relevant user note.',
                sources=[{'title': f'Source {i}', 'href': f'/workspace/page/{i}'} for i in range(8)],
                metadata={},
            )
            model.return_value = SimpleNamespace(
                text='A concise response.', provider='fake', run_id='run', skill='research',
                model_tier='general',
            )
            response = self.client.post(
                '/api/platform/ai/ask/',
                json.dumps({'question': 'Summarize the findings from the source note.'}),
                content_type='application/json',
            )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()['sources']), 4)
        self.assertEqual(model.call_args.kwargs['max_tokens'], 550)
        self.assertIn('never infer menu locations from historic tasks', model.call_args.kwargs['system'])
