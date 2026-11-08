from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings

from .cloud import CloudError
from .topic_essay_sources import SOURCE_PATHS
from .models import ProjectMembership, PublicPageSnapshot, ResearchProject, TopicEssayPublication, Workspace


TOPIC_URL = '/topic-answer-that-looked-right.html'
PUBLIC_URL = '/api/topics/answer-that-looked-right/essays/'
PROJECT_ID = 813
EDITOR_URL = f'/api/platform/projects/{PROJECT_ID}/topic-essays/'
SOURCE_PATH = '05_Deliverables/essay-overview.md'


@override_settings(TOPIC_01_RESEARCH_PROJECT_ID=PROJECT_ID)
class TopicEssayPublicationTests(TestCase):
    def setUp(self):
        users = get_user_model()
        self.owner = users.objects.create_user('topic-essay-owner')
        self.editor = users.objects.create_user('topic-essay-editor')
        workspace = Workspace.objects.create(name='Topic essay tests', owner=self.owner)
        self.project = ResearchProject.objects.create(
            pk=PROJECT_ID, workspace=workspace, owner=self.owner, title='Topic 01',
        )
        ProjectMembership.objects.create(project=self.project, user=self.editor, role='editor')

    def publish(self, etag='"v1"', version='', **kwargs):
        return self.client.post(EDITOR_URL, {
            'path': SOURCE_PATH, 'depth': 'overview', 'etag': etag, 'version': version, **kwargs,
        }, content_type='application/json')

    @patch('core.topic_essay_api.cloud._auth', return_value=('editor', 'unused'))
    @patch('core.topic_essay_api.nextcloud_bridge.ensure_user', return_value=SimpleNamespace(username='editor'))
    @patch('core.topic_essay_api.cloud._request')
    def test_explicit_publication_reuses_the_reviewed_remote_revision(self, dav, identity, _auth):
        remote = MagicMock(status_code=200)
        remote.__enter__.return_value = remote
        remote.headers = {'ETag': '"v1"'}
        remote.iter_content.return_value = iter([
            b'# Sajjad essay\n\nPublished overview. <script>alert(1)</script>\n\n[unsafe](javascript:alert(1))',
        ])
        dav.return_value = remote

        self.client.force_login(self.owner)
        result = self.publish()
        self.assertEqual(result.status_code, 200, result.content)
        version = result.json()['slots']['overview']['version']
        self.assertEqual(dav.call_args.kwargs['headers'], {'If-Match': '"v1"'})
        self.assertIn('/GRV-000813/05_Deliverables/essay-overview.md', dav.call_args.args[1])
        identity.assert_called_once_with(self.owner)

        self.client.logout()
        public = self.client.get(PUBLIC_URL)
        self.assertEqual(public.status_code, 200)
        self.assertIn('no-store', public['Cache-Control'])
        self.assertNotIn(SOURCE_PATH, public.content.decode())
        essay = public.json()['essays']['overview']
        self.assertEqual(essay['title'], 'Sajjad essay')
        self.assertIn('Published overview.', essay['html'])
        self.assertNotIn('<script>', essay['html'])
        self.assertNotIn('href="javascript:', essay['html'])

        self.client.force_login(self.editor)
        self.assertEqual(self.publish(path='another.md', version=version).status_code, 403)
        remote.headers = {'ETag': '"v2"'}
        self.assertEqual(self.publish(version=version).status_code, 409)
        self.assertEqual(TopicEssayPublication.objects.get().source_etag, '"v1"')

        remote.iter_content.return_value = iter([b'# Updated essay\n\nNew revision from Nextcloud.'])
        updated = self.publish(etag='"v2"', version=version)
        self.assertEqual(updated.status_code, 200, updated.content)
        self.assertIn('New revision', self.client.get(PUBLIC_URL).json()['essays']['overview']['html'])
        self.assertEqual(TopicEssayPublication.objects.get().published_by, self.editor)

        remote.headers = {'ETag': '"v3"'}
        remote.iter_content.return_value = iter([b'Attempt to publish from an outdated tab.'])
        self.assertEqual(self.publish(etag='"v3"', version=version).status_code, 409)
        self.assertEqual(TopicEssayPublication.objects.get().source_etag, '"v2"')

    def test_anonymous_and_viewer_cannot_publish(self):
        self.assertEqual(self.publish().status_code, 403)
        viewer = get_user_model().objects.create_user('topic-essay-viewer')
        ProjectMembership.objects.create(project=self.project, user=viewer, role='viewer')
        self.client.force_login(viewer)
        self.assertEqual(self.publish().status_code, 403)
        self.assertEqual(self.client.get(PUBLIC_URL).json()['essays'], {})

    @patch('core.topic_essay_api.cloud.admin_download')
    def test_initial_import_is_atomic_and_idempotent(self, download):
        remote = MagicMock()
        remote.__enter__.return_value = remote
        remote.headers = {'ETag': '"edition-1"'}
        remote.iter_content.return_value = [b'A full essay with its own title.']
        download.side_effect = [remote, CloudError('unavailable')]
        with self.assertRaises(CommandError):
            call_command('publish_topic_01_essays')
        self.assertFalse(TopicEssayPublication.objects.exists())

        download.side_effect = None
        download.return_value = remote
        call_command('publish_topic_01_essays')
        essays = self.client.get(PUBLIC_URL).json()['essays']
        self.assertEqual(essays['overview']['label'], 'Essay 1')
        self.assertEqual(essays['deep']['label'], 'Essay 2')
        self.assertNotEqual(essays['overview']['title'], essays['deep']['title'])
        self.assertCountEqual(TopicEssayPublication.objects.values_list('source_path', flat=True), SOURCE_PATHS.values())

        download.reset_mock()
        call_command('publish_topic_01_essays')
        download.assert_not_called()

    @patch('core.topic_essay_api.cloud._auth', return_value=('editor', 'unused'))
    @patch('core.topic_essay_api.nextcloud_bridge.ensure_user', return_value=SimpleNamespace(username='editor'))
    @patch('core.topic_essay_api.cloud._request')
    def test_managed_folder_opens_only_the_two_selected_ordinary_files(self, dav, identity, _auth):
        self.client.force_login(self.editor)
        endpoint = f'/api/platform/projects/{PROJECT_ID}/file-content/'
        path = SOURCE_PATHS['deep']
        dav.return_value = SimpleNamespace(status_code=200, content=b'# Essay', headers={'ETag': '"nextcloud-v1"'})
        opened = self.client.get(endpoint, {'path': path, 'edit': '1'})
        self.assertEqual(opened.status_code, 200, opened.content)
        self.assertEqual(opened.json()['etag'], '"nextcloud-v1"')
        self.assertEqual(opened.json()['content'], '# Essay')
        self.assertEqual(self.client.get(endpoint, {'path': path.rsplit('/', 1)[0] + '/other.md', 'edit': '1'}).status_code, 400)
        self.assertEqual(list(self.client.get(EDITOR_URL, {'path': path}).json()['slots']), ['deep'])

    @patch('core.pulsar_api.run_text', return_value=SimpleNamespace(text='Grounded answer', provider='test', run_id='one'))
    @patch('core.pulsar_api.configured', return_value=True)
    @patch('core.topic_essay_api._source_markdown', return_value='# Updated by Sajjad\n\nPublished material from Nextcloud.')
    def test_pulsar_uses_current_site_sections_and_published_essay(self, _source, _configured, model):
        root = Path(__file__).resolve().parents[2]
        call_command('sync_public_pages', source=root, verbosity=0)
        page = PublicPageSnapshot.objects.get(path=TOPIC_URL).content
        self.assertIn('video', {section['id'] for section in page['sections']})
        self.assertNotIn('/workspace.html', PublicPageSnapshot.objects.values_list('path', flat=True))
        self.client.force_login(self.owner)
        self.assertEqual(self.publish().status_code, 200)
        self.client.logout()
        result = self.client.post('/api/pulsar/ask/', {
            'page': TOPIC_URL, 'section': 'essay', 'message': 'What does this essay say?',
            'topic_catalog': [{'title': 'Obsolete Topic', 'status': 'open', 'href': 'topic-obsolete.html'}],
        }, content_type='application/json')
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(result.json()['links'][0]['href'], TOPIC_URL + '#essay')
        prompt = model.call_args.kwargs['user']
        self.assertIn('Published material from Nextcloud.', prompt)
        self.assertIn('Synchronized public page copy', prompt)
        self.assertIn('Can you trust an answer that looks right?', prompt)
        self.assertNotIn('Obsolete Topic', prompt)
        self.assertNotIn('The dangerous answer from an AI assistant', prompt)
        self.assertNotIn(SOURCE_PATH, prompt)
