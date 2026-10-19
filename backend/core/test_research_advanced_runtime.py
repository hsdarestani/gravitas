"""Research advanced tools: safety boundaries and API regression tests."""
import json
from unittest.mock import patch, MagicMock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .canonical_models import CanonicalFile, CanonicalProject
from .models import ProjectMembership, ResearchProject
from .platform_api import ensure_dual_workspaces
from .project_next_phase_models import ProjectBufferedDraft, ProjectProviderBinding
from .research_models import ProjectDataRow, ProjectDataTable


@override_settings(SECURE_SSL_REDIRECT=False)
class ResearchAdvancedTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            'advanced-owner@example.com', 'advanced-owner@example.com', 'test-pass-123'
        )
        self.viewer = User.objects.create_user(
            'advanced-viewer@example.com', 'advanced-viewer@example.com', 'test-pass-123'
        )
        self.outsider = User.objects.create_user(
            'advanced-outsider@example.com', 'advanced-outsider@example.com', 'test-pass-123'
        )
        self.client.force_login(self.owner)
        ensure_dual_workspaces(self.owner)
        created = self.post('/api/platform/projects/', {
            'title': 'Advanced workspace',
            'selected_integrations': ['git', 'database', 'lab_journal',
                                      'data_analysis', 'compute', 'machine_learning'],
        })
        self.assertEqual(created.status_code, 201, created.content)
        self.project_id = created.json()['project']['id']
        self.project = ResearchProject.objects.get(pk=self.project_id)
        self.root = f'/api/platform/projects/{self.project_id}/'
        ProjectMembership.objects.create(
            project=self.project, user=self.viewer, role=ProjectMembership.Role.VIEWER
        )
        self.table = ProjectDataTable.objects.create(
            project=self.project, name='Samples',
            columns=[{'key': 'x', 'type': 'number'}, {'key': 'y', 'type': 'number'}],
            created_by=self.owner,
        )
        for idx in range(1, 5):
            ProjectDataRow.objects.create(
                table=self.table, created_by=self.owner,
                values={'x': idx, 'y': 3 * idx + 2},
            )

    def post(self, path, data):
        return self.client.post(path, json.dumps(data), content_type='application/json')

    def test_builtin_catalog_and_descriptive_statistics(self):
        catalog = self.client.get(self.root + 'tools/builtin/')
        self.assertEqual(catalog.status_code, 200)
        plugins = catalog.json()['plugins']
        self.assertEqual(len(plugins), 3)
        self.assertTrue(all(x['selected'] and x['state'] == 'ready' for x in plugins))
        response = self.post(self.root + 'tools/builtin/data_analysis/run/', {
            'table_id': self.table.pk, 'column': 'y',
        })
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['result']['count'], 4)
        self.assertAlmostEqual(response.json()['result']['mean'], 9.5)

    def test_compute_and_linear_fit_are_bounded_and_read_only(self):
        base = self.root + 'tools/builtin/'
        compute = self.post(base + 'compute/run/', {
            'table_id': self.table.pk, 'column': 'x', 'factor': 2,
        })
        self.assertEqual(compute.status_code, 200, compute.content)
        self.assertEqual(compute.json()['result']['result'][0]['value'], 2)
        fit = self.post(base + 'machine_learning/run/', {
            'table_id': self.table.pk, 'feature': 'x', 'target': 'y',
        })
        self.assertEqual(fit.status_code, 200, fit.content)
        self.assertAlmostEqual(fit.json()['result']['slope'], 3.0)
        self.assertAlmostEqual(fit.json()['result']['intercept'], 2.0)
        self.assertAlmostEqual(fit.json()['result']['r_squared'], 1.0)
        self.assertEqual(self.table.rows.count(), 4)

    def test_plugins_reject_arbitrary_code_and_project_cross_access(self):
        url = self.root + 'tools/builtin/data_analysis/run/'
        for data in [
            {'table_id': self.table.pk, 'column': 'x', 'exec': 'rm -rf'},
            {'table_id': self.table.pk, 'column': 'does_not_exist'},
            {'table_id': '1; DROP TABLE', 'column': 'x'},
        ]:
            res = self.post(url, data)
            self.assertEqual(res.status_code, 400, res.content)
        self.client.force_login(self.outsider)
        self.assertIn(self.post(url, {'table_id': self.table.pk, 'column': 'x'}).status_code, [403, 404])
        self.client.force_login(self.viewer)
        self.assertEqual(self.post(url, {'table_id': self.table.pk, 'column': 'x'}).status_code, 200)

    @override_settings(
        GRAVITAS_PROJECT_DATABASE_ALIASES={'lab': 'research_lab'},
        GRAVITAS_PROJECT_DATABASE_DATASETS={'lab': [{
            'id': 'approved_samples', 'name': 'Laboratory view',
            'schema': 'analytics', 'table': 'samples',
            'columns': ['result', 'sample_id'],
        }, {
            'id': 'evil', 'schema': 'public;delete', 'table': 'samples',
            'columns': ['secret'],
        }]},
    )
    @patch('core.project_external_datasets.connections')
    @patch('core.project_external_datasets.transaction.atomic')
    def test_external_data_is_exactly_whitelisted_and_read_only(self, atomic, connections):
        ProjectProviderBinding.objects.create(
            project=self.project, kind='remote_db', credential_alias='lab',
            configured_by=self.owner,
        )
        connections.databases = {'default': {}, 'research_lab': {}}
        connections['research_lab'].vendor = 'postgresql'
        cursor = connections['research_lab'].cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [(12.5, 'A')]
        listing = self.client.get(self.root + 'tools/external/datasets/')
        self.assertEqual(listing.status_code, 200, listing.content)
        self.assertEqual([x['id'] for x in listing.json()['datasets']], ['approved_samples'])
        wrong = self.client.get(self.root + 'tools/external/datasets/evil/rows/')
        self.assertEqual(wrong.status_code, 404)
        result = self.client.get(self.root + 'tools/external/datasets/approved_samples/rows/?limit=5')
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(result.json()['rows'][0]['result'], 12.5)
        self.assertEqual(cursor.execute.call_args_list[-1].args[0],
                         'SELECT "result", "sample_id" FROM "analytics"."samples" LIMIT %s')
        self.assertEqual(cursor.execute.call_args_list[-1].args[1], [5])
        self.assertEqual(result.json()['query_policy'], 'fixed_fields_read_only') if 'query_policy' in result.json() else None

    @override_settings(GRAVITAS_PROJECT_DATABASE_ALIASES={'lab': 'research_lab'})
    def test_external_read_fails_closed_without_approved_dataset(self):
        ProjectProviderBinding.objects.create(project=self.project, kind='remote_db',
                                             credential_alias='lab', configured_by=self.owner)
        self.assertEqual(self.client.get(self.root + 'tools/external/datasets/').status_code, 200)
        self.assertEqual(self.client.get(self.root + 'tools/external/datasets/secret/rows/').status_code, 404)
        self.client.force_login(self.outsider)
        self.assertIn(self.client.get(self.root + 'tools/external/datasets/').status_code, [403, 404])

    def _draft(self):
        CanonicalProject.objects.create(project=self.project, enabled=True)
        file = CanonicalFile.objects.create(
            project=self.project, path='project.md',
            object_type='ResearchProject', object_id=self.project_id,
        )
        return ProjectBufferedDraft.objects.create(
            file=file, user=self.owner, base_content='Old\n',
            content='My research\n', base_etag='rev-a', revision=2,
        )

    @patch('core.project_private_pulsar_merge._remote')
    @patch('core.project_private_pulsar_merge._local_merge_request')
    @override_settings(
        GRAVITAS_PRIVATE_PULSAR_MERGE_ENABLED=True,
        GRAVITAS_PRIVATE_PULSAR_MODEL='llama3.1:8b',
        GRAVITAS_PRIVATE_PULSAR_PORT=11434,
    )
    def test_private_pulsar_needs_consent_and_never_writes(self, model, remote):
        draft = self._draft()
        url = self.root + f'drafts/{draft.file_id}/private-merge/'
        remote.return_value = {'content': 'Other scientist\n', 'etag': 'rev-b'}
        model.return_value = 'Combined for review\n'
        self.assertTrue(self.client.get(url).json()['available'])
        denied = self.post(url, {'consent': False, 'revision': 2})
        self.assertEqual(denied.status_code, 403)
        model.assert_not_called()
        answer = self.post(url, {'consent': True, 'revision': 2})
        self.assertEqual(answer.status_code, 200, answer.content)
        self.assertEqual(answer.json()['suggestion'], 'Combined for review\n')
        self.assertFalse(answer.json()['pushed'])
        self.assertFalse(answer.json()['saved'])
        draft.refresh_from_db()
        self.assertEqual(draft.content, 'My research\n')

    def test_private_model_disabled_by_default(self):
        draft = self._draft()
        url = self.root + f'drafts/{draft.file_id}/private-merge/'
        self.assertFalse(self.client.get(url).json()['available'])
        self.assertEqual(self.post(url, {'consent': True, 'revision': 2}).status_code, 503)
