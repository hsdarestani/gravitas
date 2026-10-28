import json
from unittest.mock import patch, SimpleNamespace

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import InteractiveLab, LabRevision, ContentItem


@override_settings(SECURE_SSL_REDIRECT=False)
class LabStudioTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(username='lab-owner@example.com',
                                              email='lab-owner@example.com', password='test')
        self.reader = User.objects.create_user(username='lab-reader@example.com',
                                               email='lab-reader@example.com', password='test')
        self.client.force_login(self.owner)
        boot = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(boot.status_code, 200, boot.content)
        self.files = [
            {'name': 'index.html', 'content': '<!doctype html><html><head></head><body>Lab v1<script src="app.js"></script></body></html>'},
            {'name': 'app.js', 'content': "GraviLab.emit('change', {value: 2}, 'intro');"},
        ]
        self.config = {
            'components': ['stage', 'controls', 'metrics', 'compare'],
            'learning_goal': 'Compare one variable at a time.',
            'sections': [{'id': 'intro', 'title': 'Start', 'hint': 'Begin with a baseline.'}],
            'guidance': [{'event': 'change', 'section': 'intro',
                          'hint': 'Compare the measured value.', 'concept': 'One variable changed.'}],
            'pulsar_enabled': True, 'auto_coach': True,
        }

    def create_draft(self, **changes):
        payload = {'slug': 'lab-one', 'title': 'Lab One', 'files': self.files, 'config': self.config}
        payload.update(changes)
        result = self.client.post('/api/platform/admin/labs/',
                                  data=json.dumps(payload), content_type='application/json')
        self.assertEqual(result.status_code, 201, result.content)
        return result.json()['lab']

    def test_draft_is_private_and_legacy_published_is_not_auto_released(self):
        draft = self.create_draft(status='published')
        self.assertFalse(draft['ready'])
        self.assertEqual(draft['status'], 'draft')
        legacy = InteractiveLab.objects.create(
            slug='old-lab', title='Old', status='published', files=self.files, created_by=self.owner
        )
        self.client.logout()
        public = self.client.get('/api/labs/')
        self.assertEqual(public.status_code, 200)
        self.assertEqual(public.json()['labs'], [])
        self.assertEqual(self.client.get('/lab-run/old-lab/').status_code, 404)
        self.assertEqual(self.client.get('/lab-run/lab-one/').status_code, 404)
        self.assertEqual(self.client.get('/api/labs/lab-one/').status_code, 404)
        self.assertFalse(legacy.studio_enabled)

    def test_snapshot_publish_edit_unpublish_restore_and_code_isolation(self):
        draft = self.create_draft()
        self.assertEqual(LabRevision.objects.filter(lab_id=draft['id']).count(), 1)
        preview = self.client.get(f"/api/platform/admin/labs/{draft['id']}/preview/")
        self.assertEqual(preview.status_code, 200)
        self.assertIn('sandbox allow-scripts', preview['Content-Security-Policy'])
        self.assertIn('connect-src', preview['Content-Security-Policy'])
        self.assertEqual(preview['X-Frame-Options'], 'SAMEORIGIN')
        self.assertIn('assets/lab-bridge.js', preview.content.decode())
        released = self.client.post(f"/api/platform/admin/labs/{draft['id']}/publish/",
                                    data=json.dumps({'version': draft['version']}),
                                    content_type='application/json')
        self.assertEqual(released.status_code, 200, released.content)
        self.assertEqual(released.json()['lab']['published_version'], 1)
        self.client.logout()
        publicly_visible = self.client.get('/api/labs/').json()['labs']
        self.assertEqual(len(publicly_visible), 1)
        self.assertEqual(publicly_visible[0]['config']['components'],
                         ['stage', 'controls', 'metrics', 'compare'])
        self.assertNotIn('files', publicly_visible[0])
        served = self.client.get('/lab-run/lab-one/')
        self.assertEqual(served.status_code, 200)
        self.assertIn('Lab v1', served.content.decode())
        self.assertIn('sandbox allow-scripts', served['Content-Security-Policy'])
        self.assertIn("connect-src 'none'", served['Content-Security-Policy'])
        self.assertIn("form-action 'none'", served['Content-Security-Policy'])
        self.client.force_login(self.owner)
        updated_files = [
            {'name': 'index.html', 'content': '<html><head></head><body>Lab v2</body></html>'},
        ]
        update = self.client.patch(f"/api/platform/admin/labs/{draft['id']}/",
                                   data=json.dumps({'version': 1, 'files': updated_files}),
                                   content_type='application/json')
        self.assertEqual(update.status_code, 200, update.content)
        self.assertEqual(update.json()['lab']['version'], 2)
        self.assertEqual(update.json()['lab']['published_version'], 1)
        self.assertIn('Lab v1', self.client.get('/lab-run/lab-one/').content.decode())
        stale = self.client.patch(f"/api/platform/admin/labs/{draft['id']}/",
                                  data=json.dumps({'version': 1, 'title': 'Stale'}),
                                  content_type='application/json')
        self.assertEqual(stale.status_code, 409)
        restore = self.client.post(f"/api/platform/admin/labs/{draft['id']}/revisions/",
                                   data=json.dumps({'version': 2, 'restore_version': 1}),
                                   content_type='application/json')
        self.assertEqual(restore.status_code, 200, restore.content)
        self.assertEqual(restore.json()['lab']['version'], 3)
        self.assertEqual(len(self.client.get(
            f"/api/platform/admin/labs/{draft['id']}/revisions/").json()['revisions']), 3)
        unpublish = self.client.post(f"/api/platform/admin/labs/{draft['id']}/unpublish/",
                                     data='{}', content_type='application/json')
        self.assertEqual(unpublish.status_code, 200)
        self.assertEqual(self.client.get('/lab-run/lab-one/').status_code, 404)

    def test_untrusted_files_and_unapproved_topics_rejected(self):
        for bad in ['../evil.js', 'other.html', 'x.svg', 'x.exe']:
            response = self.client.post('/api/platform/admin/labs/',
                data=json.dumps({'slug': 'bad-lab', 'title': 'Bad',
                                 'files': [{'name': bad, 'content': '<script></script>'}]}),
                content_type='application/json')
            self.assertEqual(response.status_code, 400, (bad, response.content))
        response = self.client.post('/api/platform/admin/labs/',
            data=json.dumps({'slug': 'bad-topic', 'title': 'Bad',
                             'topic_slug': 'not-a-published-topic'}),
            content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get('/api/labs/no-such/coach/').status_code, 405)

    def test_reader_cannot_modify_or_preview(self):
        lab = self.create_draft()
        self.client.force_login(self.reader)
        self.assertEqual(self.client.get('/api/platform/admin/labs/').status_code, 403)
        self.assertEqual(self.client.get(f"/api/platform/admin/labs/{lab['id']}/preview/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/platform/admin/labs/{lab['id']}/publish/",
                                          data=json.dumps({'version': 1}),
                                          content_type='application/json').status_code, 403)

    @patch('core.lab_api.configured', return_value=True)
    @patch('core.lab_api.run_text')
    def test_pulsar_receives_bounded_published_event_not_source_code(self, mocked_run, configured):
        lab = self.create_draft()
        self.client.post(f"/api/platform/admin/labs/{lab['id']}/publish/",
                         data=json.dumps({'version': 1}), content_type='application/json')
        mocked_run.return_value = SimpleNamespace(text='A short scientific explanation.',
                                                   provider='cloudflare', run_id='test')
        self.client.logout()
        response = self.client.post('/api/labs/lab-one/coach/',
                data=json.dumps({'event': 'change', 'section': 'intro',
                    'metrics': {'value': 2.5, '<script>': 1, 'password': 'secret', 'huge': 1e200},
                    'locale': 'en'}),
                content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['provider'], 'cloudflare')
        args = mocked_run.call_args.kwargs
        self.assertIn('value', args['user'])
        self.assertNotIn('<script>', args['user'])
        self.assertNotIn('password', args['user'])
        self.assertNotIn('GraviLab.emit', args['user'])
        self.assertIn('client-reported', args['system'])

    @patch('core.lab_api.configured', return_value=False)
    def test_offline_coaching_is_honestly_labeled_script(self, configured):
        lab = self.create_draft()
        self.client.post(f"/api/platform/admin/labs/{lab['id']}/publish/",
                         data=json.dumps({'version': 1}), content_type='application/json')
        self.client.logout()
        response = self.client.post('/api/labs/lab-one/coach/',
                data=json.dumps({'event': 'change', 'section': 'intro', 'metrics': {'value': 3}}),
                content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['provider'], 'script')
        self.assertEqual(response.json()['reply'], 'Compare the measured value.')
