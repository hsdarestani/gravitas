import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .layer_access import module_access
from .layer_models import ActivityEvent, ModuleGrant
from .lms_models import Certificate, Course, CourseEnrollment
from .models import Comment, ProjectMembership, ReaderSavedItem, ResearchProject
from .platform_models import ResearchProjectProfile
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(
    GRAVITAS_DEFAULT_QUOTA_BYTES=1024 * 1024 * 100,
    GRAVITAS_MAX_UPLOAD_BYTES=1024 * 1024 * 10,
    SECURE_SSL_REDIRECT=False,
)
class FiveLayerCompletionTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='platform-admin@example.com',
            email='platform-admin@example.com',
            password='test-pass-123',
        )
        self.member = User.objects.create_user(
            username='member-complete@example.com',
            email='member-complete@example.com',
            password='test-pass-123',
        )
        self.researcher = User.objects.create_user(
            username='researcher-complete@example.com',
            email='researcher-complete@example.com',
            password='test-pass-123',
        )
        self.client.force_login(self.admin)
        response = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(response.status_code, 200, response.content)
        self.spaces = ensure_platform_workspaces(self.admin)

    def patch_json(self, path, payload):
        return self.client.patch(path, data=json.dumps(payload), content_type='application/json')

    def test_member_dashboard_aggregates_library_discussion_learning_and_research(self):
        ReaderSavedItem.objects.create(
            user=self.member,
            relation=ReaderSavedItem.Relation.SAVED,
            kind=ReaderSavedItem.Kind.ARTICLE,
            item_key='member-dashboard-article',
            url='/articles/member-dashboard-article',
            title='Saved evidence',
            summary='A saved public item.',
        )
        Comment.objects.create(
            author=self.member,
            content_key='member-dashboard-article',
            body='A member discussion contribution.',
        )
        course = Course.objects.create(
            slug='member-dashboard-course',
            title='Member course',
            summary='Learning progress in Layer 2.',
            status=Course.Status.PUBLISHED,
            access_type=Course.AccessType.OPEN,
            created_by=self.admin,
        )
        CourseEnrollment.objects.create(user=self.member, course=course)
        project = ResearchProject.objects.create(
            workspace=self.spaces['research'],
            owner=self.member,
            title='Member research project',
            description='Visible from the account home without copying the project.',
        )
        ResearchProjectProfile.objects.create(project=project, status=ResearchProjectProfile.Status.ACTIVE)

        self.client.force_login(self.member)
        response = self.client.get('/api/member/dashboard/')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data['library']['saved_count'], 1)
        self.assertEqual(data['discussions']['total'], 1)
        self.assertEqual(data['learning']['active'], 1)
        self.assertEqual(data['research']['projects'], 1)
        self.assertTrue(any(item['kind'] == 'learning' for item in data['next_actions']))
        self.assertTrue(any(item['kind'] == 'research' for item in data['next_actions']))

    @patch('core.platform_admin_extended.nextcloud_bridge.add_project_user')
    def test_core_admin_can_operate_research_metadata_and_membership(self, add_project_user):
        project = ResearchProject.objects.create(
            workspace=self.spaces['research'],
            owner=self.admin,
            title='Administered research',
        )
        ResearchProjectProfile.objects.create(project=project)

        response = self.patch_json(
            f'/api/platform/admin/research/projects/{project.pk}/',
            {
                'status': 'active',
                'category': 'client',
                'research_question': 'What is the measured effect?',
                'secure_data_room': True,
                'allow_public_links': True,
                'member': {
                    'action': 'grant',
                    'email': self.researcher.email,
                    'role': 'editor',
                },
            },
        )
        self.assertEqual(response.status_code, 200, response.content)
        project.refresh_from_db()
        profile = project.platform_profile
        self.assertEqual(profile.status, ResearchProjectProfile.Status.ACTIVE)
        self.assertEqual(profile.category, ResearchProjectProfile.Category.CLIENT)
        self.assertTrue(profile.secure_data_room)
        self.assertFalse(profile.allow_public_links)
        self.assertTrue(ProjectMembership.objects.filter(project=project, user=self.researcher, role='editor').exists())
        self.assertTrue(module_access(self.researcher, ModuleGrant.Module.RESEARCH))
        add_project_user.assert_called_once_with(project, self.researcher)
        self.assertTrue(ActivityEvent.objects.filter(action='project.admin_updated', object_id=str(project.pk)).exists())

    @patch('core.platform_admin_extended.nextcloud_bridge.remove_project_user')
    def test_core_admin_can_revoke_research_project_member(self, remove_project_user):
        project = ResearchProject.objects.create(
            workspace=self.spaces['research'],
            owner=self.admin,
            title='Revocation research',
        )
        ResearchProjectProfile.objects.create(project=project)
        ProjectMembership.objects.create(project=project, user=self.researcher, role=ProjectMembership.Role.VIEWER)

        response = self.patch_json(
            f'/api/platform/admin/research/projects/{project.pk}/',
            {'member': {'action': 'revoke', 'user_id': self.researcher.pk}},
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(ProjectMembership.objects.filter(project=project, user=self.researcher).exists())
        remove_project_user.assert_called_once_with(project, self.researcher)

    def test_core_admin_can_complete_and_revoke_lms_certificate(self):
        course = Course.objects.create(
            slug='managed-enrollment',
            title='Managed enrollment',
            status=Course.Status.PUBLISHED,
            access_type=Course.AccessType.LOCKED,
            created_by=self.admin,
        )
        enrollment = CourseEnrollment.objects.create(
            user=self.member,
            course=course,
            status=CourseEnrollment.Status.ACTIVE,
            access_source=CourseEnrollment.AccessSource.ADMIN,
            granted_by=self.admin,
        )

        response = self.patch_json(
            f'/api/platform/admin/lms/enrollments/{enrollment.pk}/',
            {'status': 'completed'},
        )
        self.assertEqual(response.status_code, 200, response.content)
        enrollment.refresh_from_db()
        self.assertEqual(enrollment.status, CourseEnrollment.Status.COMPLETED)
        self.assertEqual(str(enrollment.progress_percent), '100.00')
        self.assertTrue(Certificate.objects.filter(enrollment=enrollment).exists())
        self.assertTrue(module_access(self.member, ModuleGrant.Module.LMS))

        response = self.patch_json(
            f'/api/platform/admin/lms/enrollments/{enrollment.pk}/',
            {'certificate': 'revoke'},
        )
        self.assertEqual(response.status_code, 200, response.content)
        certificate = Certificate.objects.get(enrollment=enrollment)
        self.assertIsNotNone(certificate.revoked_at)

    @override_settings(NEXTCLOUD_ADMIN_USER='admin', NEXTCLOUD_ADMIN_PASSWORD='secret')
    @patch('core.nextcloud_deck._find_board')
    def test_deck_status_is_available_to_core_admin(self, find_board):
        find_board.return_value = {'id': 42, 'title': 'Gravitas+ Execution'}
        response = self.client.get('/api/platform/admin/deck/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()['available'])
        self.assertEqual(response.json()['board']['id'], 42)

    @patch('core.nextcloud_deck.sync_tasks_to_deck')
    def test_deck_sync_records_audit_event(self, sync_tasks):
        sync_tasks.return_value = {
            'board': {'id': 9, 'title': 'Gravitas+ Execution', 'url': 'https://example.invalid/deck/9'},
            'stacks': {'Backlog': 1, 'Active': 2, 'Blocked': 3, 'Done': 4},
            'tasks': 3,
            'changes': {
                'created': 1,
                'updated': 1,
                'moved': 0,
                'archived': 0,
                'pulled': 1,
                'conflicts': 1,
            },
            'conflict_task_ids': [17],
        }
        response = self.client.post('/api/platform/admin/deck/sync/', data='{}', content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        event = ActivityEvent.objects.get(action='deck.synced', object_id='9')
        self.assertEqual(event.detail['changes']['pulled'], 1)
        self.assertEqual(event.detail['conflicts'], [17])
