import hashlib
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from unittest.mock import patch

import requests
from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings

from .release_models import ReleaseChange, ReleaseEvent, ReleaseRevision
from .visual_registry import PAGES, fields_for, values_for


BASE = '/api/release-center/changes/'


@override_settings(RELEASE_CENTER_ENABLED=True)
class ReleaseCenterTest(TestCase):
    def setUp(self):
        users = get_user_model().objects
        self.author, self.reviewer, self.manager = (
            users.create_superuser(f'{role}@example.test', email=f'{role}@example.test')
            for role in ('author', 'reviewer', 'manager')
        )
        self.clients = {}
        for actor in (self.author, self.reviewer, self.manager):
            session = Client()
            session.force_login(actor)
            self.clients[actor.pk] = session
        self.member = users.create_user('ordinary@example.test')
        self.members = Client()
        self.members.force_login(self.member)

    def post(self, actor, url, data, code=200):
        response = self.clients[actor.pk].post(url, data, content_type='application/json')
        self.assertEqual(response.status_code, code, response.content)
        return response.json()

    def create(self, edits=None):
        return self.post(self.author, BASE, {
            'kind':'visual', 'page':'home', 'title':'Staging homepage improvements',
            'edits': edits or {'heading':'A changed hero'},
        }, 201)['change']

    def step(self, change, actor, action, code=200):
        response = self.post(actor, f"{BASE}{change['id']}/", {
            'action': action, 'sequence': change['sequence'], 'note':'Synthetic QA evidence',
        }, code)
        return response.get('change', response)

    def approve(self, change):
        change = self.step(change, self.author, 'submit')
        for action in ('validate', 'ready', 'review', 'approve'):
            change = self.step(change, self.reviewer, action)
        return change

    def test_every_registry_entry_matches_exactly_one_source_element(self):
        for page in PAGES:
            self.assertEqual(set(values_for(page)), set(fields_for(page)))

    def test_roles_preview_draft_approval_publication_and_versioned_restore(self):
        self.assertEqual(Client().get(BASE).status_code, 401)
        self.assertEqual(self.members.get(BASE).status_code, 403)
        strict = Client(enforce_csrf_checks=True)
        strict.force_login(self.author)
        self.assertEqual(strict.post(BASE, {'kind':'development'}, content_type='application/json').status_code, 403)
        edits = {'heading':'New heading', 'cta_label':'Browse the Topics', 'hero_spacing':'compact'}
        draft = self.create(edits)
        self.assertNotIn('New heading', values_for('home').values())
        preview = f"/api/release-center/visual/home/preview/?change={draft['id']}"
        self.assertEqual(self.members.get(preview).status_code, 403)
        rendered = self.clients[self.author.pk].get(preview)
        self.assertContains(rendered, 'New heading')
        self.assertContains(rendered, 'Browse the Topics')
        self.assertNotContains(rendered, '<script')
        self.assertIn("default-src 'none'", rendered['Content-Security-Policy'])
        with self.settings(RELEASE_CENTER_ENABLED=False):
            self.assertEqual(self.clients[self.author.pk].get(BASE).status_code, 404)

        change = self.step(draft, self.author, 'submit')
        self.step(change, self.author, 'validate', 403)
        for action in ('validate','ready','review','approve'):
            change = self.step(change, self.reviewer, action)
        self.assertEqual(change['approved_revision'], 1)
        published = self.step(change, self.manager, 'rehearse')
        self.assertEqual(published['state'], 'released')
        self.step(change, self.manager, 'rehearse', 409)
        rendered = self.clients[self.author.pk].get('/api/release-center/visual/home/preview/?target=rehearsal')
        self.assertContains(rendered, 'New heading')

        restoration = self.step(published, self.author, 'restore', 201)
        self.step(published, self.author, 'restore', 409)
        self.assertEqual(restoration['restore_of'], published['id'])
        restored = self.step(self.approve(restoration), self.manager, 'rehearse')
        self.assertEqual(restored['state'], 'released')
        self.assertEqual(ReleaseChange.objects.get(pk=draft['id']).state, 'rolled_back')
        self.assertTrue(ReleaseEvent.objects.filter(change_id=draft['id'], action='rehearsal_restored').exists())
        rendered = self.clients[self.author.pk].get('/api/release-center/visual/home/preview/?target=rehearsal')
        self.assertNotContains(rendered, 'New heading')

    def test_reject_and_revise_gets_new_independent_review(self):
        draft = self.step(self.create(), self.author, 'submit')
        for action in ('validate','ready','review'):
            draft = self.step(draft, self.reviewer, action)
        rejected = self.step(draft, self.reviewer, 'reject')
        self.step(rejected, self.manager, 'rehearse', 409)
        response = self.clients[self.author.pk].patch(f"{BASE}{draft['id']}/", {
            'sequence': rejected['sequence'], 'title':'Corrected draft', 'edits':{'heading':'Another heading'},
        }, content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        revised = response.json()['change']
        self.assertEqual((revised['sequence'], revised['revision'], revised['state']),
                         (rejected['sequence'] + 1, 2, 'draft'))
        self.assertIsNone(revised['approved_revision'])
        self.assertEqual(ReleaseRevision.objects.filter(change_id=draft['id']).count(), 2)

    def test_conflicting_drafts_stale_updates_and_untrusted_values(self):
        first = self.create()
        second = self.create({'heading':'A conflicting draft'})
        compatible = self.create({'cta_label':'Independent label'})
        self.step(self.approve(first), self.manager, 'rehearse')
        self.step(self.approve(second), self.manager, 'rehearse', 409)
        self.step(self.approve(compatible), self.manager, 'rehearse')
        for edits in ({'heading':'<script>alert(1)</script>'}, {'cta_link':'javascript:alert(1)'},
                      {'hero_spacing':'url(https://example.test)'}, {'css':'display:none'}):
            self.post(self.author, BASE, {
                'kind':'visual', 'page':'home', 'title':'Rejected input', 'edits':edits,
            }, 400)

    def test_development_validation_requires_verified_exact_ci(self):
        sha = 'a' * 40
        draft = self.post(self.author, BASE, {
            'kind': 'development', 'title': 'Linked development change', 'pr': 409, 'sha': sha,
        }, 201)['change']
        draft = self.step(draft, self.author, 'submit')
        draft = self.step(draft, self.reviewer, 'validate')
        url = f"{BASE}{draft['id']}/"
        data = {'action': 'ready', 'sequence': draft['sequence'], 'note': 'QA evidence', 'ci_run': 15}
        repository = {'full_name': 'hsdarestani/gravitas'}
        run = {'repository':repository, 'head_repository':repository, 'head_sha':'b' * 40,
               'path':'.github/workflows/platform-ci.yml', 'status':'completed', 'conclusion':'success'}
        with patch('core.release_evidence.public_json', return_value=run):
            self.post(self.reviewer, url, data, 400)
            run['head_sha'] = sha
            accepted = self.post(self.reviewer, url, data)['change']
        self.assertEqual(accepted['state'], 'ready_for_qa')
        self.assertEqual(accepted['history'][-1]['evidence']['run_id'], 15)

    def test_exact_application_deploy_and_rollback_on_a_separate_live_target(self):
        root = Path(__file__).resolve().parents[2]
        spec = importlib.util.spec_from_file_location('isolated_release_target', root / 'ops/staging/isolated_release_target.py')
        target = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(target)
        baseline, candidate = 'a' * 40, 'b' * 40
        token = 'dedicated-isolated-test-token-' + 'x' * 32
        repository = 'hsdarestani/gravitas'
        run = {'repository': {'full_name': repository}, 'head_repository': {'full_name': repository},
               'head_sha': candidate, 'path': '.github/workflows/platform-ci.yml',
               'status': 'completed', 'conclusion': 'success'}
        with TemporaryDirectory() as directory:
            artifacts = Path(directory)
            (artifacts / '.isolated-release-target').write_text(target.TARGET)
            for revision, label in ((baseline, 'Original artifact'), (candidate, 'Approved candidate artifact')):
                bundle = artifacts / 'artifacts' / revision
                bundle.mkdir(parents=True)
                (bundle / 'index.html').write_text(label)
            with target.create_server(target.Target(artifacts, baseline), token, 0) as server:
                port = server.server_port
                thread = Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    url = f'http://127.0.0.1:{port}'
                    headers = {'Authorization': f'Bearer {token}'}
                    self.assertEqual(requests.get(url + '/health', timeout=3).status_code, 403)
                    with self.settings(ISOLATED_RELEASE_TOKEN=token, ISOLATED_RELEASE_PORT=port):
                        draft = self.post(self.author, BASE, {
                            'kind': 'development', 'title': 'Isolated application release',
                            'sha': candidate, 'previous_sha': baseline,
                        }, 201)['change']
                        self.step(draft, self.manager, 'rehearse_application', 409)
                        change = self.step(draft, self.author, 'submit')
                        change = self.step(change, self.reviewer, 'validate')
                        endpoint = f"{BASE}{change['id']}/"
                        with patch('core.release_evidence.public_json', return_value=run):
                            change = self.post(self.reviewer, endpoint, {
                                'action': 'ready', 'sequence': change['sequence'], 'note': 'Exact CI', 'ci_run': 14,
                            })['change']
                        change = self.step(change, self.reviewer, 'review')
                        change = self.step(change, self.reviewer, 'approve')
                        self.step(change, self.author, 'rehearse_application', 403)
                        result = self.step(change, self.manager, 'rehearse_application')
                        self.assertEqual(result['state'], 'released')
                        receipt = result['history'][-1]['evidence']
                        self.assertEqual(receipt['digest'], hashlib.sha256(b'Approved candidate artifact').hexdigest())
                        self.assertEqual(requests.get(url, headers=headers, timeout=3).text, 'Approved candidate artifact')
                        duplicate = requests.post(url + '/release', headers=headers, timeout=3, json={
                            'operation': 'deploy', 'key': receipt['key'], 'expected': baseline, 'revision': candidate,
                        })
                        self.assertEqual(duplicate.json(), receipt)
                        stale = requests.post(url + '/release', headers=headers, timeout=3, json={
                            'operation': 'deploy', 'key': '9000.1.deploy', 'expected': baseline, 'revision': candidate,
                        })
                        self.assertEqual(stale.status_code, 409)
                        restored = self.step(result, self.manager, 'rollback_application')
                        self.assertEqual(restored['state'], 'rolled_back')
                        self.assertEqual(restored['history'][-1]['evidence']['revision'], baseline)
                        self.assertEqual(requests.get(url, headers=headers, timeout=3).text, 'Original artifact')
                        meta = self.clients[self.manager.pk].get(BASE).json()
                        self.assertFalse(meta['production_enabled'])
                        self.assertTrue(meta['capabilities']['isolated_application'])
                finally:
                    server.shutdown()
                    thread.join(timeout=5)
