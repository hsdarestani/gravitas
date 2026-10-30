import json
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase
from .models import ResearchProject
from .operating_models import OperatingTask
from .platform_runtime_v3 import ensure_platform_workspaces
from .canonical_projects import encode, decode


class TaskHierarchyTests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_superuser('hierarchy-owner', 'owner@example.test', 'pass')
        spaces = ensure_platform_workspaces(self.owner)
        self.core = spaces['core']
        self.project = ResearchProject.objects.create(workspace=spaces['research'], owner=self.owner, title='Historical work')
        self.parent = self.task('Parent')

    def task(self, title, **kwargs):
        return OperatingTask.objects.create(workspace=self.core, project=self.project, owner=self.owner, title=title, definition_of_done='Recorded deliverable', **kwargs)

    def test_subtasks_keep_independent_status_activity_and_no_fake_due_date(self):
        child = self.task('Retest step', parent=self.parent, status='retest', source_key='test:step', source_metadata={'original_status': 'Retest', 'activity_date_raw': '2026-09-07 to 2026-10-11'})
        child.refresh_from_db()
        self.assertEqual(child.parent_id, self.parent.pk)
        self.assertEqual(child.status, 'retest')
        self.assertIsNone(child.due_date)
        self.assertEqual(child.source_metadata['activity_date_raw'], '2026-09-07 to 2026-10-11')

    def test_hierarchy_cycles_and_cross_project_parent_rejected(self):
        child = self.task('Child', parent=self.parent)
        self.parent.parent = child
        with self.assertRaises(ValidationError): self.parent.save()
        self.parent.parent = None
        other = ResearchProject.objects.create(workspace=self.project.workspace, owner=self.owner, title='Other')
        child.project = other
        with self.assertRaises(ValidationError): child.save()

    def test_dependency_does_not_become_parent(self):
        dependent = self.task('Dependent', dependency=self.parent)
        self.assertIsNone(dependent.parent_id)

    def test_source_key_unique_and_immutable(self):
        row = self.task('Imported', source_key='test:unique')
        with self.assertRaises(IntegrityError), transaction.atomic(): self.task('Duplicate', source_key='test:unique')
        row.source_key = 'test:changed'
        with self.assertRaises(ValidationError): row.save()

    def test_v3_canonical_roundtrip_and_v1_preserves_unrepresented_fields(self):
        row = self.task('Imported', parent=self.parent, dependency=self.parent, source_key='test:source', source_metadata={'original_status':'Done', 'activity_date_raw':'2026-09-07'})
        data = json.loads(encode(row))
        self.assertEqual(data['schema'], 3)
        fields = decode(row, json.dumps(data))
        self.assertEqual(fields['parent_id'], self.parent.pk)
        self.assertEqual(fields['owner_id'], self.owner.pk)
        self.assertEqual(fields['source_metadata'], row.source_metadata)
        data['schema'] = 1
        for key in ['owner_id','dependency_id','parent_id','source_key','source_metadata','created_at','started_at','date_provenance']: data['fields'].pop(key)
        fields = decode(row, json.dumps(data))
        self.assertEqual(fields['parent_id'], self.parent.pk)
        self.assertEqual(fields['source_key'], 'test:source')

    def test_canonical_rejects_source_rebinding_and_hierarchy_cycle(self):
        row = self.task('Imported', source_key='test:source')
        data = json.loads(encode(row));data['fields']['source_key']='other'
        with self.assertRaises(ValueError): decode(row,json.dumps(data))
        data = json.loads(encode(row));data['fields']['parent_id']=row.pk
        with self.assertRaises(ValidationError): decode(row,json.dumps(data))
