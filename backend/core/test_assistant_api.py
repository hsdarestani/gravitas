import json
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


    @patch('core.assistant_api.run_text')
    @patch('core.assistant_api.configured', return_value=True)
    def test_core_surface_routes_to_project_task_and_hides_internal_acl_label(
        self,
        configured,
        run_text,
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
        self.assertEqual(payload['skill'], 'project_task')
        kwargs = run_text.call_args.kwargs
        self.assertEqual(kwargs['surface'], 'core')
        self.assertEqual(kwargs['skill'], 'project_task')
        self.assertNotIn('ACL-checked', kwargs['system'])
        self.assertNotIn('ACL-checked', kwargs['user'])
        self.assertIn('Accessible Gravitas context', kwargs['user'])

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
