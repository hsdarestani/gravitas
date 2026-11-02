import gzip
import json
from pathlib import Path
from statistics import mean
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from core.lab_knowledge import digest
from core.lab_knowledge_models import LabCoachTrial, LabConversation, LabScenario
from core.models import InteractiveLab


@override_settings(SECURE_SSL_REDIRECT=False)
class LabLearningTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        root = Path(__file__).resolve().parents[2]
        owner = get_user_model().objects.create_user(username='learning-owner')
        cls.lab = InteractiveLab.objects.create(slug='science-universe', title='Science Ecosystem',
            created_by=owner, studio_enabled=True, status='published', version=1, published_version=1,
            published_files=[{'name': n, 'content': (root/'lab-sources/science-universe'/n).read_text()} for n in ['index.html', 'engine.js']],
            published_config={'pulsar_enabled': True})
        with gzip.open(root/'backend/core/data/lab-scenario-atlas.json.gz', 'rt') as handle:
            cls.runs = [r for r in json.load(handle)['runs'] if r['family'] in ['baseline', 'single:verification']]
        for row in cls.runs:
            LabScenario.objects.create(lab=cls.lab, **row)

    def setUp(self):
        cache.clear()

    def test_atlas_uses_paired_stored_runs_and_exact_differences(self):
        response = self.client.get('/api/labs/science-universe/scenarios/compare/?policy=verification&low=3&high=9')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data['matched_seeds'], 3)
        self.assertEqual(data['provenance'], 'stored_model_execution')
        deltas = []
        for pair in data['pairs']:
            a, b = pair['a'], pair['b']
            self.assertEqual(a['seed'], b['seed'])
            self.assertEqual(a['days'], b['days'])
            self.assertEqual(a['design'], b['design'])
            self.assertEqual([k for k in a['parameters'] if a['parameters'][k] != b['parameters'][k]], ['verification'])
            deltas.append(b['result']['published']-a['result']['published'])
        self.assertEqual(data['metrics']['published']['delta'], mean(deltas))
        self.assertEqual(data['metrics']['published']['delta_min'], min(deltas))
        self.assertEqual(data['trajectory'][-1]['day'], data['days'])
        self.assertEqual(data['trajectory'][-1]['b']['published'], data['metrics']['published']['b'])

    def test_atlas_does_not_mix_other_horizons_into_seed_means(self):
        for setting in (3, 9):
            original = next(row for row in self.runs if row['parameters']['verification'] == setting)
            row = {**original, 'signature': digest('other-horizon-'+str(setting)), 'seed': 90000, 'days': 120}
            LabScenario.objects.create(lab=self.lab, **row)
        result = self.client.get('/api/labs/science-universe/scenarios/compare/?low=3&high=9').json()
        self.assertEqual(result['matched_seeds'], 3)
        self.assertEqual(result['days'], 60)

    def test_atlas_rejects_equal_settings_and_excludes_other_engine_versions(self):
        self.assertEqual(self.client.get('/api/labs/science-universe/scenarios/compare/?low=3&high=3').status_code, 400)
        LabScenario.objects.filter(lab=self.lab, parameters__verification=9).update(engine_sha='old-engine')
        self.assertEqual(self.client.get('/api/labs/science-universe/scenarios/compare/?low=3&high=9').status_code, 404)

    @patch('core.lab_api.configured', return_value=True)
    @patch('core.lab_api.run_text')
    def test_atlas_tutor_gets_verified_aggregates_and_mixed_seed_spread(self, run, configured):
        run.return_value = SimpleNamespace(provider='cloudflare', run_id='atlas', text='Compare publication counts and the range across the three matched seeds.')
        data = self.client.get('/api/labs/science-universe/scenarios/compare/?low=3&high=9').json()
        selection = {'policy': 'verification', 'low': 3, 'high': 9,
                     'signatures': [p[side]['signature'] for p in data['pairs'] for side in ('a', 'b')],
                     'metrics': {'falsePublished': {'delta': 999}}}
        response = self.client.post('/api/labs/science-universe/coach/', json.dumps({
            'event': 'ask', 'question': 'Does more checking always increase false claims?',
            'atlas_comparison': selection}), content_type='application/json')
        self.assertEqual(response.status_code, 200)
        payload = json.loads(run.call_args.kwargs['user'])
        summary = payload['server_selected_atlas_comparison']
        self.assertEqual(summary['matched_seeds'], 3)
        self.assertEqual(summary['metrics'], data['metrics'])
        self.assertEqual(summary['metrics']['falsePublished']['seed_direction'], 'mixed')
        self.assertEqual(summary['metrics']['falsePublished']['delta_min'], -5)
        self.assertEqual(summary['metrics']['falsePublished']['delta_max'], 4)
        self.assertIn('COUNT does not establish', run.call_args.kwargs['system'])
        self.assertLess(len(run.call_args.kwargs['user']), 18000, 'atlas questions receive focused evidence rather than duplicate full guides and earlier assistant prose')
        self.assertNotIn('browser_reported_chat_history', payload)
        self.assertIn('opposite signs', payload['required_uncertainty'])
        from core.lab_learning import selected_atlas_summary
        rows = [p[side] for p in data['pairs'] for side in ('a', 'b')]
        self.assertIsNone(selected_atlas_summary(rows[:-1], selection))
        rows[0]['days'] += 1
        self.assertIsNone(selected_atlas_summary(rows, selection))

    @patch('core.lab_api.configured', return_value=True)
    @patch('core.lab_api.run_text')
    def test_twenty_five_guest_questions_then_account_gate_without_closing_lab(self, run, configured):
        run.return_value = SimpleNamespace(provider='cloudflare', run_id='trial', text='Compare both worlds over the same model days.')
        for index in range(25):
            cache.clear()  # Independent of the shorter per-minute transport limit.
            response = self.client.post('/api/labs/science-universe/coach/', json.dumps({'event':'ask', 'question':'Explain the review queue.'}), content_type='application/json')
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.json()['access']['remaining'], 24-index)
        cache.clear()
        denied = self.client.post('/api/labs/science-universe/coach/', json.dumps({'event':'ask', 'question':'One more?'}), content_type='application/json')
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(denied.json()['error'], 'trial_exhausted')
        self.assertEqual(run.call_count, 25)
        self.assertEqual(self.client.get('/api/labs/science-universe/access/').json()['remaining'], 0)
        self.assertEqual(self.client.get('/api/labs/science-universe/scenarios/compare/?low=3&high=9').status_code, 200)
        self.assertEqual(self.client.get('/lab-run/science-universe/').status_code, 200)
        user = get_user_model().objects.create_user(username='signed-in-reader')
        self.client.force_login(user)
        response = self.client.post('/api/labs/science-universe/coach/', json.dumps({'event':'ask','question':'Continue.'}), content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.client.get('/api/labs/science-universe/access/').json()['authenticated'])

    @patch('core.lab_api.configured', return_value=True)
    @patch('core.lab_api.run_text')
    def test_unavailable_model_and_automatic_notes_do_not_spend_guest_questions(self, run, configured):
        from core.pulsar import PulsarError
        run.side_effect = PulsarError('unavailable')
        response = self.client.post('/api/labs/science-universe/coach/', json.dumps({'event':'ask','question':'Explain.'}), content_type='application/json')
        self.assertEqual(response.json()['provider'], 'script')
        self.assertEqual(LabCoachTrial.objects.get().used, 0)
        run.side_effect = None
        run.return_value = SimpleNamespace(provider='cloudflare', run_id='note', text='Follow the waiting list.')
        response = self.client.post('/api/labs/science-universe/coach/', json.dumps({'event':'policy_changed'}), content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(LabCoachTrial.objects.get().used, 0)

    def test_account_history_is_private_merged_and_idempotent(self):
        self.assertEqual(self.client.get('/api/labs/science-universe/conversation/').status_code, 401)
        owner = get_user_model().objects.create_user(username='conversation-owner')
        other = get_user_model().objects.create_user(username='conversation-other')
        self.client.force_login(owner)
        message = {'id':'m1','role':'user','text':'My saved research question','at':1000}
        for _ in range(2):
            response = self.client.post('/api/labs/science-universe/conversation/', json.dumps({'messages':[message]}), content_type='application/json')
            self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(LabConversation.objects.get().messages), 1)
        message['text'] = 'overwrite attempt'
        self.client.post('/api/labs/science-universe/conversation/', json.dumps({'messages':[message]}), content_type='application/json')
        self.assertEqual(self.client.get('/api/labs/science-universe/conversation/').json()['messages'][0]['text'], 'My saved research question')
        self.client.force_login(other)
        self.assertEqual(self.client.get('/api/labs/science-universe/conversation/').json()['messages'], [])
