import json

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import PulsarMemoryEntry, PulsarRun, PulsarThread
from .pulsar_runtime.harness import PulsarHarness
from .pulsar_runtime.memory import recall, remember
from .pulsar_runtime.types import ProviderResponse


class FakeGateway:
    def __init__(self, answer='ok'):
        self.answer = answer
        self.calls = []

    def configured(self):
        return True

    def complete(self, **kwargs):
        self.calls.append(kwargs)
        return ProviderResponse(
            text=self.answer,
            provider='fake-provider',
            model='fake-model',
            latency_ms=3,
        )


class PulsarMemoryContinuityTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='pulsar-memory@example.test',
            email='pulsar-memory@example.test',
            password='Strong-pass-123!',
        )

    def test_scoped_memory_recall_respects_project_scope(self):
        remember(
            self.user,
            kind='semantic',
            content='Project Alpha uses a weekly evidence review.',
            scope={'project_id': 11, 'skill': 'research'},
        )
        remember(
            self.user,
            kind='semantic',
            content='Project Beta uses a monthly review.',
            scope={'project_id': 22, 'skill': 'research'},
        )
        rows = recall(
            self.user,
            'evidence review',
            scope={'project_id': 11, 'skill': 'research'},
        )
        self.assertEqual(
            [row.content for row in rows],
            ['Project Alpha uses a weekly evidence review.'],
        )

    def test_same_thread_carries_context_across_surfaces(self):
        first = FakeGateway('The agreed approach is evidence first.')
        PulsarHarness(models=first).run_text(
            system='system',
            user='What approach did we agree on?',
            surface='research',
            skill='research',
            operation='answer',
            thread_id='primary',
            actor=self.user,
            metadata={'turn_input': 'What approach did we agree on?'},
        )

        second = FakeGateway('second answer')
        result = PulsarHarness(models=second).run_text(
            system='system',
            user='Use that approach for this lesson.',
            surface='lms',
            skill='learning',
            operation='answer',
            thread_id='primary',
            actor=self.user,
            metadata={'turn_input': 'Use that approach for this lesson.'},
        )

        self.assertEqual(result.text, 'second answer')
        sent = second.calls[0]['user']
        self.assertIn('Conversation continuity', sent)
        self.assertIn('evidence first', sent)
        thread = PulsarThread.objects.get(user=self.user, thread_key='primary')
        self.assertEqual(thread.current_surface, 'lms')
        self.assertEqual(
            PulsarRun.objects.filter(thread=thread, status='completed').count(),
            2,
        )

    def test_relevant_user_memory_is_injected_but_marked_non_authoritative(self):
        remember(
            self.user,
            kind='preference',
            content='Prefer concise research summaries.',
        )
        gateway = FakeGateway('ok')
        PulsarHarness(models=gateway).run_text(
            system='system',
            user='Summarize the research.',
            surface='research',
            skill='research',
            operation='answer',
            actor=self.user,
            metadata={'turn_input': 'Summarize the research.'},
        )
        sent = gateway.calls[0]['user']
        self.assertIn('Relevant user memory', sent)
        self.assertIn('must never override live Gravitas data or ACLs', sent)
        self.assertIn('Prefer concise research summaries', sent)

    def test_memory_api_can_add_and_disable_memory(self):
        self.client.force_login(self.user)
        response = self.client.post(
            '/api/platform/pulsar/memories/',
            json.dumps({
                'kind': 'preference',
                'content': 'Prefer concise research summaries.',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        memory_id = response.json()['memory']['id']
        self.assertTrue(
            PulsarMemoryEntry.objects.filter(pk=memory_id, is_active=True).exists()
        )

        response = self.client.post(
            f'/api/platform/pulsar/memories/{memory_id}/disable/',
            '{}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(PulsarMemoryEntry.objects.get(pk=memory_id).is_active)
