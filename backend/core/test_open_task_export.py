import json
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from .models import Workspace
from .operating_models import OperatingTask, WorkStatus


class OpenTaskExportTests(TestCase):
    def test_independent_undated_task_exports_without_artificial_planning_links(self):
        owner = get_user_model().objects.create_user('export-qa', email='export@example.test')
        workspace = Workspace.objects.create(name='Export QA', owner=owner)
        task = OperatingTask.objects.create(
            workspace=workspace, owner=owner, title='Independent task',
            definition_of_done='QA verified', due_date=None,
        )
        OperatingTask.objects.create(
            workspace=workspace, owner=owner, title='Completed task', status=WorkStatus.DONE,
        )
        output = StringIO()
        call_command('export_open_tasks', stdout=output)
        result = json.loads(output.getvalue())
        self.assertEqual(result['count'], 1)
        row = result['tasks'][0]
        self.assertEqual(row['id'], task.pk)
        for field in ('objective', 'key_result', 'legacy_initiative', 'kr_metric', 'kr_unit'):
            self.assertEqual(row[field], '')
        for field in ('kr_current', 'kr_target', 'due_date'):
            self.assertIsNone(row[field])
        self.assertFalse(row['overdue'])
