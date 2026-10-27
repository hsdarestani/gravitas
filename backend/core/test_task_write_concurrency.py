"""Exercise PostgreSQL row locks; SQLite cannot validate this guarantee."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
from django.contrib.auth import get_user_model
from django.db import connection, close_old_connections
from django.test import Client, TransactionTestCase
from core.operating_models import OperatingTask
from core.platform_runtime_v3 import ensure_platform_workspaces


@skipUnless(connection.vendor == 'postgresql', 'requires real PostgreSQL row locks')
class TaskWriteConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser('concurrency', 'concurrency@example.test', 'pw')
        spaces = ensure_platform_workspaces(self.user)
        self.task = OperatingTask.objects.create(workspace=spaces['core'], owner=self.user,
            title='Concurrent fixture', description='Original', definition_of_done='Confirmed')

    def test_checklist_writes_do_not_accidentally_acquire_task_row_locks_outside_atomic(self):
        client = Client()
        client.force_login(self.user)
        root = f'/api/operating/tasks/{self.task.pk}/checklist/'
        created = client.post(root, data={'title': 'Checklist fixture'}, content_type='application/json')
        self.assertEqual(created.status_code, 201, created.content)
        item_id = created.json()['item']['id']
        saved = client.patch(f'{root}{item_id}/', data={'is_completed': True}, content_type='application/json')
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertTrue(saved.json()['item']['is_completed'])
        self.assertEqual(client.delete(f'{root}{item_id}/').status_code, 200)

    def test_two_editors_using_the_same_revision_cannot_overwrite_each_other(self):
        expected = self.task.updated_at.isoformat()
        barrier = Barrier(2)
        def save(payload):
            close_old_connections()
            try:
                user = get_user_model().objects.get(pk=self.user.pk)
                client = Client()
                client.force_login(user)
                barrier.wait(timeout=10)
                response = client.patch(f'/api/operating/task-board/{self.task.pk}/',
                    data={**payload, 'expected_updated_at': expected}, content_type='application/json')
                return response.status_code, response.json(), payload
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(save, payload) for payload in
                       ({'title': 'Editor A'}, {'description': 'Editor B'})]
            results = [future.result(timeout=20) for future in futures]
        self.assertEqual(sorted(status for status, _, _ in results), [200, 409])
        self.task.refresh_from_db()
        for status, data, payload in results:
            if status == 200:
                for field, value in payload.items():
                    self.assertEqual(getattr(self.task, field), value)
            else:
                self.assertEqual(data['error'], 'task_changed_elsewhere')
