from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command
from django.apps import apps
from django.db import connection, connections
from django.test import Client, TestCase, TransactionTestCase, override_settings, skipUnlessDBFeature
from django.utils import timezone

from .cloud import CloudError
from .topic_essay_sources import SOURCE_PATHS
from .models import ProjectMembership, PublicPageSnapshot, ResearchProject, TopicEssayPublication, TopicEssayVersion, Workspace


TOPIC_URL = '/topic-answer-that-looked-right'
PUBLIC_URL = '/api/topics/answer-that-looked-right/essays/'
PROJECT_ID = 813
EDITOR_URL = f'/api/platform/projects/{PROJECT_ID}/topic-essays/'
SOURCE_PATH = '05_Deliverables/essay-overview.md'
HISTORY_URL = f'{EDITOR_URL}overview/versions/'


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
        self.assertCountEqual(TopicEssayPublication.objects.values_list('source_path', flat=True), [SOURCE_PATHS['overview'], SOURCE_PATHS['deep']])
        self.assertCountEqual(TopicEssayVersion.objects.values_list('publication__depth', 'number'), [('overview', 1), ('deep', 1)])

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

    def test_migration_preserves_existing_markdown_and_publication_metadata(self):
        published_at = timezone.now()
        TopicEssayPublication.objects.create(
            depth='overview', project=self.project, source_path=SOURCE_PATH, source_etag='"seed"',
            markdown='# Existing essay\n\nArchived text\n', published_at=published_at, published_by=self.editor,
        )
        before = self.client.get(PUBLIC_URL).json()
        migration = import_module('core.migrations.0113_topic_essay_versions')
        migration.seed_versions(apps, SimpleNamespace(connection=connection))
        first = TopicEssayVersion.objects.get()
        self.assertEqual(
            (first.number, first.markdown, first.published_at, first.published_by, first.publisher_name,
             first.project, first.source_path, first.source_etag),
            (1, '# Existing essay\n\nArchived text\n', published_at, self.editor, self.editor.username,
             self.project, SOURCE_PATH, '"seed"'),
        )
        self.assertEqual(self.client.get(PUBLIC_URL).json(), before)

    @patch('core.topic_essay_api._source_markdown')
    def test_versions_compare_restore_and_deduplicate_per_slot(self, source):
        original = '# Essay\n\nOriginal argument\n\nStart\n\nKeep A\nKeep B\nKeep C\n\nEnd\n\nRemoved appendix\n'
        revised = original.replace('Original argument', 'Revised argument').replace('Removed appendix\n', '')
        revised = revised.replace('Keep A', 'New paragraph\nKeep A')
        self.client.force_login(self.owner)
        source.return_value = original
        first = self.publish(change_note='First edition').json()['slots']['overview']['version']
        source.return_value = revised
        response = self.publish(etag='"v2"', version=first, change_note='New argument')
        second = response.json()['slots']['overview']['version']
        self.assertTrue(response.json()['created_version'])

        same = self.publish(etag='"v3"', version=second, change_note='Ignore this duplicate')
        self.assertFalse(same.json()['created_version'])
        self.assertEqual(same.json()['slots']['overview']['version'], second)
        self.assertEqual(TopicEssayPublication.objects.get(depth='overview').source_etag, '"v3"')
        for depth in ('e1-curious', 'e1-undergrad', 'deep', 'e2-curious', 'e2-undergrad'):
            result = self.publish(path=SOURCE_PATHS[depth], depth=depth)
            self.assertEqual(result.status_code, 200, result.content)
            url = f'{EDITOR_URL}{depth}/versions/'
            self.assertEqual([v['number'] for v in self.client.get(url).json()['versions']], [1])
            self.assertEqual(self.client.get(url, {'number': 2}).status_code, 404)

        self.client.force_login(self.editor)
        history = self.client.get(HISTORY_URL)
        self.assertIn('no-store', history['Cache-Control'])
        self.assertEqual(history.json()['current'], 2)
        self.assertEqual([(v['number'], v['change_note'], v['publisher'], v['source_path'])
                          for v in history.json()['versions']],
                         [(2, 'New argument', self.owner.username, SOURCE_PATH),
                          (1, 'First edition', self.owner.username, SOURCE_PATH)])
        self.assertEqual(self.client.get(HISTORY_URL, {'number': 1}).json()['markdown'], original)
        groups = self.client.get(HISTORY_URL, {'from': 1, 'to': 2}).json()['groups']
        changes = [change for group in groups for change in group['changes']]
        self.assertEqual({change['type'] for change in changes}, {'equal', 'insert', 'delete', 'replace'})
        self.assertTrue(any(change['type'] == 'replace' and change['old'] == 'Original argument\n'
                            and change['new'] == 'Revised argument\n' for change in changes))

        restore = {'number': 1, 'version': second, 'change_note': 'Restore the first edition'}
        self.assertEqual(self.client.post(HISTORY_URL, restore, content_type='application/json').status_code, 400)
        restore['confirm'] = True
        source.reset_mock()
        response = self.client.post(HISTORY_URL, restore, content_type='application/json')
        self.assertEqual(response.json(), {'ok': True, 'number': 3})
        source.assert_not_called()
        self.assertEqual(self.client.post(HISTORY_URL, restore, content_type='application/json').status_code, 409)
        self.assertEqual(list(TopicEssayVersion.objects.filter(publication__depth='overview')
                              .values_list('number', 'markdown', 'restored_from')),
                         [(3, original, 1), (2, revised, None), (1, original, None)])
        restored = self.client.get(HISTORY_URL).json()['versions'][0]
        self.assertEqual((restored['publisher'], restored['change_note']), (self.editor.username, restore['change_note']))
        self.assertIn('Original argument', self.client.get(PUBLIC_URL).json()['essays']['overview']['html'])
        self.assertEqual(self.client.get(HISTORY_URL, {'from': 1, 'to': 3}).json()['groups'], [])

    @patch('core.topic_essay_api._source_markdown', return_value='Published essay Markdown')
    def test_restore_requires_edit_access_and_rebinding_requires_manage_access(self, source):
        self.client.force_login(self.owner)
        token = self.publish().json()['slots']['overview']['version']
        identical = self.publish(path='replacement.md', version=token)
        self.assertEqual(identical.status_code, 200, identical.content)
        self.assertFalse(identical.json()['created_version'])
        self.assertEqual(TopicEssayVersion.objects.get().source_path, SOURCE_PATH)
        token = identical.json()['slots']['overview']['version']
        source.return_value = 'Different Markdown'
        token = self.publish(path='replacement.md', version=token).json()['slots']['overview']['version']

        data = {'number': 1, 'version': token, 'confirm': True}
        viewer = get_user_model().objects.create_user('essay-history-viewer')
        ProjectMembership.objects.create(project=self.project, user=viewer, role='viewer')
        for user in (None, viewer):
            self.client.logout()
            if user:
                self.client.force_login(user)
            self.assertEqual(self.client.get(HISTORY_URL).status_code, 403)
            self.assertEqual(self.client.get(HISTORY_URL, {'number': 1}).status_code, 403)
            self.assertEqual(self.client.get(HISTORY_URL, {'from': 1, 'to': 2}).status_code, 403)
            self.assertEqual(self.client.post(HISTORY_URL, data, content_type='application/json').status_code, 403)

        self.client.force_login(self.editor)
        history = self.client.get(HISTORY_URL).json()['versions']
        self.assertFalse(history[-1]['can_restore'])
        self.assertEqual(self.client.post(HISTORY_URL, data, content_type='application/json').json()['error'],
                         'essay_binding_requires_project_manager')

        self.client.force_login(self.owner)
        self.assertEqual(self.publish(path=SOURCE_PATH, depth='e1-curious').status_code, 200)
        self.assertEqual(self.client.post(HISTORY_URL, data, content_type='application/json').json()['error'],
                         'essay_file_already_linked')
        self.assertEqual(self.client.post(HISTORY_URL, {**data, 'number': 2}, content_type='application/json').json()['error'],
                         'essay_version_is_current')

    @patch('core.topic_essay_api._source_markdown')
    def test_snapshot_failure_rolls_back_publication_and_restore(self, source):
        self.client.force_login(self.owner)
        source.return_value = '# Original'
        first = self.publish().json()['slots']['overview']['version']
        source.return_value = '# Revised'
        with patch('core.topic_essay_versions.TopicEssayVersion.objects.create', side_effect=RuntimeError('snapshot failure')):
            with self.assertRaisesMessage(RuntimeError, 'snapshot failure'):
                self.publish(etag='"v2"', version=first)
        self.assertEqual(TopicEssayPublication.objects.get().markdown, '# Original')

        second = self.publish(etag='"v2"', version=first).json()['slots']['overview']['version']
        with patch('core.topic_essay_versions.TopicEssayVersion.objects.create', side_effect=RuntimeError('snapshot failure')):
            with self.assertRaisesMessage(RuntimeError, 'snapshot failure'):
                self.client.post(HISTORY_URL, {'number': 1, 'version': second, 'confirm': True},
                                 content_type='application/json')
        self.assertEqual(TopicEssayPublication.objects.get().markdown, '# Revised')
        self.assertEqual(TopicEssayVersion.objects.count(), 2)

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
        self.assertIn('Is AI reliable in research?', prompt)
        self.assertNotIn('Obsolete Topic', prompt)
        self.assertNotIn('The dangerous answer from an AI assistant', prompt)
        self.assertNotIn(SOURCE_PATH, prompt)


