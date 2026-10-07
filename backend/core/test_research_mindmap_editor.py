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

    def test_create_map_returns_editable_canvas(self):
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
        self.assertEqual(item['nodes'], [])
        self.assertEqual(item['edges'], [])

    def test_node_drag_edit_and_connections_persist(self):
        create = self.post_json('/api/platform/mindmaps/', {
            'project_id': self.project.pk,
            'title': 'Model',
        })
        map_id = create.json()['item']['id']
        root_response = self.post_json(f'/api/platform/mindmaps/{map_id}/', {
            'action': 'node.create',
            'key': 'hypothesis',
            'title': 'Hypothesis',
            'kind': 'hypothesis',
            'x': 600,
            'y': 360,
        })
        self.assertEqual(root_response.status_code, 201, root_response.content)
        root = root_response.json()['node']

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

        updated_edge = self.post_json(f'/api/platform/mindmaps/{map_id}/', {
            'action': 'edge.update',
            'edge_id': edge.json()['edge']['id'],
            'relation': 'evidence_for',
            'label': 'direct canvas edit',
        })
        self.assertEqual(updated_edge.status_code, 200, updated_edge.content)
        self.assertEqual(updated_edge.json()['edge']['relation'], 'evidence_for')
        self.assertEqual(updated_edge.json()['edge']['label'], 'direct canvas edit')

    def test_map_can_be_deleted_with_its_nodes_and_edges(self):
        create = self.post_json('/api/platform/mindmaps/', {
            'project_id': self.project.pk,
            'title': 'Disposable map',
        })
        self.assertEqual(create.status_code, 201, create.content)
        map_id = create.json()['item']['id']

        first = self.post_json(f'/api/platform/mindmaps/{map_id}/', {
            'action': 'node.create',
            'key': 'first',
            'title': 'First',
        })
        second = self.post_json(f'/api/platform/mindmaps/{map_id}/', {
            'action': 'node.create',
            'key': 'second',
            'title': 'Second',
        })
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 201, second.content)

        edge = self.post_json(f'/api/platform/mindmaps/{map_id}/', {
            'action': 'edge.create',
            'source_id': first.json()['node']['id'],
            'target_id': second.json()['node']['id'],
            'relation': 'related',
        })
        self.assertEqual(edge.status_code, 201, edge.content)

        deleted = self.client.delete(f'/api/platform/mindmaps/{map_id}/')
        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.assertFalse(MindMap.objects.filter(pk=map_id).exists())
        self.assertEqual(self.client.get(f'/api/platform/mindmaps/{map_id}/').status_code, 404)

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
