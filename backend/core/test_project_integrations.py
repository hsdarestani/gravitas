"""Research project tool selection: API, Space creation and ACL regression."""
import json

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import ResearchProject
from .platform_api import ensure_dual_workspaces
from .platform_models import ResearchProjectProfile
from .space_fs import create_node
from .space_models import SpaceNode


@override_settings(SECURE_SSL_REDIRECT=False)
class ResearchProjectIntegrationsTests(TestCase):
    def setUp(self):
        users = get_user_model()
        self.owner = users.objects.create_user(
            'integration-owner@example.com', 'integration-owner@example.com', 'test-pass-123'
        )
        self.other = users.objects.create_user(
            'integration-other@example.com', 'integration-other@example.com', 'test-pass-123'
        )
        self.client.force_login(self.owner)
        ensure_dual_workspaces(self.owner)

    def post(self, payload):
        return self.client.post(
            '/api/platform/projects/', json.dumps(payload), content_type='application/json'
        )

    def patch(self, project_id, payload):
        return self.client.patch(
            f'/api/platform/projects/{project_id}/',
            json.dumps(payload),
            content_type='application/json',
        )

    def test_catalog_lists_selectable_tools_without_claiming_connected(self):
        result = self.client.get('/api/platform/project-integrations/')
        self.assertEqual(result.status_code, 200, result.content)
        catalog = result.json()['integrations']
        self.assertIn('git', [item['id'] for item in catalog])
        self.assertIn('database', [item['id'] for item in catalog])
        self.assertIn('lab_journal', [item['id'] for item in catalog])
        self.assertTrue(all(item['connection_state'] == 'setup_required' for item in catalog))

    def test_quick_project_creation_persists_tools_and_reads_back(self):
        result = self.post({
            'title': 'Cell Research',
            'selected_integrations': ['git', 'lab_journal'],
            'requested_plugins': ['Microscopy viewer'],
        })
        self.assertEqual(result.status_code, 201, result.content)
        info = result.json()['project']
        self.assertEqual(info['selected_integrations'], ['git', 'lab_journal'])
        self.assertEqual(info['requested_plugins'], ['Microscopy viewer'])
        self.assertEqual(info['integration_connection_state'], 'setup_required')
        saved = ResearchProjectProfile.objects.get(project_id=info['id'])
        self.assertEqual(saved.selected_integrations, ['git', 'lab_journal'])
        detail = self.client.get(f'/api/platform/projects/{info["id"]}/')
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()['project']['selected_integrations'], ['git', 'lab_journal'])

    def test_space_project_creation_keeps_tools_in_canonical_metadata(self):
        from .space_project_metadata import project_markdown
        root = create_node(self.owner, 'Research', SpaceNode.Kind.SUBSPACE, sync=False)
        category = create_node(
            self.owner, 'Lab Projects', SpaceNode.Kind.CATEGORY, parent=root, sync=False
        )
        result = self.post({
            'title': 'Protein Folding',
            'space_category_id': category.pk,
            'selected_integrations': ['database', 'data_analysis'],
            'requested_plugins': ['Protein docking'],
        })
        self.assertEqual(result.status_code, 201, result.content)
        project = ResearchProject.objects.get(pk=result.json()['project']['id'])
        self.assertEqual(project.platform_profile.selected_integrations, ['database', 'data_analysis'])
        sidecar = project_markdown(project, self.owner)
        self.assertIn('selected_integrations:', sidecar)
        self.assertIn('requested_plugins:', sidecar)

    def test_invalid_or_duplicate_selection_does_not_create_project(self):
        before = ResearchProject.objects.count()
        for payload, code in [
            ({'selected_integrations': ['git', 'unknown']}, 'invalid_selected_integrations'),
            ({'selected_integrations': ['git', 'git']}, 'duplicate_selected_integrations'),
            ({'selected_integrations': 'git'}, 'invalid_selected_integrations'),
            ({'requested_plugins': [42]}, 'invalid_requested_plugins'),
        ]:
            result = self.post({'title': 'Never saved', **payload})
            self.assertEqual(result.status_code, 400, result.content)
            self.assertEqual(result.json()['error'], code)
        self.assertEqual(ResearchProject.objects.count(), before)

    def test_owner_can_update_but_other_cannot(self):
        created = self.post({'title': 'Tool ACL'})
        self.assertEqual(created.status_code, 201, created.content)
        project_id = created.json()['project']['id']
        changed = self.patch(project_id, {
            'selected_integrations': ['compute', 'machine_learning'],
            'requested_plugins': [],
        })
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(
            changed.json()['project']['selected_integrations'], ['compute', 'machine_learning']
        )
        rejected = self.patch(project_id, {'selected_integrations': ['malicious']})
        self.assertEqual(rejected.status_code, 400, rejected.content)
        self.assertEqual(
            ResearchProjectProfile.objects.get(project_id=project_id).selected_integrations,
            ['compute', 'machine_learning'],
        )
        self.client.force_login(self.other)
        forbidden = self.patch(project_id, {'selected_integrations': ['git']})
        self.assertIn(forbidden.status_code, [403, 404])
        self.assertEqual(
            ResearchProjectProfile.objects.get(project_id=project_id).selected_integrations,
            ['compute', 'machine_learning'],
        )
