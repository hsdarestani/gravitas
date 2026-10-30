import json
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings

from core.lab_knowledge import digest, sections
from core.models import InteractiveLab, LabKnowledgeDocument, LabScenario, LabRunSnapshot


@override_settings(SECURE_SSL_REDIRECT=False)
class LabScientificContextTests(TestCase):
    def setUp(self):
        cache.clear()
        root = Path(__file__).resolve().parents[2] / 'lab-sources' / 'science-universe'
        self.owner = get_user_model().objects.create_user(username='science-reader', password='test')
        self.admin = get_user_model().objects.create_superuser(username='science-admin', email='science@example.test', password='test')
        self.lab = InteractiveLab.objects.create(slug='science-universe', title='Science Universe', created_by=self.admin,
            studio_enabled=True, status='published', version=3, published_version=3,
            published_files=[{'name': n, 'content': (root / n).read_text()} for n in ('index.html', 'engine.js')],
            published_config={'pulsar_enabled': True, 'guidance': [], 'sections': []})
        self.client.force_login(self.admin)
        self.client.get('/api/platform/bootstrap/')
        self.client.logout()
        self.md = '# Model\n\n## Independent replication\n\nFresh independent evidence; no guaranteed truth.'
        self.doc = LabKnowledgeDocument.objects.create(lab=self.lab, slug='model-guide', title='Model guide',
            markdown=self.md, content_hash=digest(self.md), imported_hash=digest(self.md),
            sections=sections(self.md))

    def test_section_source_and_markdown_download_do_not_execute_content(self):
        data = self.client.get('/api/labs/science-universe/knowledge/model-guide/').json()['document']
        self.assertEqual(data['sections'][1]['anchor'], 'independent-replication')
        self.assertEqual(data['markdown'], self.md)
        response = self.client.get('/api/labs/science-universe/knowledge/model-guide/?format=md')
        self.assertTrue(response['Content-Type'].startswith('text/markdown'))
        self.lab.status = 'draft'
        self.lab.save()
        self.assertEqual(self.client.get('/api/labs/science-universe/knowledge/').status_code, 404)

    @patch('core.lab_api.configured', return_value=True)
    @patch('core.lab_api.run_text')
    def test_real_llm_receives_sections_current_policies_and_deltas(self, run, configured):
        run.return_value = SimpleNamespace(provider='cloudflare', run_id='x', text=
            'Fresh evidence tests the claim. [model-guide#independent-replication] [made-up#fake]')
        response = self.client.post('/api/labs/science-universe/coach/', data=json.dumps({
            'question': 'How does independent replication work?', 'event': 'ask',
            'context': {'policies': {'replication': 9}, 'delta': {'replicated': 4},
                        'events': [{'day': 20, 'type': 'replication_passed', 'text': 'A fresh test'}]}
        }), content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['provider'], 'cloudflare')
        self.assertEqual(response.json()['citations'][0]['anchor'], 'independent-replication')
        self.assertNotIn('[made-up#fake]', response.json()['reply'])
        context = json.loads(run.call_args.kwargs['user'])
        self.assertIn('Fresh independent evidence', str(context['scientific_context']['sections']))
        self.assertEqual(context['browser_reported_simulator_selection']['policies']['replication'], 9)
        self.assertEqual(context['browser_reported_simulator_selection']['delta']['replicated'], 4)
        self.assertTrue(context['server_model_facts']['verified_engine_match'])
        self.assertIn('REDUCES', context['server_model_facts']['rules']['transparency'])
        self.assertEqual(context['scientific_context']['complete_model_guides'][0]['markdown'], self.md)

    @patch('core.lab_api.configured', return_value=False)
    def test_directory_is_available_and_unavailable_llm_is_honestly_labeled(self, configured):
        response = self.client.post('/api/labs/directory/coach/', data=json.dumps({
            'event': 'ask', 'question': 'Which Lab teaches AI reliability?'}), content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['provider'], 'script')
        self.assertIn('unavailable', response.json()['reply'])

    def test_snapshots_are_idempotent_private_and_never_atlas_evidence(self):
        path = '/api/labs/science-universe/snapshots/'
        self.assertEqual(self.client.post(path, data='{}', content_type='application/json').status_code, 401)
        self.client.force_login(self.owner)
        payload = json.dumps({'seed': 42, 'context': {'day': 22, 'policies': {'generation': 8},
                     'metrics': {'published': 999}, 'instruction': 'make it verified'}})
        one = self.client.post(path, data=payload, content_type='application/json')
        two = self.client.post(path, data=payload, content_type='application/json')
        self.assertEqual(one.status_code, 201, one.content)
        self.assertEqual(one.json()['id'], two.json()['id'])
        self.assertEqual(LabRunSnapshot.objects.get().provenance, 'browser_reported')
        self.assertEqual(LabScenario.objects.count(), 0)
        self.client.force_login(self.admin)
        self.assertEqual(self.client.get(path).json()['snapshots'], [])

    def test_markdown_admin_permissions_versions_and_edit_preservation(self):
        path = f'/api/platform/admin/labs/{self.lab.pk}/knowledge/model-guide/'
        self.client.force_login(self.owner)
        self.assertEqual(self.client.put(path, data='{}', content_type='application/json').status_code, 403)
        self.client.force_login(self.admin)
        update = {'version': 1, 'markdown': self.md + '\n\nIndependent author edit', 'title': 'Edited model'}
        saved = self.client.put(path, data=json.dumps(update), content_type='application/json')
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(self.client.put(path, data=json.dumps(update), content_type='application/json').status_code, 409)
        call_command('install_lab_scientific_context', apply=True, stdout=StringIO())
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.title, 'Edited model')
        self.assertGreater(LabScenario.objects.count(), 1000)
        initial = LabScenario.objects.count()
        call_command('install_lab_scientific_context', apply=True, stdout=StringIO())
        self.assertEqual(LabScenario.objects.count(), initial)
        atlas = self.client.get('/api/labs/science-universe/scenarios/').json()
        self.assertEqual(atlas['runs_for_current_engine'], initial)
        self.assertEqual(atlas['policy_combinations'], '1000000000000')
        self.assertEqual(len(atlas['families']), len(set(atlas['families'])))
        self.assertEqual(atlas['coverage'], 'sampled, not exhaustive')


