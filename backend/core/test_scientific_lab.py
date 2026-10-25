import json
import uuid
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.test import TestCase, SimpleTestCase, override_settings
from django.db.models.deletion import ProtectedError
from core.models import ResearchProject, ProjectMembership
from core.platform_runtime_v3 import ensure_platform_workspaces
from core.scientific_lab_methods import metadata_match, wilson, summary
from core.scientific_lab_models import ScientificLabRun
from core.scientific_lab_runner import execute
from core.pulsar_runtime.types import ProviderResponse

PROVIDERS = [{'id': 'cloudflare-workers-ai', 'model': 'fixture-model', 'pricing': {'input_per_million': 0.1, 'output_per_million': 0.2}}]


class MethodsTests(SimpleTestCase):
    def test_doi_does_not_prove_metadata_or_claim(self):
        source = {'doi':'10.1234/test','title':'Actual Title','first_author':'Smith','year':'2020','journal':'Journal'}
        result = metadata_match({**source, 'title':'Different title'}, source)
        self.assertEqual(result['status'], 'metadata_mismatch')
        self.assertEqual(result['claim_support'], 'not_assessed')
        self.assertEqual(metadata_match({'doi': source['doi']},source)['status'],'incomplete')
        self.assertEqual(metadata_match(source,source)['status'],'metadata_verified')

    def test_uncertainty_and_missing_trials(self):
        self.assertIsNone(wilson(0,0))
        low, high = wilson(5,10)
        self.assertAlmostEqual(low, .236593, places=5)
        self.assertAlmostEqual(high, .763407, places=5)
        s = summary([{'condition':'direct','status':'failed'}])['direct']
        self.assertEqual(s['completed'],0)
        self.assertIsNone(s['metadata_verified_fraction'])
        self.assertIsNone(s['interval'])


