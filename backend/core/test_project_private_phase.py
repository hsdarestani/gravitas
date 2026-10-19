"""Research private-provider and buffered-sync contract tests."""
import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .canonical_models import CanonicalFile
from .models import ResearchProject
from .platform_api import ensure_dual_workspaces
from .project_next_phase_models import ProjectBufferedDraft, ProjectProviderBinding


@override_settings(SECURE_SSL_REDIRECT=False)
class ProjectPrivatePhaseTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user('private-owner@example.com', 'private-owner@example.com', 'pass-123')
        self.stranger = User.objects.create_user('private-stranger@example.com', 'private-stranger@example.com', 'pass-123')
        self.client.force_login(self.owner)
        ensure_dual_workspaces(self.owner)
        created = self.json_post('/api/platform/projects/', {
            'title': 'Private Workspace',
            'selected_integrations': ['git', 'database', 'lab_journal', 'compute'],
        })
        self.assertEqual(created.status_code, 201, created.content)
        self.project_id = created.json()['project']['id']
        self.project = ResearchProject.objects.get(pk=self.project_id)
        self.root = f'/api/platform/projects/{self.project_id}/'

    def json_post(self, url, data):
        return self.client.post(url, json.dumps(data), content_type='application/json')

    def json_patch(self, url, data):
        return self.client.patch(url, json.dumps(data), content_type='application/json')

    @override_settings(
        GRAVITAS_PROJECT_GITHUB_TOKENS={'approved': 'SENTINEL_NOT_FOR_RESPONSE'},
        GRAVITAS_PROJECT_GITHUB_ALLOWED_REPOS={'approved': ['org/approved-repo']},
    )
    @patch('core.project_provider_api._private_github')
    def test_private_git_requires_repo_allowlist_and_returns_no_secret(self, fetch):
        fetch.return_value = {'private': True, 'full_name': 'org/approved-repo'}
        endpoint = self.root + 'tools/providers/private_git/'
        unapproved = self.json_post(endpoint, {'alias': 'approved', 'repository': 'org/unapproved'})
        self.assertEqual(unapproved.status_code, 403, unapproved.content)
        fetch.assert_not_called()
        response = self.json_post(endpoint, {'alias': 'approved', 'repository': 'org/approved-repo'})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['binding']['mode'], 'private_read_only')
        self.assertNotIn('SENTINEL', response.content.decode('utf-8'))
        self.assertEqual(ProjectProviderBinding.objects.count(), 1)

    @override_settings(
        GRAVITAS_PROJECT_GITHUB_TOKENS={'approved': 'SENTINEL_NOT_FOR_RESPONSE'},
        GRAVITAS_PROJECT_GITHUB_ALLOWED_REPOS={'approved': ['org/approved-repo']},
    )
    @patch('core.project_provider_api._private_github')
    def test_private_commits_enforce_allowlist_on_each_request(self, fetch):
        fetch.return_value = {'private': True, 'full_name': 'org/approved-repo'}
        self.assertEqual(self.json_post(self.root + 'tools/providers/private_git/', {
            'alias': 'approved', 'repository': 'org/approved-repo',
        }).status_code, 200)
        with override_settings(GRAVITAS_PROJECT_GITHUB_ALLOWED_REPOS={'approved': []}):
            denied = self.client.get(self.root + 'tools/private-git/commits/')
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(fetch.call_count, 1)

    @override_settings(GRAVITAS_PROJECT_DATABASE_ALIASES={'lab': 'lab_readonly'})
    @patch('core.project_provider_api._ping_database', return_value=True)
    def test_external_database_alias_verifies_without_credentials_in_request(self, ping):
        res = self.json_post(self.root + 'tools/providers/remote_db/', {'alias': 'lab'})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['binding']['mode'], 'external_connection_check_only')
        self.assertEqual(ping.call_args.args[0], 'lab')
        self.assertEqual(self.client.get(self.root + 'tools/plugins/').json()['plugins'][1]['mode'],
                         'external_connection_check_only')

    def test_unapproved_database_alias_rejected(self):
        res = self.json_post(self.root + 'tools/providers/remote_db/', {
            'alias': 'postgres://user:pass@localhost/data',
        })
        self.assertEqual(res.status_code, 422)
        self.assertFalse(ProjectProviderBinding.objects.exists())

    def test_vetted_compute_plugin_is_available_without_arbitrary_code(self):
        data = self.client.get(self.root + 'tools/plugins/').json()
        plugin = next(p for p in data['plugins'] if p['id'] == 'compute')
        self.assertEqual(plugin['state'], 'ready')
        self.assertEqual(plugin['mode'], 'bounded_builtin')

    def test_stranger_cannot_see_provider_aliases_or_drafts(self):
        self.client.force_login(self.stranger)
        for path in ['tools/providers/', 'tools/plugins/', 'drafts/']:
            self.assertIn(self.client.get(self.root + path).status_code, [403, 404])

    def _file(self):
        return CanonicalFile.objects.create(
            project=self.project, path='project.md',
            object_type='ResearchProject', object_id=self.project_id,
        )

    @patch('core.project_buffered_sync_api.active', return_value=True)
    @patch('core.project_buffered_sync_api._remote')
    def test_private_buffer_saves_without_writing_dav(self, remote, _active):
        file = self._file()
        remote.return_value = {'etag': 'E1', 'content': 'Original\n', 'file_id': 'one'}
        endpoint = self.root + f'drafts/{file.pk}/'
        opened = self.json_post(endpoint, {})
        self.assertEqual(opened.status_code, 200, opened.content)
        saved = self.json_patch(endpoint, {'revision': 1, 'content': 'Local update\n'})
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(saved.json()['draft']['revision'], 2)
        self.assertEqual(ProjectBufferedDraft.objects.get(file=file).content, 'Local update\n')
        remote.assert_called_once()
        self.assertEqual(self.client.get(endpoint).json()['draft']['base_etag'], 'E1')

    @patch('core.project_buffered_sync_api.active', return_value=True)
    @patch('core.project_buffered_sync_api._remote')
    def test_remote_conflict_preserves_draft_and_requires_manual_resolution(self, remote, _active):
        file = self._file()
        remote.side_effect = [
            {'etag': 'E1', 'content': 'Original\n', 'file_id': 'one'},
            {'etag': 'E2', 'content': 'Someone else\n', 'file_id': 'one'},
            {'etag': 'E2', 'content': 'Someone else\n', 'file_id': 'one'},
        ]
        url = self.root + f'drafts/{file.pk}/'
        self.assertEqual(self.json_post(url, {}).status_code, 200)
        self.assertEqual(self.json_patch(url, {'revision': 1, 'content': 'My change\n'}).status_code, 200)
        conflict = self.json_post(url + 'push/', {'revision': 2})
        self.assertEqual(conflict.status_code, 409, conflict.content)
        self.assertEqual(conflict.json()['conflict']['etag'], 'E2')
        self.assertEqual(ProjectBufferedDraft.objects.get(file=file).base_etag, 'E1')
        resolved = self.json_patch(url, {
            'revision': 2, 'content': 'Combined by owner\n',
            'resolve_against_etag': 'E2',
        })
        self.assertEqual(resolved.status_code, 200, resolved.content)
        self.assertEqual(resolved.json()['draft']['revision'], 3)
        self.assertEqual(ProjectBufferedDraft.objects.get(file=file).base_etag, 'E2')

    @patch('core.project_buffered_sync_api.active', return_value=True)
    @patch('core.project_buffered_sync_api._remote')
    @patch('core.project_buffered_sync_api.guarded_put')
    @patch('core.project_buffered_sync_api.cache')
    @patch('core.project_buffered_sync_api.apply')
    def test_explicit_push_clears_draft_only_after_verified_write(self, _apply, _cache, put, remote, _active):
        file = self._file()
        remote.return_value = {'etag': 'E1', 'content': 'Original\n', 'file_id': 'one'}
        url = self.root + f'drafts/{file.pk}/'
        self.json_post(url, {})
        self.json_patch(url, {'revision': 1, 'content': 'My note\n'})
        put.return_value = {'etag': 'E3', 'content': 'My note\n', 'file_id': 'one'}
        pushed = self.json_post(url + 'push/', {'revision': 2})
        self.assertEqual(pushed.status_code, 200, pushed.content)
        self.assertFalse(ProjectBufferedDraft.objects.filter(file=file, user=self.owner).exists())
        self.assertEqual(put.call_count, 1)
        self.assertEqual(pushed.json()['etag'], 'E3')
