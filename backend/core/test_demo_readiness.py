import json
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from .models import Collection, WorkspaceMembership
from .operating_models import OperatingTask
from .platform_models import ProjectApplication


@override_settings(
    GRAVITAS_DEFAULT_QUOTA_BYTES=1024 * 1024 * 100,
    GRAVITAS_MAX_UPLOAD_BYTES=1024 * 1024 * 10,
    SECURE_SSL_REDIRECT=False,
    PUBLIC_BASE_URL='https://gravitas.test',
)
class DemoReadinessTests(TestCase):
    """End-to-end smoke journeys for every user-facing Core and Research area."""

    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='demo-admin@example.com',
            email='demo-admin@example.com',
            first_name='Demo Admin',
            password='Demo-Admin-Pass-4827!',
        )
        self.member = User.objects.create_user(
            username='demo-member@example.com',
            email='demo-member@example.com',
            first_name='Demo Member',
            password='Demo-Member-Pass-5938!',
        )
        self.researcher = User.objects.create_user(
            username='demo-researcher@example.com',
            email='demo-researcher@example.com',
            first_name='Demo Researcher',
            password='Demo-Researcher-Pass-7194!',
        )
        self.outsider = User.objects.create_user(
            username='demo-outsider@example.com',
            email='demo-outsider@example.com',
            first_name='Demo Outsider',
            password='Demo-Outsider-Pass-8642!',
        )
        self.client.force_login(self.admin)
        boot_response = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(boot_response.status_code, 200, boot_response.content)
        self.boot = boot_response.json()
        self.core_id = self.boot['workspaces']['core']['id']
        self.research_id = self.boot['workspaces']['research']['id']
        self.assertTrue(self.boot['access']['core'])
        self.assertEqual(self.boot['access']['core_role'], 'admin')

    def post_json(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json')

    def patch_json(self, path, payload):
        return self.client.patch(path, data=json.dumps(payload), content_type='application/json')

    def assert_ok(self, path):
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200, f'{path}: {response.content!r}')
        self.assertTrue(response.json().get('ok'), f'{path}: {response.content!r}')
        return response.json()

    def add_core_member(self):
        response = self.post_json('/api/platform/team/', {
            'name': self.member.first_name,
            'email': self.member.email,
            'role': 'member',
            'send_setup': False,
        })
        self.assertIn(response.status_code, {200, 201}, response.content)
        self.assertTrue(WorkspaceMembership.objects.filter(
            workspace_id=self.core_id,
            user=self.member,
        ).exists())

    def operating_seed(self, process_key='research'):
        dashboard = self.assert_ok('/api/operating/dashboard/')
        process = next(item for item in dashboard['processes'] if item['key'] == process_key)
        objective_response = self.post_json('/api/operating/objectives/', {
            'title': 'Demo objective',
            'description': 'A measurable objective used by the demo-readiness journey.',
            'quarter': 'Demo quarter',
            'owner_id': self.admin.pk,
        })
        self.assertEqual(objective_response.status_code, 201, objective_response.content)
        objective = objective_response.json()['objective']
        kr_response = self.post_json('/api/operating/key-results/', {
            'objective_id': objective['id'],
            'title': 'Demo measurable key result',
            'owner_id': self.admin.pk,
            'metric_name': 'Demo completion',
            'baseline_value': 0,
            'target_value': 100,
            'current_value': 20,
            'unit': '%',
            'due_date': (date.today() + timedelta(days=30)).isoformat(),
        })
        self.assertEqual(kr_response.status_code, 201, kr_response.content)
        return process, objective, kr_response.json()['key_result']

    def test_every_workspace_feature_endpoint_loads_for_demo_admin(self):
        endpoints = [
            # Core workspace
            '/api/platform/bootstrap/',
            '/api/platform/dashboard/?workspace=core',
            '/api/platform/team/',
            '/api/platform/content/',
            '/api/operating/dashboard/',
            '/api/operating/initiative-planner/',
            '/api/operating/processes/',
            '/api/operating/objectives/',
            '/api/operating/key-results/',
            '/api/operating/initiatives/',
            '/api/operating/cycles/',
            '/api/operating/milestones/',
            '/api/operating/work-packages/',
            '/api/operating/tasks/',
            '/api/operating/risks/',
            '/api/operating/meetings/',
            # Research workspace
            '/api/platform/dashboard/?workspace=research',
            '/api/platform/projects/',
            '/api/platform/resources/?workspace=research&kind=note',
            '/api/platform/resources/?workspace=research&kind=dataset',
            '/api/platform/mindmaps/',
            '/api/platform/researchers/',
            '/api/platform/researchers/me/',
            '/api/platform/community/projects/',
            '/api/platform/shared-with-me/',
            '/api/platform/research-requests/',
        ]
        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint):
                self.assert_ok(endpoint)

    def test_core_demo_flow_content_okr_initiative_tasks_assignment_and_reorder(self):
        self.add_core_member()

        content_response = self.post_json('/api/platform/content/', {
            'title': 'Demo science video',
            'kind': 'video',
            'description': 'A demo content item that needs a scientific evidence brief.',
            'due_date': (date.today() + timedelta(days=21)).isoformat(),
        })
        self.assertEqual(content_response.status_code, 201, content_response.content)
        content_id = content_response.json()['item']['id']
        handoff_response = self.post_json(f'/api/platform/content/{content_id}/', {
            'action': 'request_research',
            'research_question': 'What evidence should support the demo claim?',
            'brief': 'Find reliable evidence and summarize it for production.',
            'priority': 'p1',
        })
        self.assertEqual(handoff_response.status_code, 201, handoff_response.content)
        self.assertTrue(handoff_response.json()['project']['id'])
        self.assertTrue(handoff_response.json()['research_request']['id'])

        process, objective, kr = self.operating_seed('content')
        initiative_response = self.post_json('/api/operating/initiatives/', {
            'key_result_id': kr['id'],
            'process_id': process['id'],
            'title': 'Demo content execution initiative',
            'description': 'Turns the demo KR into assigned execution.',
            'owner_id': self.admin.pk,
            'priority': 'p1',
            'due_date': (date.today() + timedelta(days=30)).isoformat(),
        })
        self.assertEqual(initiative_response.status_code, 201, initiative_response.content)
        initiative = initiative_response.json()['initiative']

        task_payloads = [
            (self.admin.pk, 'Prepare demo brief', 'Brief is approved and attached.'),
            (self.member.pk, 'Produce demo asset', 'Asset is reviewed and ready to publish.'),
        ]
        tasks = []
        for index, (owner_id, title, done) in enumerate(task_payloads):
            task_response = self.post_json('/api/operating/tasks/', {
                'initiative_id': initiative['id'],
                'owner_id': owner_id,
                'title': title,
                'definition_of_done': done,
                'priority': 'p1' if index == 0 else 'p2',
                'due_date': (date.today() + timedelta(days=7 + index)).isoformat(),
            })
            self.assertEqual(task_response.status_code, 201, task_response.content)
            tasks.append(task_response.json()['task'])

        reorder_response = self.post_json('/api/operating/tasks/reorder/', {
            'initiative_id': initiative['id'],
            'task_ids': [tasks[1]['id'], tasks[0]['id']],
        })
        self.assertEqual(reorder_response.status_code, 200, reorder_response.content)
        second = OperatingTask.objects.get(pk=tasks[1]['id'])
        first = OperatingTask.objects.get(pk=tasks[0]['id'])
        self.assertIsNone(second.dependency_id)
        self.assertEqual(first.dependency_id, second.pk)

        update_response = self.patch_json(f"/api/operating/tasks/{tasks[0]['id']}/", {
            'owner_id': self.member.pk,
            'status': 'active',
            'due_date': (date.today() + timedelta(days=10)).isoformat(),
        })
        self.assertEqual(update_response.status_code, 200, update_response.content)
        self.assertEqual(update_response.json()['task']['owner']['id'], self.member.pk)

        dashboard = self.assert_ok('/api/platform/dashboard/?workspace=core')
        self.assertGreaterEqual(dashboard['counts']['tasks'], 2)
        self.assertGreaterEqual(dashboard['counts']['initiatives'], 1)
        self.assertEqual(initiative['key_result']['id'], kr['id'])
        self.assertEqual(initiative['objective']['id'], objective['id'])

    def test_research_demo_flow_project_notes_files_datasets_deliverables_mindmap_and_profile(self):
        project_response = self.post_json('/api/platform/projects/', {
            'title': 'Demo secure biology project',
            'category': 'client',
            'description': 'A secure client project used for the product demo.',
            'research_question': 'Which signal explains the observed result?',
            'visibility': 'private',
            'confidentiality': 'restricted',
            'secure_data_room': True,
            'allow_downloads': True,
            'deadline': (date.today() + timedelta(days=45)).isoformat(),
        })
        self.assertEqual(project_response.status_code, 201, project_response.content)
        project = project_response.json()['project']
        project_id = project['id']
        self.assertEqual(Collection.objects.filter(project_id=project_id).count(), 6)

        patch_response = self.patch_json(f'/api/platform/projects/{project_id}/', {
            'description': 'Updated during the demo readiness flow.',
            'research_question': 'Which validated signal best explains the result?',
        })
        self.assertEqual(patch_response.status_code, 200, patch_response.content)

        note_response = self.post_json('/api/platform/resources/', {
            'project_id': project_id,
            'kind': 'note',
            'title': 'Demo research note',
            'body': 'Evidence, interpretation and next experiment.',
        })
        self.assertEqual(note_response.status_code, 201, note_response.content)
        note_id = note_response.json()['item']['id']

        paper_response = self.post_json('/api/platform/resources/', {
            'project_id': project_id,
            'kind': 'paper',
            'title': 'Demo paper reference',
            'source_url': 'https://example.com/paper',
            'description': 'Reference material for the demo project.',
        })
        self.assertEqual(paper_response.status_code, 201, paper_response.content)

        with patch('core.platform_resources_api.cloud.ensure_identity', return_value=object()), patch('core.platform_resources_api.cloud.upload'):
            file_response = self.client.post('/api/platform/files/upload/', {
                'project_id': str(project_id),
                'kind': 'file',
                'title': 'Client brief',
                'file': SimpleUploadedFile('client-brief.pdf', b'demo brief', content_type='application/pdf'),
            })
            self.assertEqual(file_response.status_code, 201, file_response.content)
            file_id = file_response.json()['item']['id']

            dataset_response = self.client.post('/api/platform/files/upload/', {
                'project_id': str(project_id),
                'kind': 'dataset',
                'title': 'Demo dataset',
                'file': SimpleUploadedFile('demo-data.csv', b'a,b\n1,2\n', content_type='text/csv'),
            })
            self.assertEqual(dataset_response.status_code, 201, dataset_response.content)
            dataset_id = dataset_response.json()['item']['id']

        deliverable_response = self.post_json(f'/api/platform/projects/{project_id}/deliverables/', {
            'title': 'Validated demo output',
            'description': 'Client-visible reviewed output.',
            'resource_id': file_id,
            'status': 'ready',
            'client_visible': True,
        })
        self.assertEqual(deliverable_response.status_code, 201, deliverable_response.content)

        map_response = self.post_json('/api/platform/mindmaps/', {
            'project_id': project_id,
            'title': 'Demo evidence map',
            'description': 'Connect the question, evidence and dataset.',
        })
        self.assertEqual(map_response.status_code, 201, map_response.content)
        map_id = map_response.json()['item']['id']
        node_a = self.post_json(f'/api/platform/mindmaps/{map_id}/', {
            'action': 'node.create', 'title': 'Research question', 'kind': 'question', 'x': 100, 'y': 100,
        })
        node_b = self.post_json(f'/api/platform/mindmaps/{map_id}/', {
            'action': 'node.create', 'title': 'Validated evidence', 'kind': 'evidence', 'x': 360, 'y': 180,
        })
        self.assertEqual(node_a.status_code, 201, node_a.content)
        self.assertEqual(node_b.status_code, 201, node_b.content)
        edge_response = self.post_json(f'/api/platform/mindmaps/{map_id}/', {
            'action': 'edge.create',
            'source_id': node_a.json()['node']['id'],
            'target_id': node_b.json()['node']['id'],
            'relation': 'supported_by',
        })
        self.assertEqual(edge_response.status_code, 201, edge_response.content)
        map_detail = self.assert_ok(f'/api/platform/mindmaps/{map_id}/')
        self.assertEqual(len(map_detail['item']['nodes']), 2)
        self.assertEqual(len(map_detail['item']['edges']), 1)

        profile_response = self.patch_json('/api/platform/researchers/me/', {
            'headline': 'Demo scientific researcher',
            'bio': 'Profile prepared for the Gravitas demo.',
            'fields': ['biology', 'data science'],
            'skills': ['Python', 'analysis'],
            'languages': ['English'],
            'availability': 'Available for collaboration',
            'is_public': True,
        })
        self.assertEqual(profile_response.status_code, 200, profile_response.content)
        researchers = self.assert_ok('/api/platform/researchers/')
        self.assertTrue(any(item['user_id'] == self.admin.pk for item in researchers['researchers']))

        project_detail = self.assert_ok(f'/api/platform/projects/{project_id}/')
        counts = project_detail['project']['counts']
        self.assertGreaterEqual(counts['notes'], 1)
        self.assertGreaterEqual(counts['files'], 1)
        self.assertGreaterEqual(counts['datasets'], 1)
        self.assertGreaterEqual(counts['deliverables'], 1)
        self.assertEqual(len(project_detail['folders']), 6)
        resource_ids = {item['id'] for item in project_detail['resources']}
        self.assertTrue({note_id, file_id, dataset_id}.issubset(resource_ids))

    def test_research_opportunities_applications_and_shared_with_me_flow(self):
        project_response = self.post_json('/api/platform/projects/', {
            'title': 'Demo open research opportunity',
            'category': 'community',
            'description': 'Community project open for a demo application.',
            'research_question': 'Can an external researcher reproduce the result?',
            'visibility': 'community',
            'application_open': True,
            'required_skills': ['Python', 'statistics'],
        })
        self.assertEqual(project_response.status_code, 201, project_response.content)
        project = project_response.json()['project']
        self.assertTrue(project['public_slug'])

        public_list = self.assert_ok('/api/platform/community/projects/')
        self.assertTrue(any(item['id'] == project['id'] for item in public_list['projects']))

        self.client.force_login(self.researcher)
        application_response = self.post_json(f"/api/platform/community/projects/{project['public_slug']}/", {
            'name': self.researcher.first_name,
            'email': self.researcher.email,
            'skills': ['Python', 'statistics'],
            'message': 'I can reproduce the analysis.',
        })
        self.assertEqual(application_response.status_code, 201, application_response.content)
        application_id = application_response.json()['application']['id']

        researcher_boot = self.assert_ok('/api/platform/bootstrap/')
        self.assertFalse(researcher_boot['access']['core'])

        self.client.force_login(self.admin)
        accept_response = self.patch_json(f"/api/platform/projects/{project['id']}/applications/{application_id}/", {
            'status': 'accepted',
        })
        self.assertEqual(accept_response.status_code, 200, accept_response.content)
        self.assertEqual(ProjectApplication.objects.get(pk=application_id).status, 'accepted')

        link_response = self.post_json('/api/platform/share/', {
            'type': 'project',
            'id': project['id'],
            'action': 'link',
            'role': 'view',
            'allow_download': False,
        })
        self.assertEqual(link_response.status_code, 201, link_response.content)
        token = link_response.json()['link']['token']

        self.client.force_login(self.researcher)
        shared = self.assert_ok('/api/platform/shared-with-me/')
        self.assertTrue(any(item['id'] == project['id'] for item in shared['items']))
        project_detail = self.assert_ok(f"/api/platform/projects/{project['id']}/")
        self.assertTrue(project_detail['project']['permissions']['can_edit'])

        self.client.logout()
        public_share = self.client.get(f'/api/platform/shared/{token}/')
        self.assertEqual(public_share.status_code, 200, public_share.content)
        self.assertTrue(public_share.json()['ok'])
        self.assertEqual(public_share.json()['project']['id'], project['id'])

    def test_core_and_private_research_access_boundaries_are_demo_safe(self):
        private_project_response = self.post_json('/api/platform/projects/', {
            'title': 'Private demo research',
            'category': 'internal',
            'visibility': 'private',
        })
        self.assertEqual(private_project_response.status_code, 201, private_project_response.content)
        private_project_id = private_project_response.json()['project']['id']
        private_note_response = self.post_json('/api/platform/resources/', {
            'workspace_id': self.research_id,
            'kind': 'note',
            'title': 'Private demo note',
            'body': 'Must not leak to an unrelated account.',
            'visibility': 'private',
        })
        self.assertEqual(private_note_response.status_code, 201, private_note_response.content)
        private_note_id = private_note_response.json()['item']['id']

        self.client.force_login(self.outsider)
        outsider_boot = self.assert_ok('/api/platform/bootstrap/')
        self.assertFalse(outsider_boot['access']['core'])
        self.assertFalse(WorkspaceMembership.objects.filter(
            workspace_id=self.core_id,
            user=self.outsider,
        ).exists())

        team_response = self.client.get('/api/platform/team/')
        self.assertEqual(team_response.status_code, 403, team_response.content)
        core_dashboard = self.client.get('/api/platform/dashboard/?workspace=core')
        self.assertEqual(core_dashboard.status_code, 403, core_dashboard.content)
        operating_dashboard = self.client.get('/api/operating/dashboard/')
        self.assertIn(operating_dashboard.status_code, {403, 404}, operating_dashboard.content)
        project_response = self.client.get(f'/api/platform/projects/{private_project_id}/')
        self.assertEqual(project_response.status_code, 404, project_response.content)
        note_response = self.client.get(f'/api/platform/resources/{private_note_id}/')
        self.assertEqual(note_response.status_code, 404, note_response.content)

    def test_workspace_frontend_navigation_and_runtime_asset_contract(self):
        root = Path(__file__).resolve().parents[2]
        shell = (root / 'workspace.html').read_text(encoding='utf-8')
        navigation = (root / 'assets' / 'platform-v3-navigation.js').read_text(encoding='utf-8')

        routes = [
            '/workspace/core',
            '/workspace/core/tasks',
            '/workspace/core/content',
            '/workspace/operating',
            '/workspace/core/team',
            '/workspace/research',
            '/workspace/research/projects',
            '/workspace/research/notes',
            '/workspace/research/files',
            '/workspace/research/datasets',
            '/workspace/research/mindmaps',
            '/workspace/people',
            '/workspace/community',
            '/workspace/shared',
        ]
        for route in routes:
            with self.subTest(route=route):
                self.assertIn(route, navigation)

        runtime_assets = [
            'platform-v2.js',
            'platform-v2-patches.js',
            'platform-v2-ux.js',
            'platform-v3-navigation.js',
            'workspace-visuals.js',
            'core-team.js',
            'operating.js',
            'operating-enhancements.js',
            'operating-core-shell.js',
            'roadmap-okr-sync.js',
            'initiative-planner.js',
            'initiative-task-editor.js',
            'initiative-task-reorder.js',
        ]
        for asset in runtime_assets:
            with self.subTest(asset=asset):
                self.assertIn(asset, shell)
                self.assertTrue((root / 'assets' / asset).exists())