@override_settings(TOPIC_01_RESEARCH_PROJECT_ID=PROJECT_ID)
class TopicEssayConcurrencyTests(TransactionTestCase):
    @skipUnlessDBFeature('has_select_for_update')
    def test_parallel_identical_first_publications_create_one_snapshot(self):
        owner = get_user_model().objects.create_user('essay-versions-lock-owner')
        workspace = Workspace.objects.create(name='Essay concurrency', owner=owner)
        ResearchProject.objects.create(pk=PROJECT_ID, workspace=workspace, owner=owner, title='Topic 01')
        clients = [Client(), Client()]
        for client in clients:
            client.force_login(owner)
        reached_source = Barrier(2, timeout=10)

        def fetch_source(*args):
            reached_source.wait()
            return '# Identical Markdown'

        def publish(client):
            try:
                result = client.post(EDITOR_URL, {'path': SOURCE_PATH, 'depth': 'overview', 'etag': '"v1"', 'version': ''},
                                     content_type='application/json')
                return (result.status_code, result.json().get('created_version'))
            finally:
                connections.close_all()

        with patch('core.topic_essay_api._source_markdown', side_effect=fetch_source):
            with ThreadPoolExecutor(max_workers=2) as pool:
                self.assertCountEqual(list(pool.map(publish, clients)), [(200, True), (200, False)])
        self.assertEqual(TopicEssayVersion.objects.get().number, 1)
