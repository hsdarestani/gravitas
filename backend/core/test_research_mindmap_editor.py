import json

from django.contrib.auth import get_user_model
from django.test import TestCase

from .layer_models import ModuleGrant
from .models import ProjectMembership, ResearchProject
from .platform_api import ensure_dual_workspaces
from .platform_models import MindMap


class ResearchMindMapEditorApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='mindmap-owner',
            email='mindmap-owner@example.com',
            password='test-pass-123',
            first_name='Map Owner',
        )
        ModuleGrant.objects.update_or_create(
            user=self.user,
            module=ModuleGrant.Module.RESEARCH,
            defaults={
                'enabled': True,
                'access_level': ModuleGrant.AccessLevel.PARTICIPATE,
                'source': ModuleGrant.Source.ADMIN,
            },
        )
        research = ensure_dual_workspaces(self.user)['research']
        self.project = ResearchProject.objects.create(
            workspace=research,
            owner=self.user,
            title='Visual evidence project',
        )
        ProjectMembership.objects.create(
            project=self.project,
            user=self.user,
            role=ProjectMembership.Role.OWNER,
        )
        self.client.force_login(self.user)

    def post_json(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json')

    def test_create_map_opens_with_editable_root_node(self):
        response = self.post_json('/api/platform/mindmaps/', {
            'project_id': self.project.pk,
            'title': 'Evidence map',
            'description': 'Connect hypotheses and evidence.',
        })
        self.assertEqual(response.status_code, 201, response.content)
        item = response.json()['item']
        self.assertEqual(item['title'], 'Evidence map')
        self.assertEqual(item['project_id'], self.project.pk)
        self.assertTrue(item['permissions']['can_edit'])
        self.assertEqual(len(item['nodes']), 1)
        self.assertEqual(item['nodes'][0]['key'], 'root')
        self.assertEqual(item['nodes'][0]['title'], 'Evidence map')

    def test_node_drag_edit_and_connections_persist(self):
        create = self.post_json('/api/platform/mindmaps/', {
            'project_id': self.project.pk,
            'title': 'Model',
        })
        map_id = create.json()['item']['id']
        root = create.json()['item']['nodes'][0]

        second = self.post_json(f'/api/platform/mindmaps/{map_id}/', {
            'action': 'node.create',
            'key': 'evidence',
            'title': 'Evidence',
            'kind': 'paper',
            'x': 200,
            'y': 180,
        })
        self.assertEqual(second.status_code, 201, second.content)
        second_id = second.json()['node']['id']

        moved = self.post_json(f'/api/platform/mindmaps/{map_id}/', {
            'action': 'node.update',
            'node_id': second_id,
            'title': 'Updated evidence',
            'body': 'Key result',
            'x': 420,
            'y': 260,
        })
        self.assertEqual(moved.status_code, 200, moved.content)
        self.assertEqual(moved.json()['node']['x'], 420.0)
        self.assertEqual(moved.json()['node']['body'], 'Key result')

        edge = self.post_json(f'/api/platform/mindmaps/{map_id}/', {
            'action': 'edge.create',
            'source_id': second_id,
            'target_id': root['id'],
            'relation': 'supports',
            'label': 'supports hypothesis',
        })
        self.assertEqual(edge.status_code, 201, edge.content)

        detail = self.client.get(f'/api/platform/mindmaps/{map_id}/')
        self.assertEqual(detail.status_code, 200, detail.content)
        item = detail.json()['item']
        self.assertEqual(len(item['nodes']), 2)
        self.assertEqual(len(item['edges']), 1)
        self.assertEqual(item['edges'][0]['label'], 'supports hypothesis')
        self.assertEqual(MindMap.objects.get(pk=map_id).nodes.get(pk=second_id).title, 'Updated evidence')

    def test_map_title_cannot_be_emptied(self):
        create = self.post_json('/api/platform/mindmaps/', {
            'project_id': self.project.pk,
            'title': 'Named map',
        })
        map_id = create.json()['item']['id']
        response = self.client.patch(
            f'/api/platform/mindmaps/{map_id}/',
            data=json.dumps({'title': '   '}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'title_required')