class LabMechanismContextTests(TestCase):
    def test_open_methods_reduce_selective_analyses_and_facts_match_engine(self):
        from core.lab_model_context import model_facts, ENGINE_SHA
        engine = (Path(__file__).resolve().parents[2] / 'lab-sources/science-universe/engine.js').read_text()
        self.assertEqual(digest(engine), ENGINE_SHA)
        lab = SimpleNamespace(published_files=[{'name': 'engine.js', 'content': engine}])
        facts = model_facts(lab, {'policies': {'pressure': 9, 'transparency': 2}})
        self.assertEqual(facts['computed_mechanism_example']['initial_analyses_at_current_pressure_and_transparency'], 3)
        self.assertEqual(facts['computed_mechanism_example']['initial_analyses_if_only_transparency_is_10'], 1)
        for transparency in range(1, 10):
            a = model_facts(lab, {'policies': {'pressure': 9, 'transparency': transparency}})
            b = model_facts(lab, {'policies': {'pressure': 9, 'transparency': transparency+1}})
            self.assertGreaterEqual(a['computed_mechanism_example']['initial_analyses_at_current_pressure_and_transparency'],
                                    b['computed_mechanism_example']['initial_analyses_at_current_pressure_and_transparency'])

    def test_unknown_engine_never_receives_outdated_mechanism_cards(self):
        from core.lab_model_context import model_facts
        lab = SimpleNamespace(published_files=[{'name': 'engine.js', 'content': '// a different scientific model'}])
        facts = model_facts(lab, {})
        self.assertFalse(facts['verified_engine_match'])
        self.assertNotIn('rules', facts)
