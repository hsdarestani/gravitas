from copy import deepcopy
from django.contrib.auth import get_user_model
from django.test import TestCase
from .models import ResearchProject, ProjectMembership
from .operating_models import OperatingTask
from .platform_runtime_v3 import ensure_platform_workspaces
from .task_source_migration import apply_plan, validate


class SourceMigrationTests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_superuser('import-owner','owner@example.test','pass')
        spaces = ensure_platform_workspaces(self.owner)
        self.project = ResearchProject.objects.create(workspace=spaces['research'], owner=self.owner, title='Existing')
        ProjectMembership.objects.create(project=self.project, user=self.owner, role='owner')
        self.plan = {'schema':1,'run_id':'test-run','workspace_id':spaces['core'].pk,'actor_id':self.owner.pk,
            'projects':[{'key':'existing','id':self.project.pk,'owner_id':self.owner.pk}],
            'tasks':[self.row('parent','Historical package','draft'),self.row('child','Historical step','retest',parent_source_key='parent')]}

    def row(self,key,title,status,**extra):
        return dict(source_key=key,title=title,status=status,owner_id=self.owner.pk,project='existing',
            definition_of_done='Source reported output, acceptance not verified',source_metadata={'activity_date_raw':'2026-09-01'},**extra)

    def test_dry_validation_does_not_write_and_apply_is_idempotent(self):
        validate(self.plan)
        self.assertEqual(OperatingTask.objects.count(),0)
        first=apply_plan(self.plan);self.assertEqual(first['created'],2)
        child=OperatingTask.objects.get(source_key='child')
        self.assertEqual(child.parent.source_key,'parent');self.assertIsNone(child.due_date)
        self.assertEqual(child.status,'retest')
        second=apply_plan(self.plan);self.assertEqual(second['created'],0);self.assertEqual(second['matched'],2)

    def test_existing_task_state_is_not_overwritten(self):
        old=OperatingTask.objects.create(workspace_id=self.plan['workspace_id'],owner=self.owner,
            title='Newer live title',description='Newer evidence',status='active',definition_of_done='Live output')
        row=self.row('existing-source','Source title','done',task_id=old.pk,expected_updated_at=old.updated_at.isoformat())
        plan=deepcopy(self.plan);plan['tasks']=[row]
        result=apply_plan(plan);old.refresh_from_db()
        self.assertEqual(old.title,'Newer live title');self.assertEqual(old.status,'active')
        self.assertEqual(old.description,'Newer evidence');self.assertEqual(old.project_id,self.project.pk)
        self.assertEqual(result['updated'],1);self.assertIsNotNone(result['tasks'][0]['before'])

    def test_stale_existing_task_aborts_without_partial_creates(self):
        old=OperatingTask.objects.create(workspace_id=self.plan['workspace_id'],owner=self.owner,title='Existing',definition_of_done='Live')
        plan=deepcopy(self.plan)
        plan['tasks'].append(self.row('stale','Existing','done',task_id=old.pk,expected_updated_at='2020-01-01T00:00:00Z'))
        with self.assertRaisesMessage(ValueError,'stale_task'):apply_plan(plan)
        self.assertEqual(OperatingTask.objects.count(),1)

    def test_failed_hierarchy_rolls_back_entire_batch(self):
        plan=deepcopy(self.plan);plan['tasks'][1]['parent_source_key']='missing'
        with self.assertRaises(ValueError):apply_plan(plan)
        self.assertEqual(OperatingTask.objects.count(),0)

    def test_later_batch_can_reuse_prior_parent(self):
        parent=deepcopy(self.plan);parent['tasks']=parent['tasks'][:1];apply_plan(parent)
        child=deepcopy(self.plan);child['tasks']=child['tasks'][1:];apply_plan(child)
        self.assertEqual(OperatingTask.objects.get(source_key='child').parent.source_key,'parent')
