"""Live Research integrations: authoritative ACL and persistence regression."""
import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import ProjectMembership, ResearchProject
from .platform_api import ensure_dual_workspaces
from .research_models import ExperimentJournalEntry, ProjectDataRow, ProjectDataTable, ResearchExperiment


@override_settings(SECURE_SSL_REDIRECT=False)
class OperationalProjectToolsTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user('tool-owner@example.com', 'tool-owner@example.com', 'test-pass-123')
        self.viewer = User.objects.create_user('tool-viewer@example.com', 'tool-viewer@example.com', 'test-pass-123')
        self.other = User.objects.create_user('tool-other@example.com', 'tool-other@example.com', 'test-pass-123')
        self.client.force_login(self.owner)
        ensure_dual_workspaces(self.owner)
        result = self.post('/api/platform/projects/', {
            'title': 'Private laboratory',
            'selected_integrations': ['git', 'database', 'lab_journal'],
        })
        self.assertEqual(result.status_code, 201, result.content)
        self.project_id = result.json()['project']['id']
        self.base = f'/api/platform/projects/{self.project_id}/'
        ProjectMembership.objects.create(
            project_id=self.project_id, user=self.viewer, role=ProjectMembership.Role.VIEWER
        )

    def post(self, url, payload):
        return self.client.post(url, json.dumps(payload), content_type='application/json')

    def patch_json(self, url, payload):
        return self.client.patch(url, json.dumps(payload), content_type='application/json')

    def test_tool_selection_patch_saves_only_profile_fields_and_audits_change(self):
        from .platform_models import ProjectAuditEvent, ResearchProjectProfile
        path = self.base + 'tools/selection/'
        saved = self.patch_json(path, {
            'selected_integrations': ['git', 'database'],
            'requested_plugins': ['Spectroscopy viewer'],
        })
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(saved.json()['selected_integrations'], ['git', 'database'])
        profile = ResearchProjectProfile.objects.get(project_id=self.project_id)
        self.assertEqual(profile.selected_integrations, ['git', 'database'])
        self.assertEqual(profile.requested_plugins, ['Spectroscopy viewer'])
        self.assertTrue(ProjectAuditEvent.objects.filter(
            project_id=self.project_id, action='project_tools_updated'
        ).exists())
        self.assertEqual(self.client.get(self.base + 'tools/status/').status_code, 200)

    def test_tool_selection_patch_denies_viewer_and_extra_or_invalid_fields(self):
        path = self.base + 'tools/selection/'
        bad = self.patch_json(path, {
            'selected_integrations': ['git'],
            'requested_plugins': [],
            'title': 'Attempt to change project title',
        })
        self.assertEqual(bad.status_code, 400, bad.content)
        self.assertEqual(bad.json()['error'], 'invalid_tool_selection_payload')
        invalid = self.patch_json(path, {
            'selected_integrations': ['unknown_executable'],
            'requested_plugins': [],
        })
        self.assertEqual(invalid.status_code, 400, invalid.content)
        self.client.force_login(self.viewer)
        self.assertIn(self.patch_json(path, {
            'selected_integrations': ['git'], 'requested_plugins': []
        }).status_code, [403, 404])

    def test_project_tool_status_reveals_only_saved_selection(self):
        response = self.client.get(self.base + 'tools/status/')
        self.assertEqual(response.status_code, 200, response.content)
        states = response.json()['integrations']
        self.assertEqual(states['git']['state'], 'setup_required')
        self.assertEqual(states['database']['state'], 'ready')
        self.assertEqual(states['lab_journal']['state'], 'ready')
        self.assertEqual(states['database']['table_count'], 0)

    @patch('core.project_operational_tools._github_public')
    def test_public_git_verification_and_commits(self, upstream):
        upstream.side_effect = [
            {'full_name': 'research-lab/paper', 'private': False, 'default_branch': 'main'},
            [{'sha': 'abc123', 'commit': {'message': 'Add protocol\nmore', 'author': {'name': 'Alice', 'date': '2026-10-19T12:00:00Z'}}}],
        ]
        connected = self.post(self.base + 'tools/git/', {'repository': 'https://github.com/research-lab/paper.git'})
        self.assertEqual(connected.status_code, 200, connected.content)
        self.assertEqual(connected.json()['connection']['mode'], 'public_read_only')
        self.assertEqual(connected.json()['connection']['repository'], 'research-lab/paper')
        commits = self.client.get(self.base + 'tools/git/commits/')
        self.assertEqual(commits.status_code, 200, commits.content)
        self.assertEqual(commits.json()['commits'][0]['message'], 'Add protocol')
        self.assertEqual(upstream.call_count, 2)
        self.assertEqual(self.client.get(self.base + 'tools/status/').json()['integrations']['git']['state'], 'last_verified')
        self.assertEqual(self.client.delete(self.base + 'tools/git/').status_code, 200)
        self.assertEqual(self.client.get(self.base + 'tools/git/').json()['connection'], None)

    @patch('core.project_operational_tools._github_public')
    def test_private_git_connection_is_rejected_and_does_not_store_token(self, upstream):
        upstream.return_value = {'full_name': 'research-lab/private', 'private': True, 'default_branch': 'main'}
        rejected = self.post(self.base + 'tools/git/', {'repository': 'research-lab/private', 'token': 'NEVER_STORE'})
        self.assertEqual(rejected.status_code, 422)
        self.assertEqual(rejected.json()['error'], 'public_repository_required')
        self.assertNotIn('NEVER_STORE', self.client.get(self.base + 'tools/git/').content.decode())

    @patch('core.project_operational_tools._github_public')
    def test_rejects_url_host_injection_without_outbound_request(self, upstream):
        for repo in ['http://127.0.0.1/private', 'https://evil.com/repo/x', 'owner/x?redirect=1', 'org/../secret']:
            response = self.post(self.base + 'tools/git/', {'repository': repo})
            self.assertEqual(response.status_code, 422, response.content)
            self.assertEqual(response.json()['error'], 'invalid_github_repository')
        upstream.assert_not_called()

    def test_managed_database_creates_rows_and_checks_optimistic_revision(self):
        created = self.post(self.base + 'tools/data/tables/', {
            'name': 'Observations',
            'columns': [{'key': 'sample', 'type': 'text'}, {'key': 'reading', 'type': 'number'}, {'key': 'approved', 'type': 'boolean'}],
        })
        self.assertEqual(created.status_code, 201, created.content)
        table_id = created.json()['table']['id']
        path = self.base + f'tools/data/tables/{table_id}/rows/'
        row = self.post(path, {'values': {'sample': 'Sample 01', 'reading': 12.25, 'approved': True}})
        self.assertEqual(row.status_code, 201, row.content)
        row_id = row.json()['row']['id']
        self.assertEqual(row.json()['row']['revision'], 1)
        current = self.client.get(path)
        self.assertEqual(current.json()['rows'][0]['values']['reading'], 12.25)
        saved = self.patch_json(path + f'{row_id}/', {
            'values': {'sample': 'Sample 01', 'reading': 14.0}, 'expected_revision': 1,
        })
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(saved.json()['row']['revision'], 2)
        conflict = self.patch_json(path + f'{row_id}/', {
            'values': {'reading': 15}, 'expected_revision': 1,
        })
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()['error'], 'row_conflict')
        self.assertEqual(ProjectDataRow.objects.get(pk=row_id).values['reading'], 14.0)

    def test_managed_database_validates_columns_and_types(self):
        bad = self.post(self.base + 'tools/data/tables/', {
            'name': 'Bad', 'columns': [{'key': '__proto__', 'type': 'script'}],
        })
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(ProjectDataTable.objects.count(), 0)
        table = self.post(self.base + 'tools/data/tables/', {
            'name': 'Samples', 'columns': [{'key': 'value', 'type': 'number'}],
        }).json()['table']
        url = self.base + f'tools/data/tables/{table["id"]}/rows/'
        wrong = self.post(url, {'values': {'value': 'SELECT *'}})
        self.assertEqual(wrong.status_code, 400)
        self.assertFalse(ProjectDataRow.objects.exists())

    def test_lab_journal_is_project_scoped_and_append_only(self):
        experiment = ResearchExperiment.objects.create(
            project_id=self.project_id, owner=self.owner, title='Protocol trial',
        )
        url = self.base + f'experiments/{experiment.pk}/journal/'
        entry = self.post(url, {'kind': 'observation', 'body': 'Optical density 0.42'})
        self.assertEqual(entry.status_code, 201, entry.content)
        self.assertEqual(entry.json()['entry']['body'], 'Optical density 0.42')
        self.assertEqual(self.client.get(url).json()['entries'][0]['kind'], 'observation')
        self.assertEqual(ExperimentJournalEntry.objects.count(), 1)
        prevented = self.client.delete(self.base + f'experiments/{experiment.pk}/')
        self.assertEqual(prevented.status_code, 409, prevented.content)
        self.assertEqual(prevented.json()['error'], 'experiment_has_journal_history')

    def test_viewer_reads_but_cannot_mutate_tools(self):
        table = self.post(self.base + 'tools/data/tables/', {
            'name': 'Protected', 'columns': [{'key': 'test', 'type': 'text'}],
        }).json()['table']
        experiment = ResearchExperiment.objects.create(project_id=self.project_id, owner=self.owner, title='ACL trial')
        self.client.force_login(self.viewer)
        self.assertEqual(self.client.get(self.base + 'tools/status/').status_code, 200)
        self.assertEqual(self.client.get(self.base + 'tools/data/tables/').status_code, 200)
        self.assertEqual(self.client.get(self.base + f'tools/data/tables/{table["id"]}/rows/').status_code, 200)
        self.assertEqual(self.client.get(self.base + f'experiments/{experiment.pk}/journal/').status_code, 200)
        self.assertIn(self.post(self.base + 'tools/data/tables/', {'name': 'Forbidden'}).status_code, [403, 404])
        self.assertIn(self.post(self.base + f'experiments/{experiment.pk}/journal/', {'body': 'Forbidden'}).status_code, [403, 404])
        self.assertIn(self.post(self.base + 'tools/git/', {'repository': 'org/repo'}).status_code, [403, 404])

    def test_outsider_cannot_enumerate_project_data(self):
        self.client.force_login(self.other)
        for path in [
            'tools/status/', 'tools/data/tables/', 'tools/git/', 'tools/git/commits/',
        ]:
            self.assertIn(self.client.get(self.base + path).status_code, [403, 404])
        self.assertFalse(ResearchProject.objects.get(pk=self.project_id).archived)

    def test_deselected_tool_remains_readable_but_refuses_new_writes(self):
        table = self.post(self.base + 'tools/data/tables/', {
            'name': 'Stored', 'columns': [{'key': 'sample', 'type': 'text'}],
        }).json()['table']
        change = self.patch_json(self.base, {'selected_integrations': ['lab_journal']})
        self.assertEqual(change.status_code, 200, change.content)
        self.assertEqual(self.client.get(self.base + 'tools/data/tables/').status_code, 200)
        write = self.post(self.base + f'tools/data/tables/{table["id"]}/rows/', {'values': {'sample': 'A'}})
        self.assertEqual(write.status_code, 409)
        self.assertEqual(write.json()['error'], 'tool_not_selected')
