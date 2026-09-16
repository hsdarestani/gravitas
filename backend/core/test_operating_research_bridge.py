import json
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import ResearchProject
from .operating_models import (
    Initiative,
    KeyResult,
    OperatingCycle,
    OperatingMilestone,
    OperatingProcess,
    OperatingRisk,
    OperatingTask,
    OperatingWorkPackage,
    Priority,
    StrategicObjective,
    WorkStatus,
)
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(SECURE_SSL_REDIRECT=False)
class OperatingResearchBridgeTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='bridge-owner@example.com', email='bridge-owner@example.com', password='test-pass-123')
        self.spaces = ensure_platform_workspaces(self.user)
        self.assertNotEqual(self.spaces['core'].pk, self.spaces['research'].pk)
        self.project = ResearchProject.objects.create(
            workspace=self.spaces['research'],
            owner=self.user,
            title='Canonical Research project',
        )
        self.client.force_login(self.user)
        boot = self.client.get('/api/operating/dashboard/')
        self.assertEqual(boot.status_code, 200, boot.content)
        self.process = OperatingProcess.objects.get(workspace=self.spaces['core'], key=OperatingProcess.Key.RESEARCH)
        self.objective = StrategicObjective.objects.create(
            workspace=self.spaces['core'],
            title='Bridge objective',
            owner=self.user,
            status=WorkStatus.ACTIVE,
        )
        self.kr = KeyResult.objects.create(
            objective=self.objective,
            title='Bridge KR',
            owner=self.user,
            status=WorkStatus.ACTIVE,
        )
        self.initiative = Initiative.objects.create(
            workspace=self.spaces['core'],
            key_result=self.kr,
            process=self.process,
            title='Bridge initiative',
            owner=self.user,
            priority=Priority.P2,
            status=WorkStatus.ACTIVE,
        )
        self.cycle = OperatingCycle.objects.create(
            workspace=self.spaces['core'],
            process=self.process,
            name='Bridge cycle',
            cadence=OperatingCycle.Cadence.BIWEEKLY,
            owner=self.user,
            start_date=date.today(),
            end_date=date.today() + timedelta(days=14),
            status=WorkStatus.ACTIVE,
        )

    def post_json(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json')

    def test_dashboard_exposes_research_projects_and_full_planning_collections(self):
        response = self.client.get('/api/operating/dashboard/')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data['counts']['projects'], 1)
        self.assertEqual(data['projects'][0]['id'], self.project.pk)
        self.assertTrue(any(item['id'] == self.initiative.pk for item in data['initiatives']))
        self.assertTrue(any(item['id'] == self.cycle.pk for item in data['cycles']))

    def test_core_mutations_preserve_research_project_links(self):
        task = self.post_json('/api/operating/tasks/', {
            'initiative_id': self.initiative.pk,
            'owner_id': self.user.pk,
            'project_id': self.project.pk,
            'title': 'Cross-workspace task',
            'priority': 'p2',
            'definition_of_done': 'The linked work is complete.',
            'due_date': (date.today() + timedelta(days=5)).isoformat(),
        })
        self.assertEqual(task.status_code, 201, task.content)
        task_id = task.json()['task']['id']
        self.assertEqual(task.json()['task']['project_id'], self.project.pk)
        self.assertEqual(OperatingTask.objects.get(pk=task_id).project_id, self.project.pk)

        milestone = self.post_json('/api/operating/milestones/', {
            'initiative_id': self.initiative.pk,
            'owner_id': self.user.pk,
            'project_id': self.project.pk,
            'title': 'Cross-workspace milestone',
            'due_date': (date.today() + timedelta(days=10)).isoformat(),
        })
        self.assertEqual(milestone.status_code, 201, milestone.content)
        milestone_id = milestone.json()['milestone']['id']
        self.assertEqual(milestone.json()['milestone']['project_id'], self.project.pk)
        self.assertEqual(OperatingMilestone.objects.get(pk=milestone_id).project_id, self.project.pk)

        work_package = self.post_json('/api/operating/work-packages/', {
            'milestone_id': milestone_id,
            'owner_id': self.user.pk,
            'project_id': self.project.pk,
            'title': 'Cross-workspace package',
            'due_date': (date.today() + timedelta(days=8)).isoformat(),
        })
        self.assertEqual(work_package.status_code, 201, work_package.content)
        work_package_id = work_package.json()['work_package']['id']
        self.assertEqual(work_package.json()['work_package']['project_id'], self.project.pk)
        self.assertEqual(OperatingWorkPackage.objects.get(pk=work_package_id).project_id, self.project.pk)

        risk = self.post_json('/api/operating/risks/', {
            'initiative_id': self.initiative.pk,
            'owner_id': self.user.pk,
            'project_id': self.project.pk,
            'title': 'Cross-workspace risk',
        })
        self.assertEqual(risk.status_code, 201, risk.content)
        risk_id = risk.json()['risk']['id']
        self.assertEqual(risk.json()['risk']['project_id'], self.project.pk)
        self.assertEqual(OperatingRisk.objects.get(pk=risk_id).project_id, self.project.pk)

    def test_unknown_project_id_is_rejected_instead_of_silently_orphaning(self):
        response = self.post_json('/api/operating/tasks/', {
            'initiative_id': self.initiative.pk,
            'owner_id': self.user.pk,
            'project_id': 999999,
            'title': 'Should not be orphaned',
            'priority': 'p2',
            'definition_of_done': 'Never created.',
            'due_date': (date.today() + timedelta(days=5)).isoformat(),
        })
        self.assertEqual(response.status_code, 404, response.content)
        self.assertEqual(response.json()['error'], 'project_not_found')
        self.assertFalse(OperatingTask.objects.filter(title='Should not be orphaned').exists())
