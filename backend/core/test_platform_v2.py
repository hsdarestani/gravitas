import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase, override_settings

from .models import KnowledgeResource, ProjectMembership, WorkspaceMembership
from .platform_access import can_view, content_type_for
from .platform_api import ensure_dual_workspaces
from .platform_models import (
    AccessGrant,
    ContentWorkItem,
    EntityLink,
    ObjectPolicy,
    ProjectApplication,
    ResearchProjectProfile,
    ResearchRequest,
    ShareLink,
    WorkspaceProfile,
)


@override_settings(
    GRAVITAS_DEFAULT_QUOTA_BYTES=1024 * 1024 * 100,
    GRAVITAS_MAX_UPLOAD_BYTES=1024 * 1024 * 10,
    SECURE_SSL_REDIRECT=False,
)
class PlatformV2Tests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(
            username='owner',
            email='owner@example.com',
            password='test-pass-123',
            first_name='Owner',
        )
        self.researcher = user_model.objects.create_user(
            username='researcher',
            email='researcher@example.com',
            password='test-pass-123',
            first_name='Researcher',
        )
        self.client.force_login(self.owner)

    def post_json(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json')

    def patch_json(self, path, payload):
        return self.client.patch(path, data=json.dumps(payload), content_type='application/json')

    def test_bootstrap_creates_personal_core_and_isolated_research_spaces(self):
        response = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(set(data['workspaces']), {'personal', 'core', 'research'})
        self.assertEqual(data['workspaces']['core']['purpose'], 'core')
        self.assertEqual(data['workspaces']['research']['purpose'], 'research')

        core_id = data['workspaces']['core']['id']
        research_id = data['workspaces']['research']['id']
        self.assertTrue(WorkspaceMembership.objects.filter(workspace_id=core_id, user=self.owner).exists())
        # Research V2 deliberately does not use the legacy workspace-wide ACL.
        self.assertFalse(WorkspaceMembership.objects.filter(workspace_id=research_id, user=self.owner).exists())
        self.assertTrue(WorkspaceProfile.objects.filter(workspace_id=research_id, purpose='research').exists())

    def test_client_project_gets_v2_profile_and_data_room_folders(self):
        response = self.post_json('/api/platform/projects/', {
            'title': 'Secure Biology Model',
            'category': 'client',
            'description': 'Model a private client dataset.',
            'research_question': 'Which model explains the observed signal?',
            'secure_data_room': True,
            'confidentiality': 'restricted',
            'visibility': 'private',
        })
        self.assertEqual(response.status_code, 201, response.content)
        project_id = response.json()['project']['id']
        profile = ResearchProjectProfile.objects.get(project_id=project_id)
        self.assertTrue(profile.secure_data_room)
        self.assertFalse(profile.allow_public_links)
        self.assertEqual(profile.nextcloud_root, f'Gravitas/Projects/GRV-{project_id:06d}')
        self.assertEqual(profile.project.collections.count(), 6)
        self.assertTrue(ProjectMembership.objects.filter(project_id=project_id, user=self.owner, role='owner').exists())

    def test_secure_data_room_rejects_public_share_link(self):
        project_response = self.post_json('/api/platform/projects/', {
            'title': 'Confidential Study',
            'category': 'client',
            'secure_data_room': True,
            'visibility': 'private',
        })
        project_id = project_response.json()['project']['id']
        response = self.post_json('/api/platform/share/', {
            'type': 'project',
            'id': project_id,
            'action': 'link',
            'role': 'view',
        })
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error'], 'secure_data_room_blocks_public_sharing')
        self.assertFalse(ShareLink.objects.exists())

    @patch('core.nextcloud_api.nextcloud_bridge.add_project_user')
    def test_direct_project_grant_is_visible_without_research_workspace_membership(self, add_project_user):
        project_response = self.post_json('/api/platform/projects/', {
            'title': 'Shared Scientific Project',
            'category': 'internal',
        })
        project_id = project_response.json()['project']['id']
        response = self.post_json('/api/platform/share/', {
            'type': 'project',
            'id': project_id,
            'action': 'grant',
            'email': self.researcher.email,
            'role': 'edit',
        })
        self.assertEqual(response.status_code, 201, response.content)
        project = ResearchProjectProfile.objects.get(project_id=project_id).project
        self.assertTrue(can_view(self.researcher, project))
        self.assertTrue(ProjectMembership.objects.filter(project=project, user=self.researcher, role='editor').exists())
        self.assertFalse(WorkspaceMembership.objects.filter(workspace=project.workspace, user=self.researcher).exists())
        add_project_user.assert_called_once_with(project, self.researcher)

    def test_private_personal_note_requires_explicit_grant(self):
        boot = self.client.get('/api/platform/bootstrap/').json()
        personal_id = boot['workspaces']['personal']['id']
        response = self.post_json('/api/platform/resources/', {
            'workspace_id': personal_id,
            'kind': 'note',
            'title': 'Private hypothesis',
            'body': 'Only the owner should see this before sharing.',
            'visibility': 'private',
        })
        self.assertEqual(response.status_code, 201, response.content)
        resource = KnowledgeResource.objects.get(pk=response.json()['item']['id'])
        self.assertFalse(can_view(self.researcher, resource))

        response = self.post_json('/api/platform/share/', {
            'type': 'resource',
            'id': resource.pk,
            'action': 'grant',
            'email': self.researcher.email,
            'role': 'view',
        })
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(can_view(self.researcher, resource))
        self.assertTrue(AccessGrant.objects.filter(
            content_type=content_type_for(resource),
            object_id=resource.pk,
            user=self.researcher,
            role='view',
        ).exists())

        self.client.force_login(self.researcher)
        response = self.client.get(f'/api/platform/resources/{resource.pk}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['item']['title'], 'Private hypothesis')

    def test_core_content_can_create_linked_research_handoff(self):
        response = self.post_json('/api/platform/content/', {
            'title': 'Immune evasion video',
            'kind': 'video',
            'description': 'Needs a scientific evidence brief before scripting.',
        })
        self.assertEqual(response.status_code, 201, response.content)
        item_id = response.json()['item']['id']
        response = self.post_json(f'/api/platform/content/{item_id}/', {
            'action': 'request_research',
            'research_question': 'How do tumour cells evade immune detection?',
            'brief': 'Find mechanisms and reliable sources.',
        })
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        item = ContentWorkItem.objects.get(pk=item_id)
        self.assertIsNotNone(item.research_project_id)
        self.assertEqual(item.status, 'research')
        self.assertTrue(ResearchRequest.objects.filter(content_work_item=item, project=item.research_project).exists())
        self.assertTrue(EntityLink.objects.filter(
            source_content_type=content_type_for(item),
            source_object_id=item.pk,
            target_content_type=content_type_for(item.research_project),
            target_object_id=item.research_project_id,
            relation='research_for',
        ).exists())
        self.assertEqual(body['project']['id'], item.research_project_id)

    def test_public_community_project_accepts_application(self):
        response = self.post_json('/api/platform/projects/', {
            'title': 'Open Dataset Validation',
            'category': 'community',
            'visibility': 'community',
            'application_open': True,
            'required_skills': ['Python', 'statistics'],
        })
        self.assertEqual(response.status_code, 201, response.content)
        project = response.json()['project']
        self.assertTrue(project['public_slug'])
        self.client.logout()
        response = self.post_json(f"/api/platform/community/projects/{project['public_slug']}/", {
            'name': 'External Researcher',
            'email': 'external@example.com',
            'skills': ['statistics'],
            'message': 'I can validate the dataset.',
        })
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(ProjectApplication.objects.filter(project_id=project['id'], applicant_email='external@example.com').exists())

    def test_personal_policy_and_project_policy_are_distinct(self):
        spaces = ensure_dual_workspaces(self.owner)
        personal = KnowledgeResource.objects.create(
            workspace=spaces['personal'],
            owner=self.owner,
            kind='note',
            title='Personal note',
        )
        personal_policy = ObjectPolicy.objects.create(
            content_type=ContentType.objects.get_for_model(personal),
            object_id=personal.pk,
            visibility='private',
            created_by=self.owner,
        )
        self.assertEqual(personal_policy.visibility, 'private')
        self.assertTrue(can_view(self.owner, personal))
        self.assertFalse(can_view(self.researcher, personal))
