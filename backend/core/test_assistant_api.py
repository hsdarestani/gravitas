import json

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
