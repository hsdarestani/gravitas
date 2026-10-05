import json

from django.contrib.auth import get_user_model
from django.test import TestCase

from .lms_models import Course, CourseEnrollment, CourseModule, LearningInteraction, Lesson
from .models import KnowledgeResource, Workspace
from .pulsar_runtime.context import PulsarContextEngine
from .pulsar_runtime.profiles import snapshot


class PulsarContextAndProfileTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='pulsar-context@example.test',
            email='pulsar-context@example.test',
            password='Strong-pass-123!',
        )
        self.other = User.objects.create_user(
            username='other-context@example.test',
            email='other-context@example.test',
            password='Strong-pass-123!',
        )
        self.workspace = Workspace.objects.create(
            name='Pulsar context',
            kind=Workspace.Kind.PERSONAL,
            owner=self.user,
        )
        self.other_workspace = Workspace.objects.create(
            name='Other context',
            kind=Workspace.Kind.PERSONAL,
            owner=self.other,
        )
        KnowledgeResource.objects.create(
            workspace=self.workspace,
            owner=self.user,
            kind=KnowledgeResource.Kind.NOTE,
            title='Research direction',
            body='Use the verified dataset before changing the research direction.',
        )
        KnowledgeResource.objects.create(
            workspace=self.other_workspace,
            owner=self.other,
            kind=KnowledgeResource.Kind.NOTE,
            title='Research direction private',
            body='SECRET OTHER USER MATERIAL',
        )
        self.client.force_login(self.user)

    def test_default_memory_profile_defines_user_skills(self):
        profile = snapshot(self.user)
        self.assertEqual(
            set(profile['allowed_skills']),
            {'learning', 'research', 'project_task'},
        )
        self.assertEqual(profile['approval_defaults']['r2'], 'approval')

        response = self.client.get('/api/platform/pulsar/profile/')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['ok'])
        enabled = {row['name'] for row in payload['skills'] if row['enabled']}
        self.assertEqual(enabled, {'learning', 'research', 'project_task'})

    def test_profile_can_disable_research_skill(self):
        response = self.client.patch(
            '/api/platform/pulsar/profile/',
            json.dumps({'allowed_skills': ['learning', 'project_task']}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('research', response.json()['profile']['allowed_skills'])

        response = self.client.post(
            '/api/platform/ai/ask/',
            json.dumps({'question': 'What is the research direction?'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertIn('pulsar_skill_not_allowed:research', response.json()['error'])

    def test_workspace_context_uses_live_acl(self):
        package = PulsarContextEngine().workspace(
            self.user,
            'What is the research direction?',
        )
        self.assertIn('verified dataset', package.text)
        self.assertNotIn('SECRET OTHER USER MATERIAL', package.text)
        self.assertEqual(package.sources[0]['title'], 'Research direction')

    def test_learning_context_combines_course_progress_lesson_and_user_notes(self):
        course = Course.objects.create(
            slug='pulsar-learning-context',
            title='Pulsar Learning',
            summary='A course used to test the shared Learning skill.',
            created_by=self.user,
        )
        module = CourseModule.objects.create(
            course=course,
            position=1,
            title='Module 1',
        )
        lesson = Lesson.objects.create(
            module=module,
            position=1,
            title='Context lesson',
            body='<p>Ground the answer in this lesson material.</p>',
        )
        enrollment = CourseEnrollment.objects.create(
            user=self.user,
            course=course,
            progress_percent=35,
        )
        LearningInteraction.objects.create(
            user=self.user,
            enrollment=enrollment,
            lesson=lesson,
            kind=LearningInteraction.Kind.NOTE,
            body='My own note about the lesson.',
        )

        package = PulsarContextEngine().learning(
            self.user,
            course,
            lesson=lesson,
            question='What should I remember?',
        )
        self.assertIn('Learner progress: 35', package.text)
        self.assertIn('Ground the answer in this lesson material.', package.text)
        self.assertIn('My own note about the lesson.', package.text)
        self.assertTrue(any(row['kind'] == 'lesson' for row in package.sources))