@override_settings(SCIENTIFIC_LAB_ENABLED=True, SECURE_SSL_REDIRECT=False)
class LabTests(TestCase):
    def setUp(self):
        users = get_user_model()
        self.owner = users.objects.create_user(username='lab-owner',password='test')
        self.reviewer = users.objects.create_user(username='lab-reviewer',password='test')
        self.outsider = users.objects.create_user(username='lab-outsider',password='test')
        spaces = ensure_platform_workspaces(self.owner)
        self.project = ResearchProject.objects.create(owner=self.owner,workspace=spaces['research'],title='Lab fixture')
        ProjectMembership.objects.create(project=self.project,user=self.reviewer,role='owner')
        self.client.force_login(self.owner)
        self.base = f'/api/platform/projects/{self.project.pk}/scientific-lab/runs/'
        self.patcher = patch('core.scientific_lab_api.providers',return_value=PROVIDERS)
        self.patcher.start(); self.addCleanup(self.patcher.stop)
        self.payload = {'idempotency_key':str(uuid.uuid4()),'protocol':{'provider':'cloudflare-workers-ai','question':'What does the evidence show?','hypothesis':'Retrieval reduces metadata mismatches.','repeats':1,'reference_count':1}}

    def post(self, path, data):
        return self.client.post(path,data=json.dumps(data),content_type='application/json')

    def create(self):
        r=self.post(self.base,self.payload)
        self.assertEqual(r.status_code,201,r.content)
        self.run_id=r.json()['run']['id']
        self.path=self.base+self.run_id+'/'
        return ScientificLabRun.objects.get(pk=self.run_id)

    def test_idempotency_conflict_and_project_acl(self):
        run=self.create()
        self.assertEqual(self.post(self.base,self.payload).status_code,200)
        self.assertEqual(ScientificLabRun.objects.count(),1)
        self.payload['protocol']['hypothesis']='A different hypothesis changes the snapshot.'
        self.assertEqual(self.post(self.base,self.payload).status_code,409)
        self.client.force_login(self.outsider)
        self.assertEqual(self.client.get(self.path).status_code,404)
        self.assertEqual(self.client.get(self.path+'export/').status_code,404)
        with self.assertRaises(ProtectedError):
            run.experiment.delete()

    def test_independent_review_and_immutable_protocol(self):
        self.create()
        self.assertEqual(self.post(self.path,{'action':'queue'}).status_code,409)
        self.assertEqual(self.post(self.path,{'action':'submit_protocol'}).status_code,200)
        self.assertEqual(self.post(self.path,{'action':'approve_protocol','comment':'I approve my own work.'}).status_code,403)
        self.client.force_login(self.reviewer)
        self.assertEqual(self.post(self.path,{'action':'approve_protocol','comment':'Reviewed controls and exploratory limits.'}).status_code,200)
        self.assertEqual(self.post(self.path,{'action':'queue'}).status_code,200)
        self.assertEqual(self.post(self.path,{'action':'queue'}).status_code,409)

    def test_disabled_flag_and_quota(self):
        with override_settings(SCIENTIFIC_LAB_ENABLED=False):
            self.assertEqual(self.post(self.base,self.payload).status_code,503)
        for _ in range(10):
            self.payload['idempotency_key']=str(uuid.uuid4()); self.create()
        self.payload['idempotency_key']=str(uuid.uuid4())
        self.assertEqual(self.post(self.base,self.payload).status_code,429)

    @patch('core.scientific_lab_runner.retrieve', return_value={'records':[], 'provenance':{'fixture':True}})
    @patch('core.scientific_lab_runner.verify', return_value={'status':'unknown','claim_support':'not_assessed'})
    @patch('core.pulsar_runtime.providers.ManagedCloudflareProvider.complete')
    def test_worker_raw_evidence_review_and_export(self, complete, verify, retrieve):
        complete.return_value=ProviderResponse(text=json.dumps({'citations':[{'title':'=TEST','doi':'10.1234/test','claim':'Fixture only'}]}),provider='cloudflare-workers-ai',model='fixture-model',latency_ms=1)
        run=self.create(); run.state='queued';run.save()
        self.assertTrue(execute(run.pk)); self.assertFalse(execute(run.pk))
        self.assertEqual(complete.call_count,2)
        run.refresh_from_db();self.assertEqual(run.state,'results_pending_review')
        self.assertEqual(len(run.trials),2)
        self.assertTrue(all(t['status']=='complete' for t in run.trials))
        self.assertTrue(all(t['response']['text'] for t in run.trials))
        self.client.force_login(self.reviewer)
        self.assertEqual(self.post(self.path,{'action':'review_results','comment':'A review without assessments.'}).status_code,409)
        for t in run.trials:
            r=self.post(self.path,{'action':'assessment','trial':t['id'],'citation':0,'outcome':'insufficient','comment':'Fixture is not empirical source evidence; no support established.','effort_seconds':30})
            self.assertEqual(r.status_code,200,r.content)
        self.assertEqual(self.post(self.path,{'action':'review_results','comment':'Review complete; evidence remains insufficient.'}).status_code,200)
        self.assertIn(b"'=TEST",self.client.get(self.path+'export/?format=csv').content)
        self.assertIn(b'Protocol SHA256',self.client.get(self.path+'export/?format=md').content)
        self.assertEqual(run.events.filter(kind='worker_finished').count(),1)

    @patch('core.pulsar_runtime.providers.ManagedCloudflareProvider.complete',side_effect=RuntimeError('secret-key-must-not-leak'))
    @patch('core.scientific_lab_runner.retrieve',return_value={'records':[]})
    def test_provider_failure_never_fabricates_results(self, retrieve, complete):
        run=self.create();run.state='queued';run.save();execute(run.pk);run.refresh_from_db()
        self.assertTrue(all(t['status']=='failed' for t in run.trials))
        self.assertNotIn('secret-key-must-not-leak',json.dumps(run.trials))
        self.assertTrue(all('response' not in t for t in run.trials))

    def test_csrf_enforced(self):
        from django.test import Client
        client=Client(enforce_csrf_checks=True);client.force_login(self.owner)
        self.assertEqual(client.post(self.base,data=json.dumps(self.payload),content_type='application/json').status_code,403)
