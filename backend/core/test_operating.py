import json
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase

from core.operating_models import Initiative, KeyResult, OperatingProcess, OperatingTask, StrategicObjective
from core.workspace_api import provision_personal_workspace


User = get_user_model()


class OperatingWorkspaceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='operator@example.com', email='operator@example.com', password='test-password-123')
        self.other = User.objects.create_user(username='other@example.com', email='other@example.com', password='test-password-123')
        self.workspace = provision_personal_workspace(self.user)
        self.client.force_login(self.user)

    def post_json(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json')

    def patch_json(self, path, payload):
        return self.client.patch(path, data=json.dumps(payload), content_type='application/json')

    def test_dashboard_seeds_five_operating_processes(self):
        response = self.client.get('/api/operating/dashboard/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data['processes']), 5)
        self.assertEqual(
            {item['key'] for item in data['processes']},
            {'content', 'research', 'commercial', 'technology', 'operations'},
        )

    def test_strategy_to_task_traceability(self):
        dashboard = self.client.get('/api/operating/dashboard/').json()
        process_id = next(p['id'] for p in dashboard['processes'] if p['key'] == 'research')

        objective = self.post_json('/api/operating/objectives/', {
            'title': 'Grow scientific project revenue',
            'quarter': 'Q4 2026',
            'owner_id': self.user.pk,
        })
        self.assertEqual(objective.status_code, 201)
        objective_id = objective.json()['objective']['id']

        kr = self.post_json('/api/operating/key-results/', {
            'objective_id': objective_id,
            'title': 'Reach target quarterly revenue',
            'owner_id': self.user.pk,
            'baseline_value': 0,
            'target_value': 100000,
            'current_value': 25000,
            'unit': 'EUR',
        })
        self.assertEqual(kr.status_code, 201)
        kr_id = kr.json()['key_result']['id']

        initiative = self.post_json('/api/operating/initiatives/', {
            'key_result_id': kr_id,
            'process_id': process_id,
            'title': 'Commercial Research Program',
            'owner_id': self.user.pk,
            'priority': 'p1',
        })
        self.assertEqual(initiative.status_code, 201)
        initiative_id = initiative.json()['initiative']['id']

        task = self.post_json('/api/operating/tasks/', {
            'initiative_id': initiative_id,
            'owner_id': self.user.pk,
            'title': 'Validate research dataset',
            'definition_of_done': 'Validation completed and evidence attached.',
            'priority': 'p1',
            'due_date': (date.today() + timedelta(days=7)).isoformat(),
        })
        self.assertEqual(task.status_code, 201)
        trace = task.json()['task']['trace']
        self.assertEqual(trace['objective']['id'], objective_id)
        self.assertEqual(trace['key_result']['id'], kr_id)
        self.assertEqual(trace['initiative']['id'], initiative_id)
        self.assertEqual(trace['process']['key'], 'research')

    def test_task_requires_initiative_and_definition_of_done(self):
        response = self.post_json('/api/operating/tasks/', {
            'title': 'Untraceable work',
            'owner_id': self.user.pk,
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'task_requires_title_owner_initiative_and_done_definition')

    def test_other_user_cannot_access_personal_operating_data(self):
        self.client.get('/api/operating/dashboard/')
        process = OperatingProcess.objects.filter(workspace=self.workspace).first()
        objective = StrategicObjective.objects.create(workspace=self.workspace, title='Private objective', owner=self.user)
        kr = KeyResult.objects.create(objective=objective, title='Private KR', owner=self.user)
        initiative = Initiative.objects.create(workspace=self.workspace, key_result=kr, process=process, title='Private initiative', owner=self.user)
        task = OperatingTask.objects.create(workspace=self.workspace, initiative=initiative, owner=self.user, title='Private task', definition_of_done='Done')

        self.client.force_login(self.other)
        response = self.patch_json(f'/api/operating/tasks/{task.pk}/', {'status': 'done'})
        self.assertEqual(response.status_code, 404)

    def test_high_priority_capacity_warning_after_three_items(self):
        dashboard = self.client.get('/api/operating/dashboard/').json()
        process = next(p for p in dashboard['processes'] if p['key'] == 'operations')
        objective = self.post_json('/api/operating/objectives/', {'title': 'Operational excellence', 'owner_id': self.user.pk}).json()['objective']
        kr = self.post_json('/api/operating/key-results/', {'objective_id': objective['id'], 'title': 'Reduce blockers', 'owner_id': self.user.pk}).json()['key_result']
        initiative = self.post_json('/api/operating/initiatives/', {'key_result_id': kr['id'], 'process_id': process['id'], 'title': 'PMO control loop', 'owner_id': self.user.pk, 'priority': 'p1'}).json()['initiative']
        for index in range(4):
            response = self.post_json('/api/operating/tasks/', {
                'initiative_id': initiative['id'],
                'owner_id': self.user.pk,
                'title': f'Priority item {index}',
                'definition_of_done': 'Closed with evidence',
                'priority': 'p1',
            })
            self.assertEqual(response.status_code, 201)
        warnings = self.client.get('/api/operating/dashboard/').json()['capacity_warnings']
        self.assertEqual(warnings[0]['high_priority_active'], 4)
