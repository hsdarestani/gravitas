import json

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .layer_access import module_access, set_module_grant
from .layer_models import ActivityEvent, CommunityProfile, ModuleGrant
from .lms_models import Assessment, Certificate, Course, CourseEnrollment, Lesson
from .models import WorkspaceMembership
from .platform_runtime_v3 import ensure_platform_workspaces


@override_settings(
    GRAVITAS_DEFAULT_QUOTA_BYTES=1024 * 1024 * 100,
    GRAVITAS_MAX_UPLOAD_BYTES=1024 * 1024 * 10,
    SECURE_SSL_REDIRECT=False,
)
class FiveLayerPlatformTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='admin@example.com',
            email='admin@example.com',
            password='test-pass-123',
        )
        self.member = User.objects.create_user(
            username='member@example.com',
            email='member@example.com',
            password='test-pass-123',
        )

        # First bootstrap establishes the canonical platform and its first
        # internal administrator. Every subsequent account starts at Layer 2.
        self.client.force_login(self.admin)
        response = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(response.status_code, 200, response.content)
        self.spaces = ensure_platform_workspaces(self.admin)

    def test_new_account_starts_with_dashboard_only(self):
        profile = CommunityProfile.objects.get(user=self.member)
        self.assertEqual(profile.role, CommunityProfile.Role.MEMBER)
        self.assertEqual(profile.status, CommunityProfile.Status.ACTIVE)
        self.assertTrue(module_access(self.member, ModuleGrant.Module.DASHBOARD))
        self.assertFalse(module_access(self.member, ModuleGrant.Module.LMS))
        self.assertFalse(module_access(self.member, ModuleGrant.Module.RESEARCH))
        self.assertFalse(module_access(self.member, ModuleGrant.Module.CORE))

        self.client.force_login(self.member)
        data = self.client.get('/api/platform/bootstrap/').json()
        self.assertTrue(data['layers']['2']['enabled'])
        self.assertFalse(data['layers']['3']['enabled'])
        self.assertFalse(data['layers']['4']['enabled'])
        self.assertFalse(data['layers']['5']['enabled'])

    def test_role_and_entitlements_are_independent(self):
        profile = CommunityProfile.objects.get(user=self.member)
        profile.role = CommunityProfile.Role.LEARNER
        profile.save(update_fields=['role', 'updated_at'])
        self.assertFalse(module_access(self.member, ModuleGrant.Module.LMS))

        set_module_grant(
            self.member,
            ModuleGrant.Module.RESEARCH,
            enabled=True,
            source=ModuleGrant.Source.ADMIN,
            granted_by=self.admin,
        )
        self.assertTrue(module_access(self.member, ModuleGrant.Module.RESEARCH))
        self.assertFalse(module_access(self.member, ModuleGrant.Module.LMS))
        self.assertEqual(
            CommunityProfile.objects.get(user=self.member).role,
            CommunityProfile.Role.LEARNER,
        )

    def test_core_grant_cannot_manufacture_internal_membership(self):
        set_module_grant(
            self.member,
            ModuleGrant.Module.CORE,
            enabled=True,
            access_level=ModuleGrant.AccessLevel.MANAGE,
            source=ModuleGrant.Source.ADMIN,
            granted_by=self.admin,
        )
        self.assertFalse(
            WorkspaceMembership.objects.filter(workspace=self.spaces['core'], user=self.member).exists()
        )
        self.assertFalse(module_access(self.member, ModuleGrant.Module.CORE))

    def test_core_admin_can_change_role_and_research_access_with_audit(self):
        self.client.force_login(self.admin)
        response = self.client.patch(
            f'/api/platform/admin/users/{self.member.pk}/',
            data=json.dumps({
                'community_role': 'researcher',
                'modules': {
                    'research': {'enabled': True, 'access_level': 'participate'},
                },
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()['user']
        self.assertEqual(data['community_role'], 'researcher')
        self.assertTrue(data['modules']['research']['enabled'])
        self.assertFalse(data['modules']['lms']['enabled'])
        self.assertFalse(data['modules']['core']['enabled'])
        self.assertTrue(
            ActivityEvent.objects.filter(
                actor=self.admin,
                subject_user=self.member,
                action='user.access_updated',
            ).exists()
        )

    def test_non_core_member_cannot_use_layer_five_admin_api(self):
        self.client.force_login(self.member)
        response = self.client.get('/api/platform/admin/users/')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error'], 'core_admin_required')

    def _create_course_via_api(self, access_type='open', price=None):
        self.client.force_login(self.admin)
        payload = {
            'slug': f'course-{access_type}',
            'title': f'{access_type.title()} course',
            'summary': 'Foundation course',
            'status': 'published',
            'access_type': access_type,
            'certificate_enabled': True,
            'modules': [{
                'title': 'Module 1',
                'lessons': [{
                    'title': 'Lesson 1',
                    'kind': 'article',
                    'body': 'Protected lesson content',
                    'is_required': True,
                }],
            }],
            'assessments': [{
                'title': 'Final assessment',
                'passing_score': 70,
                'max_attempts': 2,
                'questions': [{
                    'id': 'q1',
                    'prompt': '2 + 2?',
                    'choices': [3, 4, 5],
                    'correct_answer': 4,
                }],
            }],
        }
        if price is not None:
            payload['price'] = price
        response = self.client.post(
            '/api/lms/courses/',
            data=json.dumps(payload),
            content_type='application/json',
        )
        return response

    def test_open_course_enrollment_unlocks_lms_and_certificate_flow(self):
        created = self._create_course_via_api()
        self.assertEqual(created.status_code, 201, created.content)
        course = Course.objects.get(slug='course-open')
        lesson = Lesson.objects.get(module__course=course)
        assessment = Assessment.objects.get(course=course)

        # Before enrollment, protected lesson/exam content stays closed.
        self.client.force_login(self.member)
        detail = self.client.get(f'/api/lms/courses/{course.pk}/').json()['course']
        self.assertEqual(detail['assessments'][0]['questions'], [])
        self.assertEqual(detail['modules'][0]['lessons'][0]['body'], '')
        self.assertTrue(detail['modules'][0]['lessons'][0]['locked'])

        enrolled = self.client.post(
            f'/api/lms/courses/{course.pk}/enroll/',
            data='{}',
            content_type='application/json',
        )
        self.assertEqual(enrolled.status_code, 201, enrolled.content)
        self.assertTrue(module_access(self.member, ModuleGrant.Module.LMS))

        # Enrollment reveals the learning material/questions, but never the
        # answer key used by server-side scoring.
        detail = self.client.get(f'/api/lms/courses/{course.pk}/').json()['course']
        self.assertEqual(detail['modules'][0]['lessons'][0]['body'], 'Protected lesson content')
        self.assertFalse(detail['modules'][0]['lessons'][0]['locked'])
        self.assertEqual(len(detail['assessments'][0]['questions']), 1)
        self.assertNotIn('correct_answer', detail['assessments'][0]['questions'][0])
        self.assertNotIn('correct', detail['assessments'][0]['questions'][0])

        lesson_done = self.client.put(
            f'/api/lms/lessons/{lesson.pk}/progress/',
            data=json.dumps({'completed': True, 'progress_seconds': 120}),
            content_type='application/json',
        )
        self.assertEqual(lesson_done.status_code, 200, lesson_done.content)
        self.assertEqual(lesson_done.json()['enrollment']['progress_percent'], '50.00')

        exam = self.client.post(
            f'/api/lms/assessments/{assessment.pk}/attempt/',
            data=json.dumps({'answers': {'q1': 4}}),
            content_type='application/json',
        )
        self.assertEqual(exam.status_code, 200, exam.content)
        self.assertTrue(exam.json()['attempt']['passed'])
        self.assertEqual(exam.json()['enrollment']['status'], 'completed')
        self.assertEqual(exam.json()['enrollment']['progress_percent'], '100.00')
        self.assertTrue(Certificate.objects.filter(enrollment__user=self.member, enrollment__course=course).exists())

    def test_paid_course_does_not_fake_payment(self):
        created = self._create_course_via_api(access_type='paid', price='49.00')
        self.assertEqual(created.status_code, 201, created.content)
        course = Course.objects.get(slug='course-paid')

        self.client.force_login(self.member)
        response = self.client.post(
            f'/api/lms/courses/{course.pk}/enroll/',
            data='{}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 402)
        self.assertEqual(response.json()['error'], 'payment_required')
        self.assertFalse(CourseEnrollment.objects.filter(user=self.member, course=course).exists())

    def test_course_structure_replace_does_not_duplicate_final_assessment(self):
        created = self._create_course_via_api()
        self.assertEqual(created.status_code, 201, created.content)
        course = Course.objects.get(slug='course-open')
        self.assertEqual(course.assessments.count(), 1)

        self.client.force_login(self.admin)
        response = self.client.patch(
            f'/api/lms/courses/{course.pk}/',
            data=json.dumps({
                'modules': [{
                    'title': 'Replacement module',
                    'lessons': [{'title': 'Replacement lesson', 'kind': 'video'}],
                }],
                'assessments': [{
                    'title': 'Replacement final',
                    'questions': [{'id': 'q1', 'prompt': 'Ready?', 'correct_answer': True}],
                }],
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        course.refresh_from_db()
        self.assertEqual(course.modules.count(), 1)
        self.assertEqual(course.assessments.count(), 1)
        self.assertEqual(course.assessments.get().title, 'Replacement final')
