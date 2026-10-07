import json
from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .lms_models import Course
from .models import ContentItem, ResearchProject
from .operating_models import (
    Initiative,
    KeyResult,
    OperatingProcess,
    OperatingTask,
    StrategicObjective,
)
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(SECURE_SSL_REDIRECT=False)
class CoreTaskCrossLayerLinkTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='task-link-admin@example.com',
            email='task-link-admin@example.com',
            password='test-pass-123',
        )
        self.outsider = User.objects.create_user(
            username='task-link-outsider@example.com',
            email='task-link-outsider@example.com',
            password='test-pass-123',
        )
        self.client.force_login(self.admin)
        boot = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(boot.status_code, 200, boot.content)
        spaces = ensure_platform_workspaces(self.admin)
        self.core = spaces['core']
        self.research = spaces['research']

        process = OperatingProcess.objects.create(
            workspace=self.core,
            key=OperatingProcess.Key.OPERATIONS,
            name='Operations',
            owner=self.admin,
            flow=['Backlog'],
        )
        objective = StrategicObjective.objects.create(
            workspace=self.core,
            title='Cross-layer traceability',
            owner=self.admin,
        )
        key_result = KeyResult.objects.create(
            objective=objective,
            title='Every execution item is traceable',
            owner=self.admin,
        )
        initiative = Initiative.objects.create(
            workspace=self.core,
            key_result=key_result,
            process=process,
            title='Traceable execution',
            owner=self.admin,
            stage='Backlog',
        )
        self.task = OperatingTask.objects.create(
            workspace=self.core,
            initiative=initiative,
            owner=self.admin,
            title='Prepare linked launch task',
            due_date=date.today(),
            definition_of_done='The task links to its research, learning and public output.',
        )
        self.project = ResearchProject.objects.create(
            workspace=self.research,
            owner=self.admin,
            title='Launch evidence project',
        )
        self.course = Course.objects.create(
            slug='launch-course-link-test',
            title='Launch learning course',
            status=Course.Status.PUBLISHED,
            access_type=Course.AccessType.OPEN,
            created_by=self.admin,
        )
        self.content = ContentItem.objects.create(
            slug='launch-public-content-link-test',
            title='Launch public article',
            status=ContentItem.Status.PUBLISHED,
        )

    def post_json(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json')

    def test_task_can_link_to_research_lms_and_public_content(self):
        path = f'/api/operating/tasks/{self.task.pk}/links/'
        targets = [
            ('research-project', self.project.pk),
            ('course', self.course.pk),
            ('public-content', self.content.pk),
        ]
        for target_type, target_id in targets:
            with self.subTest(target_type=target_type):
                response = self.post_json(path, {
                    'target_type': target_type,
                    'target_id': target_id,
                    'relation': 'supports',
                })
                self.assertEqual(response.status_code, 201, response.content)

        listed = self.client.get(path)
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual({item['target_type'] for item in listed.json()['links']}, {
            'research-project', 'course', 'public-content',
        })

        first = listed.json()['links'][0]
        removed = self.client.delete(
            path,
            data=json.dumps({'link_id': first['id']}),
            content_type='application/json',
        )
        self.assertEqual(removed.status_code, 200, removed.content)
        self.assertEqual(len(self.client.get(path).json()['links']), 2)

    def test_non_core_account_cannot_inspect_task_links(self):
        self.client.force_login(self.outsider)
        response = self.client.get(f'/api/operating/tasks/{self.task.pk}/links/')
        self.assertEqual(response.status_code, 403, response.content)
