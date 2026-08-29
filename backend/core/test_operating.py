import json
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase

from core.operating_models import Initiative, KeyResult, OperatingProcess, OperatingTask, StrategicObjective
from core.platform_runtime_v3 import ensure_platform_workspaces


User = get_user_model()


class OperatingWorkspaceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='operator@example.com', email='operator@example.com', password='test-password-123')
        self.other = User.objects.create_user(username='other@example.com', email='other@example.com', password='test-password-123')
        # V3 Operating System belongs to the canonical internal Core workspace.
        # The first bootstrap user is the initial Core admin in a clean test DB.
        self.workspace = ensure_platform_workspaces(self.user)['core']
        self.client.force_login(self.user)

    def post_json(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json')

    def patch_json(self, path, payload):
        return self.client.patch(path, data=json.dumps(payload), content_type='application/json')

    def operating_seed(self, process_key='research'):
        dashboard = self.client.get('/api/operating/dashboard/').json()
        process = next(p for p in dashboard['processes'] if p['key'] == process_key)
        objective = self.post_json('/api/operating/objectives/', {
            'title': 'Operating objective',
            'quarter': 'Q4 2026',
            'owner_id': self.user.pk,
        }).json()['objective']
        kr = self.post_json('/api/operating/key-results/', {
            'objective_id': objective['id'],
            'title': 'Measurable KR',
            'owner_id': self.user.pk,
            'baseline_value': 0,
            'target_value': 100,
            'current_value': 25,
            'unit': '%',
        }).json()['key_result']
        return dashboard, process, objective, kr

    def test_dashboard_seeds_five_operating_processes(self):
        response = self.client.get('/api/operating/dashboard/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data['processes']), 5)
        self.assertEqual(
            {item['key'] for item in data['processes']},
            {'content', 'research', 'commercial', 'technology', 'operations'},
        )

    def test_strategy_to_task_traceability_and_process_stage(self):
        _, process, objective, kr = self.operating_seed('research')
        initiative = self.post_json('/api/operating/initiatives/', {
            'key_result_id': kr['id'],
            'process_id': process['id'],
            'title': 'Scientific Research Program',
            'owner_id': self.user.pk,
            'priority': 'p1',
        })
        self.assertEqual(initiative.status_code, 201)
        initiative_data = initiative.json()['initiative']
        self.assertEqual(initiative_data['stage'], 'Question')

        task = self.post_json('/api/operating/tasks/', {
            'initiative_id': initiative_data['id'],
            'owner_id': self.user.pk,
            'title': 'Validate research dataset',
            'definition_of_done': 'Validation completed and evidence attached.',
            'priority': 'p1',
            'due_date': (date.today() + timedelta(days=7)).isoformat(),
        })
        self.assertEqual(task.status_code, 201)
        trace = task.json()['task']['trace']
        self.assertEqual(trace['objective']['id'], objective['id'])
        self.assertEqual(trace['key_result']['id'], kr['id'])
        self.assertEqual(trace['initiative']['id'], initiative_data['id'])
        self.assertEqual(trace['process']['key'], 'research')

    def test_task_requires_complete_operating_fields_and_schedule(self):
        _, process, _, kr = self.operating_seed()
        initiative = self.post_json('/api/operating/initiatives/', {
            'key_result_id': kr['id'], 'process_id': process['id'], 'title': 'Traceable initiative',
            'owner_id': self.user.pk, 'priority': 'p2',
        }).json()['initiative']
        incomplete = self.post_json('/api/operating/tasks/', {
            'initiative_id': initiative['id'],
            'title': 'Missing fields',
            'owner_id': self.user.pk,
        })
        self.assertEqual(incomplete.status_code, 400)
        self.assertEqual(incomplete.json()['error'], 'task_requires_title_owner_initiative_priority_and_done_definition')

        unscheduled = self.post_json('/api/operating/tasks/', {
            'initiative_id': initiative['id'],
            'title': 'No cycle or due date',
            'owner_id': self.user.pk,
            'priority': 'p2',
            'definition_of_done': 'Done means documented.',
        })
        self.assertEqual(unscheduled.status_code, 400)
        self.assertEqual(unscheduled.json()['error'], 'task_requires_cycle_or_due_date')

    def test_other_user_cannot_access_core_operating_data(self):
        self.client.get('/api/operating/dashboard/')
        process = OperatingProcess.objects.filter(workspace=self.workspace).first()
        objective = StrategicObjective.objects.create(workspace=self.workspace, title='Private objective', owner=self.user)
        kr = KeyResult.objects.create(objective=objective, title='Private KR', owner=self.user)
        initiative = Initiative.objects.create(workspace=self.workspace, key_result=kr, process=process, title='Private initiative', owner=self.user)
        task = OperatingTask.objects.create(
            workspace=self.workspace, initiative=initiative, owner=self.user,
            title='Private task', definition_of_done='Done', due_date=date.today(),
        )

        self.client.force_login(self.other)
        response = self.patch_json(f'/api/operating/tasks/{task.pk}/', {'status': 'done'})
        self.assertEqual(response.status_code, 404)

    def test_capacity_gate_allows_three_main_priorities_and_rejects_fourth(self):
        _, process, _, kr = self.operating_seed('operations')
        for index in range(3):
            response = self.post_json('/api/operating/initiatives/', {
                'key_result_id': kr['id'],
                'process_id': process['id'],
                'title': f'Main priority {index}',
                'owner_id': self.user.pk,
                'priority': 'p1',
            })
            self.assertEqual(response.status_code, 201)
        warnings = self.client.get('/api/operating/dashboard/').json()['capacity_warnings']
        self.assertEqual(warnings[0]['active_main_priorities'], 3)
        self.assertEqual(warnings[0]['state'], 'at_capacity')

        fourth = self.post_json('/api/operating/initiatives/', {
            'key_result_id': kr['id'],
            'process_id': process['id'],
            'title': 'Fourth main priority',
            'owner_id': self.user.pk,
            'priority': 'p1',
        })
        self.assertEqual(fourth.status_code, 409)
        self.assertEqual(fourth.json()['error'], 'capacity_limit_reached')

    def test_commercial_milestone_work_package_task_chain(self):
        _, process, _, kr = self.operating_seed('commercial')
        initiative = self.post_json('/api/operating/initiatives/', {
            'key_result_id': kr['id'], 'process_id': process['id'], 'title': 'Client delivery',
            'owner_id': self.user.pk, 'priority': 'p1',
        }).json()['initiative']
        milestone = self.post_json('/api/operating/milestones/', {
            'initiative_id': initiative['id'], 'title': 'Scientific Validation',
            'owner_id': self.user.pk, 'due_date': (date.today() + timedelta(days=14)).isoformat(),
            'definition_of_done': 'Validation accepted.',
        }).json()['milestone']
        package = self.post_json('/api/operating/work-packages/', {
            'milestone_id': milestone['id'], 'title': 'Analysis package',
            'owner_id': self.user.pk, 'definition_of_done': 'Analysis reviewed.',
        })
        self.assertEqual(package.status_code, 201)
        package_data = package.json()['work_package']
        self.assertEqual(package_data['milestone_id'], milestone['id'])

        task = self.post_json('/api/operating/tasks/', {
            'initiative_id': initiative['id'], 'work_package_id': package_data['id'],
            'title': 'Run analysis', 'owner_id': self.user.pk, 'priority': 'p2',
            'definition_of_done': 'Analysis output is attached.', 'due_date': date.today().isoformat(),
        })
        self.assertEqual(task.status_code, 201)
        self.assertEqual(task.json()['task']['work_package_id'], package_data['id'])

    def test_risk_register_and_meeting_action_deadline(self):
        _, process, _, kr = self.operating_seed('operations')
        initiative = self.post_json('/api/operating/initiatives/', {
            'key_result_id': kr['id'], 'process_id': process['id'], 'title': 'PMO control loop',
            'owner_id': self.user.pk, 'priority': 'p2',
        }).json()['initiative']
        risk = self.post_json('/api/operating/risks/', {
            'initiative_id': initiative['id'], 'title': 'Dependency delay', 'owner_id': self.user.pk,
            'health': 'red', 'mitigation': 'Resolve dependency before milestone.',
        })
        self.assertEqual(risk.status_code, 201)
        self.assertEqual(risk.json()['risk']['health'], 'red')

        meeting = self.post_json('/api/operating/meetings/', {
            'kind': 'weekly_gravitas', 'title': 'Weekly decision review', 'owner_id': self.user.pk,
            'scheduled_for': '2026-08-29T10:00:00Z', 'duration_minutes': 60,
        }).json()['meeting']
        action = self.post_json('/api/operating/tasks/', {
            'initiative_id': initiative['id'], 'meeting_id': meeting['id'], 'title': 'Meeting action',
            'owner_id': self.user.pk, 'priority': 'p2', 'definition_of_done': 'Decision implemented.',
        })
        self.assertEqual(action.status_code, 400)
        self.assertEqual(action.json()['error'], 'task_requires_cycle_or_due_date')

        action = self.post_json('/api/operating/tasks/', {
            'initiative_id': initiative['id'], 'meeting_id': meeting['id'], 'title': 'Meeting action',
            'owner_id': self.user.pk, 'priority': 'p2', 'definition_of_done': 'Decision implemented.',
            'due_date': (date.today() + timedelta(days=2)).isoformat(),
        })
        self.assertEqual(action.status_code, 201)
        self.assertEqual(action.json()['task']['meeting_id'], meeting['id'])
