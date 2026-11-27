from unittest.mock import patch

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
