import json

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import ProjectMembership, ResearchProject
from .platform_runtime_v3 import ensure_platform_workspaces
from .research_models import ProjectDiscussionMessage, ResearchExperiment


@override_settings(
    GRAVITAS_DEFAULT_QUOTA_BYTES=1024 * 1024 * 100,
    GRAVITAS_MAX_UPLOAD_BYTES=1024 * 1024 * 10,
    SECURE_SSL_REDIRECT=False,
)
class ResearchProjectToolsTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='research-tools-admin@example.com',
            email='research-tools-admin@example.com',
            password='test-pass-123',
        )
        self.editor = User.objects.create_user(
            username='research-tools-editor@example.com',
            email='research-tools-editor@example.com',
            password='test-pass-123',
        )
        self.outsider = User.objects.create_user(
            username='research-tools-outsider@example.com',
            email='research-tools-outsider@example.com',
            password='test-pass-123',
        )
        self.client.force_login(self.admin)
        boot = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(boot.status_code, 200, boot.content)
        spaces = ensure_platform_workspaces(self.admin)
        self.project = ResearchProject.objects.create(
            workspace=spaces['research'],
            owner=self.admin,
            title='Project cockpit specimen',
            description='A project used to validate rich Research surfaces.',
        )
        ProjectMembership.objects.create(
            project=self.project,
            user=self.editor,
            role=ProjectMembership.Role.EDITOR,
        )

    def post_json(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json')

    def patch_json(self, path, payload):
        return self.client.patch(path, data=json.dumps(payload), content_type='application/json')

    def test_project_milestones_endpoint_is_acl_scoped(self):
        response = self.client.get(f'/api/platform/projects/{self.project.pk}/milestones/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['milestones'], [])

        self.client.force_login(self.outsider)
        response = self.client.get(f'/api/platform/projects/{self.project.pk}/milestones/')
        self.assertEqual(response.status_code, 404, response.content)

    def test_editor_can_create_list_and_update_experiment(self):
        self.client.force_login(self.editor)
        response = self.post_json(
            f'/api/platform/projects/{self.project.pk}/experiments/',
            {
                'title': 'Signal validation',
                'hypothesis': 'The signal remains stable under the alternate protocol.',
                'protocol': 'Run the controlled validation and compare the distributions.',
                'status': 'running',
            },
        )
        self.assertEqual(response.status_code, 201, response.content)
        experiment_id = response.json()['experiment']['id']
        self.assertTrue(ResearchExperiment.objects.filter(pk=experiment_id, owner=self.editor).exists())

        listed = self.client.get(f'/api/platform/projects/{self.project.pk}/experiments/')
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual(len(listed.json()['experiments']), 1)

        updated = self.patch_json(
            f'/api/platform/projects/{self.project.pk}/experiments/{experiment_id}/',
            {'status': 'complete', 'result_summary': 'The alternate protocol reproduced the signal.'},
        )
        self.assertEqual(updated.status_code, 200, updated.content)
        self.assertEqual(updated.json()['experiment']['status'], 'complete')
        self.assertEqual(
            ResearchExperiment.objects.get(pk=experiment_id).result_summary,
            'The alternate protocol reproduced the signal.',
        )

    def test_private_thread_supports_reply_and_resolution(self):
        self.client.force_login(self.editor)
        root = self.post_json(
            f'/api/platform/projects/{self.project.pk}/discussions/',
            {'body': 'Should this evidence be included in the final synthesis?'},
        )
        self.assertEqual(root.status_code, 201, root.content)
        root_id = root.json()['message']['id']

        reply = self.post_json(
            f'/api/platform/projects/{self.project.pk}/discussions/',
            {'parent_id': root_id, 'body': 'Yes, after the sensitivity check is documented.'},
        )
        self.assertEqual(reply.status_code, 201, reply.content)
        reply_id = reply.json()['message']['id']
        self.assertEqual(ProjectDiscussionMessage.objects.get(pk=reply_id).parent_id, root_id)

        resolved = self.patch_json(
            f'/api/platform/projects/{self.project.pk}/discussions/{root_id}/',
            {'resolved': True},
        )
        self.assertEqual(resolved.status_code, 200, resolved.content)
        self.assertTrue(resolved.json()['message']['resolved'])

        listed = self.client.get(f'/api/platform/projects/{self.project.pk}/discussions/')
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual(len(listed.json()['messages']), 2)

        self.client.force_login(self.outsider)
        hidden = self.client.get(f'/api/platform/projects/{self.project.pk}/discussions/')
        self.assertEqual(hidden.status_code, 404, hidden.content)
