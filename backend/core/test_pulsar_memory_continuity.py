import json
from datetime import timedelta
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from .lms_models import Course, CourseEnrollment, CourseModule, Lesson
from .models import (
    KnowledgeResource,
    PulsarMemoryItem,
    PulsarThread,
    PulsarTurn,
    Workspace,
)
from .pulsar_runtime.memory import continuity_context, remember, relevant_memories
from .pulsar_runtime.types import HarnessResult


User = get_user_model()


class PulsarMemoryContinuityTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='pulsar-memory@example.test',
            email='pulsar-memory@example.test',
            password='Strong-pass-123!',
        )
        self.other = User.objects.create_user(
            username='pulsar-other@example.test',
            email='pulsar-other@example.test',
            password='Strong-pass-123!',
        )
        self.workspace = Workspace.objects.create(
            name='Memory workspace',
            kind=Workspace.Kind.PERSONAL,
            owner=self.user,
        )
        KnowledgeResource.objects.create(
            workspace=self.workspace,
            owner=self.user,
            kind=KnowledgeResource.Kind.NOTE,
            title='Evidence note',
            body='The project should prefer falsifiable claims and verified evidence.',
        )
        self.course = Course.objects.create(
            slug='pulsar-memory-course',
            title='Memory Course',
            summary='A course for cross-surface Pulsar tests.',
            created_by=self.user,
        )
        module = CourseModule.objects.create(
            course=self.course,
            title='Module',
            position=1,
        )
        self.lesson = Lesson.objects.create(
            module=module,
            title='Evidence lesson',
            position=1,
            body='<p>Use evidence to test the claim.</p>',
        )
        CourseEnrollment.objects.create(user=self.user, course=self.course)
        self.client.force_login(self.user)

    @patch('core.assistant_api.configured', return_value=True)
    @patch('core.assistant_api.run_text')
    def test_workspace_thread_continues_inside_lms(self, workspace_run, configured):
        workspace_run.return_value = HarnessResult(
            text='We were discussing falsifiable claims.',
            provider='test',
            model='test-model',
            model_tier='deep',
            skill='research',
            run_id='workspace-run-1',
            decision_source='deterministic',
        )
        first = self.client.post(
            '/api/platform/ai/ask/',
            json.dumps({'question': 'What did my evidence note say?'}),
            content_type='application/json',
        )
        self.assertEqual(first.status_code, 200, first.content)
        thread_id = first.json()['thread_id']
        self.assertTrue(thread_id)

        with patch('core.lms_extended_api.run_text') as lms_run:
            lms_run.return_value = HarnessResult(
                text='Connect that claim to this lesson.',
                provider='test',
                model='test-model',
                model_tier='general',
                skill='learning',
                run_id='lms-run-1',
                decision_source='deterministic',
            )
            second = self.client.post(
                f'/api/lms/courses/{self.course.pk}/ai/',
                json.dumps({
                    'question': 'How does that connect to this lesson?',
                    'lesson_id': self.lesson.pk,
                    'thread_id': thread_id,
                }),
                content_type='application/json',
            )
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(second.json()['thread_id'], thread_id)
        prompt = lms_run.call_args.kwargs['user']
        self.assertIn('What did my evidence note say?', prompt)
        self.assertIn('We were discussing falsifiable claims.', prompt)

        thread = PulsarThread.objects.get(public_id=thread_id)
        self.assertEqual(thread.user, self.user)
        self.assertEqual(PulsarTurn.objects.filter(thread=thread).count(), 4)
        self.assertGreaterEqual(
            PulsarMemoryItem.objects.filter(user=self.user, kind='episodic').count(),
            2,
        )

    def test_stale_memory_is_not_retrieved(self):
        thread = PulsarThread.objects.create(user=self.user, primary_surface='core')
        remember(
            self.user,
            kind='semantic',
            content='This memory is current and useful for the evidence project.',
            thread=thread,
            memory_key='current-evidence',
            confidence=0.9,
        )
        remember(
            self.user,
            kind='semantic',
            content='STALE SECRET MEMORY about evidence.',
            thread=thread,
            memory_key='stale-evidence',
            confidence=1.0,
            stale_after=timezone.now() - timedelta(minutes=1),
        )
        rows = relevant_memories(self.user, 'evidence', limit=10)
        text = '\n'.join(row.content for row in rows)
        self.assertIn('current and useful', text)
        self.assertNotIn('STALE SECRET MEMORY', text)

    def test_long_term_memory_is_continuity_not_source_of_truth(self):
        thread = PulsarThread.objects.create(user=self.user, primary_surface='research')
        remember(
            self.user,
            kind='semantic',
            content='The user prefers a short research summary.',
            thread=thread,
            memory_key='preference-summary',
            confidence=1.0,
            metadata={'explicit': True},
        )
        context = continuity_context(thread, self.user, 'research summary')
        self.assertIn('Relevant long-term memory (not source of truth)', context)
        self.assertIn('short research summary', context)

    @patch('core.assistant_api.configured', return_value=False)
    def test_another_user_cannot_resume_owned_thread(self, configured):
        thread = PulsarThread.objects.create(user=self.user, primary_surface='research')
        self.client.force_login(self.other)
        response = self.client.post(
            '/api/platform/ai/ask/',
            json.dumps({
                'question': 'Continue this thread',
                'thread_id': str(thread.public_id),
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error'], 'pulsar_thread_not_found')

    def test_thread_api_is_user_scoped(self):
        own = PulsarThread.objects.create(user=self.user, primary_surface='core', title='Own')
        PulsarThread.objects.create(user=self.other, primary_surface='core', title='Other')
        response = self.client.get('/api/platform/pulsar/threads/')
        self.assertEqual(response.status_code, 200)
        ids = {row['id'] for row in response.json()['threads']}
        self.assertEqual(ids, {str(own.public_id)})
