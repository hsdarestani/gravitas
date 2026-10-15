import sys
from pathlib import Path
from unittest.mock import patch
from . import test_canonical_projects as canonical_fixture
from django.test import TestCase,override_settings
from .models import ResearchProject
from .operating_models import OperatingTask
from .canonical_projects import adopt_project,_pending
from .canonical_journal import journal_transaction
from .canonical_models import CanonicalFile
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'ops'))
from portfolio_reconciliation import move_tree
@override_settings(SECURE_SSL_REDIRECT=False, GRAVITAS_CANONICAL_ADOPTION_ENABLED=True)
class PortfolioMoveTests(TestCase):
 setUp=canonical_fixture.CanonicalProjectTests.setUp
 adopt=canonical_fixture.CanonicalProjectTests.adopt
 def test_move_retains_ids_and_tree_with_one_active_canonical_file(self):
  self.adopt()
  destination=ResearchProject.objects.create(workspace=self.project.workspace,owner=self.owner,title='Characters')
  adopt_project(destination,self.owner)
  @journal_transaction
  def make():
   a=OperatingTask.objects.create(workspace=self.project.workspace,project=self.project,owner=self.owner,title='Character work',status='done',source_key='test:parent',definition_of_done='Reported completion')
   b=OperatingTask.objects.create(workspace=self.project.workspace,project=self.project,owner=self.owner,title='Hulse',status='done',source_key='test:child',parent=a,definition_of_done='Reported completion')
   return a,b
  a,b=make();ids=(a.pk,b.pk)
  @journal_transaction
  def execute():
   token=_pending.set([])
   try:move_tree([a,b],destination,self.owner)
   finally:_pending.reset(token)
  execute();a.refresh_from_db();b.refresh_from_db()
  self.assertEqual((a.pk,b.pk),ids);self.assertEqual(b.parent_id,a.pk)
  self.assertEqual((a.project_id,b.project_id),(destination.pk,destination.pk))
  self.assertEqual(a.status,'done');self.assertIsNone(a.due_date)
  for task in (a,b):
   self.assertEqual(CanonicalFile.objects.filter(object_type='OperatingTask',object_id=task.pk,deleted=False).count(),1)
   self.assertTrue(CanonicalFile.objects.get(project=self.project,object_type='OperatingTask',object_id=task.pk).deleted)
  self.assertEqual(OperatingTask.objects.count(),2)
 def test_inactive_destination_is_rejected_before_archiving_source(self):
  self.adopt()
  destination=ResearchProject.objects.create(workspace=self.project.workspace,owner=self.owner,title='Not adopted')
  @journal_transaction
  def make():return OperatingTask.objects.create(workspace=self.project.workspace,project=self.project,owner=self.owner,title='Keep native',source_key='test:guard')
  task=make()
  @journal_transaction
  def execute():move_tree([task],destination,self.owner)
  with self.assertRaisesMessage(ValueError,'destination_canonical_activation_required'):execute()
  task.refresh_from_db();self.assertEqual(task.project_id,self.project.pk)
  self.assertEqual(CanonicalFile.objects.filter(object_type='OperatingTask',object_id=task.pk,deleted=False).count(),1)
 def test_adoption_repairs_previously_moved_projection_without_new_task(self):
  from .canonical_signals import archive_object
  self.adopt()
  destination=ResearchProject.objects.create(workspace=self.project.workspace,owner=self.owner,title='Recovery destination')
  @journal_transaction
  def make():return OperatingTask.objects.create(workspace=self.project.workspace,project=self.project,owner=self.owner,title='Preserved historical work',status='done',source_key='test:recovery',source_metadata={'reported_status':'Done'},definition_of_done='Original reported work')
  task=make();original_id=task.pk
  @journal_transaction
  def reproduce_prior_gap():
   archive_object(task)
   OperatingTask.objects.filter(pk=task.pk).update(project=destination)
  reproduce_prior_gap()
  self.assertFalse(CanonicalFile.objects.filter(object_type='OperatingTask',object_id=task.pk,deleted=False).exists())
  adopt_project(destination,self.owner)
  task.refresh_from_db();self.assertEqual(task.pk,original_id);self.assertEqual(task.status,'done');self.assertIsNone(task.due_date)
  self.assertEqual(task.source_metadata,{'reported_status':'Done'});self.assertEqual(OperatingTask.objects.count(),1)
  native=CanonicalFile.objects.get(object_type='OperatingTask',object_id=task.pk,deleted=False)
  self.assertEqual(native.project_id,destination.pk);self.assertIn('Preserved historical work',native.base_content)
