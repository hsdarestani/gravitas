import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import WorkspaceMembership
from .operating_models import Initiative, KeyResult, OperatingProcess, OperatingTask, StrategicObjective


@override_settings(SECURE_SSL_REDIRECT=False)
class TaskReorderTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='reorder-admin@example.com', email='reorder-admin@example.com', password='test-pass-123'
        )
        self.member = User.objects.create_user(
            username='reorder-member@example.com', email='reorder-member@example.com', password='test-pass-123'
        )
        self.client.force_login(self.admin)
        boot = self.client.get('/api/platform/bootstrap/').json()
        self.core = self.admin.gravitas_workspace_memberships.get(workspace_id=boot['workspaces']['core']['id']).workspace
        WorkspaceMembership.objects.create(workspace=self.core, user=self.member, role='member')
        self.process = OperatingProcess.objects.create(workspace=self.core, key='operations', name='Operations', flow=['Plan', 'Execute'])
        objective = StrategicObjective.objects.create(workspace=self.core, title='O1', owner=self.admin)
        kr = KeyResult.objects.create(objective=objective, title='KR1', owner=self.admin)
        self.initiative = Initiative.objects.create(
            workspace=self.core, key_result=kr, process=self.process, title='Execution', owner=self.admin, priority='p1'
        )
        due = timezone.localdate() + timedelta(days=14)
        self.t1 = OperatingTask.objects.create(workspace=self.core, initiative=self.initiative, owner=self.admin, title='One', definition_of_done='One done', due_date=due)
        self.t2 = OperatingTask.objects.create(workspace=self.core, initiative=self.initiative, owner=self.member, title='Two', definition_of_done='Two done', due_date=due, dependency=self.t1)
        self.t3 = OperatingTask.objects.create(workspace=self.core, initiative=self.initiative, owner=self.member, title='Three', definition_of_done='Three done', due_date=due, dependency=self.t2)

    def test_reorder_rebuilds_dependency_chain(self):
        response = self.client.post(
            '/api/operating/tasks/reorder/',
            data=json.dumps({'initiative_id': self.initiative.pk, 'task_ids': [self.t3.pk, self.t1.pk, self.t2.pk]}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.t1.refresh_from_db(); self.t2.refresh_from_db(); self.t3.refresh_from_db()
        self.assertIsNone(self.t3.dependency_id)
        self.assertEqual(self.t1.dependency_id, self.t3.pk)
        self.assertEqual(self.t2.dependency_id, self.t1.pk)

    def test_reorder_requires_complete_task_set(self):
        response = self.client.post(
            '/api/operating/tasks/reorder/',
            data=json.dumps({'initiative_id': self.initiative.pk, 'task_ids': [self.t2.pk, self.t1.pk]}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 409, response.content)

    def test_non_member_cannot_reorder_core_tasks(self):
        outsider = get_user_model().objects.create_user(username='outside@example.com', email='outside@example.com', password='test-pass-123')
        self.client.force_login(outsider)
        response = self.client.post(
            '/api/operating/tasks/reorder/',
            data=json.dumps({'initiative_id': self.initiative.pk, 'task_ids': [self.t1.pk, self.t2.pk, self.t3.pk]}),
            content_type='application/json',
        )
        self.assertIn(response.status_code, {403, 404})
