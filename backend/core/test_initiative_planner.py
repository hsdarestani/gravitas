import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import WorkspaceMembership
from .operating_models import Initiative, KeyResult, OperatingTask, StrategicObjective
from .roadmap_models import RoadmapOKRSyncState


@override_settings(
    GRAVITAS_DEFAULT_QUOTA_BYTES=1024 * 1024 * 100,
    GRAVITAS_MAX_UPLOAD_BYTES=1024 * 1024 * 10,
    SECURE_SSL_REDIRECT=False,
)
class InitiativePlannerTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='admin@example.com', email='admin@example.com', first_name='Admin', password='test-pass-123'
        )
        self.member = User.objects.create_user(
            username='member@example.com', email='member@example.com', first_name='Member', password='test-pass-123'
        )
        self.researcher = User.objects.create_user(
            username='researcher@example.com', email='researcher@example.com', password='test-pass-123'
        )
        self.client.force_login(self.admin)
        boot = self.client.get('/api/platform/bootstrap/').json()
        self.core_id = boot['workspaces']['core']['id']
        self.core = self.admin.gravitas_workspace_memberships.get(workspace_id=self.core_id).workspace
        WorkspaceMembership.objects.create(workspace=self.core, user=self.member, role='member')
        self.objective = StrategicObjective.objects.create(
            workspace=self.core,
            title='O1 · Content engine',
            description='Build a repeatable science content engine.',
            owner=self.admin,
            quarter='Roadmap · 6 months',
        )
        self.kr = KeyResult.objects.create(
            objective=self.objective,
            title='Publish 12 long-form videos',
            owner=self.admin,
            metric_name='Roadmap target',
            unit='videos',
            baseline_value=0,
            target_value=12,
            current_value=2,
        )
        RoadmapOKRSyncState.objects.create(
            workspace=self.core,
            source_url='https://example.com/i18n.js',
            bindings={'objectives': {'O1': self.objective.pk}, 'key_results': {'O1-KR1': self.kr.pk}},
        )

    def test_planner_returns_okr_coverage_and_curated_execution_plan(self):
        response = self.client.get('/api/operating/initiative-planner/')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data['summary']['objectives'], 1)
        self.assertEqual(data['summary']['key_results'], 1)
        item = data['objectives'][0]['key_results'][0]
        self.assertEqual(item['roadmap_key'], 'O1-KR1')
        self.assertEqual(item['suggestion']['family'], 'content_longform')
        self.assertEqual(item['suggestion']['process_key'], 'content')
        self.assertGreaterEqual(len(item['suggestion']['tasks']), 5)
        self.assertEqual(len(data['members']), 2)

    def test_materialize_plan_creates_initiative_and_assigned_dependency_chain(self):
        planner = self.client.get('/api/operating/initiative-planner/').json()
        suggestion = planner['objectives'][0]['key_results'][0]['suggestion']
        selected = suggestion['tasks'][:3]
        due = timezone.localdate() + timedelta(days=30)
        response = self.client.post(
            '/api/operating/initiative-planner/',
            data=json.dumps({
                'key_result_id': self.kr.pk,
                'suggestion_key': suggestion['key'],
                'owner_id': self.admin.pk,
                'process_key': suggestion['process_key'],
                'priority': 'p1',
                'due_date': due.isoformat(),
                'tasks': [
                    {'index': selected[0]['index'], 'owner_id': self.admin.pk},
                    {'index': selected[1]['index'], 'owner_id': self.member.pk},
                    {'index': selected[2]['index'], 'owner_id': self.member.pk},
                ],
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Initiative.objects.filter(workspace=self.core, key_result=self.kr).count(), 1)
        tasks = list(OperatingTask.objects.filter(workspace=self.core).order_by('id'))
        self.assertEqual(len(tasks), 3)
        self.assertEqual(tasks[0].owner_id, self.admin.pk)
        self.assertEqual(tasks[1].owner_id, self.member.pk)
        self.assertIsNone(tasks[0].dependency_id)
        self.assertEqual(tasks[1].dependency_id, tasks[0].pk)
        self.assertEqual(tasks[2].dependency_id, tasks[1].pk)
        self.assertTrue(all(task.definition_of_done for task in tasks))
        self.assertTrue(all(task.due_date for task in tasks))

    def test_duplicate_plan_is_blocked(self):
        planner = self.client.get('/api/operating/initiative-planner/').json()
        suggestion = planner['objectives'][0]['key_results'][0]['suggestion']
        payload = {
            'key_result_id': self.kr.pk,
            'suggestion_key': suggestion['key'],
            'title': suggestion['title'],
            'owner_id': self.admin.pk,
            'process_key': suggestion['process_key'],
            'priority': 'p2',
            'tasks': [],
        }
        first = self.client.post('/api/operating/initiative-planner/', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(first.status_code, 201, first.content)
        second = self.client.post('/api/operating/initiative-planner/', data=json.dumps(payload), content_type='application/json')
        self.assertEqual(second.status_code, 409, second.content)
        self.assertEqual(second.json()['error'], 'initiative_already_exists')

    def test_external_researcher_cannot_use_core_execution_planner(self):
        self.client.force_login(self.researcher)
        response = self.client.get('/api/operating/initiative-planner/')
        self.assertIn(response.status_code, {403, 404})
