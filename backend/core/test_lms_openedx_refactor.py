import io
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, SimpleTestCase, override_settings

from . import cloud
from .lms_models import (
    Course,
    CourseEvent,
    CourseRegistrationProfile,
    LearningAsset,
    Lesson,
    LessonProgress,
    SourceConnection,
)
from .platform_runtime_v3 import ensure_platform_workspaces


User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False)
class OpenEdXLmsRefactorTests(TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.media_override = override_settings(
            LMS_MEDIA_ROOT=Path(self.tmp.name),
            LMS_ASSET_MAX_BYTES=1024 * 1024,
            OPENEDX_ENABLED=False,
        )
        self.media_override.enable()

        self.admin = User.objects.create_superuser(
            username='lms-admin@example.test',
            email='lms-admin@example.test',
            password='Strong-pass-123!',
            first_name='LMS',
            last_name='Admin',
        )
        self.learner = User.objects.create_user(
            username='learner@example.test',
            email='learner@example.test',
            password='Strong-pass-123!',
            first_name='Ada',
            last_name='Learner',
        )
        self.client.force_login(self.admin)
        bootstrap = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(bootstrap.status_code, 200, bootstrap.content)
        ensure_platform_workspaces(self.admin)

    def tearDown(self):
        self.media_override.disable()
        self.tmp.cleanup()
        super().tearDown()

    def post_json(self, path, payload):
        return self.client.post(path, json.dumps(payload), content_type='application/json')

    def patch_json(self, path, payload):
        return self.client.patch(path, json.dumps(payload), content_type='application/json')

    def create_course(self, **overrides):
        payload = {
            'title': 'Evidence Research 101',
            'slug': 'evidence-research-101',
            'summary': 'A research learning course.',
            'description': 'Course description',
            'status': 'published',
            'access_type': 'open',
            'certificate_enabled': True,
            'provider': 'native',
            'registration_schema': [],
            'learning_config': {
                'ai_enabled': True,
                'zotero_enabled': True,
                'lab_enabled': True,
                'require_profile_before_content': True,
            },
            'payment_config': {'enabled': False, 'provider': 'future', 'prepared': True},
            'modules': [{
                'position': 1,
                'title': 'Foundations',
                'summary': 'Start here',
                'lessons': [{
                    'position': 1,
                    'title': 'Evidence first',
                    'kind': 'article',
                    'summary': 'Lesson summary',
                    'body': '<p>Evidence beats intuition.</p>',
                    'duration_seconds': 120,
                    'is_required': True,
                    'published': True,
                    'access_rule': {},
                }],
                'assessments': [],
            }],
            'assessments': [{
                'title': 'Final assessment',
                'passing_score': 70,
                'max_attempts': 3,
                'required_for_completion': True,
                'published': True,
                'questions': [{
                    'id': 'q1',
                    'prompt': 'Best basis?',
                    'choices': ['Evidence', 'Guess'],
                    'correct_answer': 'Evidence',
                }],
            }],
        }
        payload.update(overrides)
        response = self.post_json('/api/lms/courses/', payload)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['course']

    def enroll_learner(self, course_id):
        self.client.force_login(self.admin)
        response = self.post_json(
            f'/api/lms/courses/{course_id}/enroll/',
            {'user_id': self.learner.pk},
        )
        self.assertIn(response.status_code, {200, 201}, response.content)
        return response.json()['enrollment']

    def test_post_enrollment_course_edit_preserves_progress_and_stable_ids(self):
        course = self.create_course()
        module = course['modules'][0]
        lesson = module['lessons'][0]
        self.enroll_learner(course['id'])

        self.client.force_login(self.learner)
        progress = self.client.put(
            f"/api/lms/lessons/{lesson['id']}/progress/",
            json.dumps({'completed': True, 'progress_seconds': 120}),
            content_type='application/json',
        )
        self.assertEqual(progress.status_code, 200, progress.content)
        progress_id = LessonProgress.objects.get(
            enrollment__user=self.learner,
            lesson_id=lesson['id'],
        ).pk

        self.client.force_login(self.admin)
        updated = self.patch_json(f"/api/lms/courses/{course['id']}/", {
            'title': 'Evidence Research 101 · Updated',
            'modules': [{
                'id': module['id'],
                'position': 1,
                'title': 'Foundations updated',
                'summary': 'Edited after enrollment',
                'lessons': [{
                    'id': lesson['id'],
                    'position': 1,
                    'title': 'Evidence first · updated',
                    'kind': 'article',
                    'summary': 'Safe edit',
                    'body': '<p>Updated lesson body.</p>',
                    'duration_seconds': 180,
                    'is_required': True,
                    'published': True,
                    'access_rule': {},
                }, {
                    'position': 2,
                    'title': 'New live-safe lesson',
                    'kind': 'lab',
                    'lab_slug': 'sandbox-lab',
                    'duration_seconds': 60,
                    'is_required': False,
                    'published': True,
                }],
                'assessments': [],
            }],
            'assessments': [{
                'id': course['assessments'][0]['id'],
                'title': 'Final assessment',
                'passing_score': 70,
                'max_attempts': 3,
                'required_for_completion': True,
                'published': True,
                'questions': [{
                    'id': 'q1',
                    'prompt': 'Best basis?',
                    'choices': ['Evidence', 'Guess'],
                    'correct_answer': 'Evidence',
                }],
            }],
        })
        self.assertEqual(updated.status_code, 200, updated.content)
        self.assertEqual(updated.json()['course']['modules'][0]['lessons'][0]['id'], lesson['id'])
        self.assertEqual(LessonProgress.objects.get(pk=progress_id).lesson_id, lesson['id'])
        self.assertTrue(LessonProgress.objects.get(pk=progress_id).completed)

    def test_registration_profile_locks_protected_lesson_and_final_exam_until_complete(self):
        course = self.create_course(
            slug='profile-course',
            registration_schema=[{
                'key': 'research_goal',
                'label': 'Research goal',
                'type': 'textarea',
                'required': True,
            }],
        )
        lesson_id = course['modules'][0]['lessons'][0]['id']
        assessment_id = course['assessments'][0]['id']
        self.enroll_learner(course['id'])

        self.client.force_login(self.learner)
        detail = self.client.get(f"/api/lms/courses/{course['id']}/")
        self.assertEqual(detail.status_code, 200)
        self.assertFalse(detail.json()['course']['registration_complete'])
        self.assertTrue(detail.json()['course']['modules'][0]['lessons'][0]['locked'])

        lesson_progress = self.client.put(
            f'/api/lms/lessons/{lesson_id}/progress/',
            json.dumps({'completed': True}),
            content_type='application/json',
        )
        self.assertEqual(lesson_progress.status_code, 409)
        self.assertEqual(lesson_progress.json()['error'], 'course_profile_required')

        exam = self.post_json(
            f'/api/lms/assessments/{assessment_id}/attempt/',
            {'answers': {'q1': 'Evidence'}},
        )
        self.assertEqual(exam.status_code, 409)
        self.assertEqual(exam.json()['error'], 'course_profile_required')

        incomplete = self.post_json(
            f"/api/lms/courses/{course['id']}/registration-profile/",
            {'answers': {}},
        )
        self.assertEqual(incomplete.status_code, 409)

        completed = self.post_json(
            f"/api/lms/courses/{course['id']}/registration-profile/",
            {'answers': {'research_goal': 'Build an evidence map'}},
        )
        self.assertEqual(completed.status_code, 200)
        self.assertTrue(CourseRegistrationProfile.objects.get(
            enrollment__user=self.learner,
            enrollment__course_id=course['id'],
        ).completed)

        reopened = self.client.get(f"/api/lms/courses/{course['id']}/").json()['course']
        self.assertFalse(reopened['modules'][0]['lessons'][0]['locked'])

    def test_lesson_access_rules_are_enforced_server_side(self):
        course = self.create_course(slug='locked-course')
        module = course['modules'][0]
        first = module['lessons'][0]

        self.client.force_login(self.admin)
        updated = self.patch_json(f"/api/lms/courses/{course['id']}/", {
            'modules': [{
                'id': module['id'],
                'position': 1,
                'title': 'Foundations',
                'summary': 'Start here',
                'lessons': [{
                    'id': first['id'],
                    'position': 1,
                    'title': 'Evidence first',
                    'kind': 'article',
                    'summary': 'Lesson summary',
                    'body': '<p>Evidence beats intuition.</p>',
                    'duration_seconds': 120,
                    'is_required': True,
                    'published': True,
                    'access_rule': {},
                }, {
                    'position': 2,
                    'title': 'Prerequisite-gated lesson',
                    'kind': 'article',
                    'body': '<p>Protected.</p>',
                    'duration_seconds': 60,
                    'is_required': True,
                    'published': True,
                    'access_rule': {'requires_lesson_ids': [first['id']]},
                }],
                'assessments': [],
            }],
            'assessments': [{
                'id': course['assessments'][0]['id'],
                'title': 'Final assessment',
                'passing_score': 70,
                'max_attempts': 3,
                'required_for_completion': True,
                'published': True,
                'questions': [{
                    'id': 'q1',
                    'prompt': 'Best basis?',
                    'choices': ['Evidence', 'Guess'],
                    'correct_answer': 'Evidence',
                }],
            }],
        })
        self.assertEqual(updated.status_code, 200, updated.content)
        gated = updated.json()['course']['modules'][0]['lessons'][1]

        self.enroll_learner(course['id'])
        self.client.force_login(self.learner)
        detail = self.client.get(f"/api/lms/courses/{course['id']}/").json()['course']
        locked = next(item for item in detail['modules'][0]['lessons'] if item['id'] == gated['id'])
        self.assertTrue(locked['locked'])
        self.assertEqual(locked['lock_reason'], 'prerequisite_lessons')

        blocked = self.client.put(
            f"/api/lms/lessons/{gated['id']}/progress/",
            json.dumps({'completed': True}),
            content_type='application/json',
        )
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.json()['error'], 'lesson_locked')

        complete_first = self.client.put(
            f"/api/lms/lessons/{first['id']}/progress/",
            json.dumps({'completed': True}),
            content_type='application/json',
        )
        self.assertEqual(complete_first.status_code, 200)
        reopened = self.client.get(f"/api/lms/courses/{course['id']}/").json()['course']
        unlocked = next(item for item in reopened['modules'][0]['lessons'] if item['id'] == gated['id'])
        self.assertFalse(unlocked['locked'])

    @patch('core.lms_api.openedx_bridge.enroll_by_email', return_value={'is_active': True})
    @patch('core.lms_api.openedx_bridge.allow_enrollment')
    @patch('core.lms_api.openedx_bridge.configured', return_value=True)
    def test_openedx_course_mapping_syncs_enrollment_without_replacing_gravitas_account(
        self, configured, allow_enrollment, enroll_by_email
    ):
        course = self.create_course(
            slug='openedx-course',
            provider='openedx',
            openedx_course_key='course-v1:Gravitas+Research101+2026',
            openedx_course_url='https://learn.gravitasplus.com/courses/course-v1:Gravitas+Research101+2026/course/',
            openedx_studio_url='https://studio.gravitasplus.com/course/course-v1:Gravitas+Research101+2026',
        )
        enrollment = self.enroll_learner(course['id'])
        allow_enrollment.assert_called_once_with(
            email=self.learner.email,
            course_key='course-v1:Gravitas+Research101+2026',
        )
        enroll_by_email.assert_called_once_with(
            email=self.learner.email,
            course_key='course-v1:Gravitas+Research101+2026',
        )
        self.assertEqual(enrollment['provider_state']['openedx']['state'], 'enrolled')

    @patch('core.lms_extended_api.complete', return_value='Use the source to form a falsifiable claim.')
    def test_ai_tutor_is_personalized_and_logged(self, complete):
        course = self.create_course(slug='ai-course')
        self.enroll_learner(course['id'])
        lesson_id = course['modules'][0]['lessons'][0]['id']
        self.client.force_login(self.learner)
        response = self.post_json(f"/api/lms/courses/{course['id']}/ai/", {
            'question': 'How should I improve my hypothesis?',
            'lesson_id': lesson_id,
            'history': [{'role': 'user', 'content': 'I am studying evidence.'}],
        })
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn('falsifiable', response.json()['answer'])
        self.assertTrue(CourseEvent.objects.filter(
            user=self.learner,
            course_id=course['id'],
            kind=CourseEvent.Kind.AI_USE,
        ).exists())
        complete.assert_called_once()

    @patch('core.lms_extended_api._zotero_request')
    def test_zotero_connection_encrypts_key_and_never_returns_it(self, zotero_request):
        zotero_request.side_effect = [
            [],
            [{
                'key': 'ABC123',
                'data': {
                    'title': 'A source',
                    'itemType': 'journalArticle',
                    'date': '2026',
                    'creators': [{'firstName': 'Ada', 'lastName': 'Lovelace'}],
                },
            }],
        ]
        self.client.force_login(self.learner)
        created = self.post_json('/api/lms/sources/zotero/', {
            'label': 'My sources',
            'library_type': 'user',
            'library_id': '123456',
            'api_key': 'zotero-secret-key',
        })
        self.assertEqual(created.status_code, 201, created.content)
        stored = SourceConnection.objects.get(user=self.learner)
        self.assertNotEqual(stored.encrypted_token, 'zotero-secret-key')
        self.assertEqual(cloud._decrypt(stored.encrypted_token), 'zotero-secret-key')
        self.assertNotIn('secret', json.dumps(created.json()).lower())

        items = self.client.get(
            f"/api/lms/sources/zotero/items/?connection_id={stored.pk}&q=source"
        )
        self.assertEqual(items.status_code, 200, items.content)
        self.assertEqual(items.json()['items'][0]['title'], 'A source')

    def test_course_exports_markdown_latex_docx_and_log_usage(self):
        course = self.create_course(slug='export-course')
        self.enroll_learner(course['id'])
        self.client.force_login(self.learner)
        for fmt, content_type in [
            ('md', 'text/markdown'),
            ('tex', 'application/x-tex'),
            ('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        ]:
            response = self.client.get(f"/api/lms/courses/{course['id']}/export/{fmt}/")
            self.assertEqual(response.status_code, 200, fmt)
            self.assertTrue(response['Content-Type'].startswith(content_type), response['Content-Type'])
        self.assertEqual(CourseEvent.objects.filter(
            user=self.learner,
            course_id=course['id'],
            kind=CourseEvent.Kind.EXPORT,
        ).count(), 3)

    def test_arbitrary_course_asset_is_uploaded_and_access_controlled(self):
        course = self.create_course(slug='asset-course')
        lesson_id = course['modules'][0]['lessons'][0]['id']
        self.client.force_login(self.admin)
        upload = self.client.post(
            f"/api/platform/admin/lms/courses/{course['id']}/assets/",
            {
                'title': 'Research package',
                'kind': 'file',
                'lesson_id': str(lesson_id),
                'file': SimpleUploadedFile(
                    'package.customformat',
                    b'course-asset',
                    content_type='application/octet-stream',
                ),
            },
        )
        self.assertEqual(upload.status_code, 201, upload.content)
        asset = LearningAsset.objects.get(pk=upload.json()['asset']['id'])
        self.assertTrue(Path(asset.storage_path).exists())

        self.client.force_login(self.learner)
        forbidden = self.client.get(f"/api/lms/assets/{asset.pk}/download/")
        self.assertEqual(forbidden.status_code, 403)

        self.enroll_learner(course['id'])
        self.client.force_login(self.learner)
        allowed = self.client.get(f"/api/lms/assets/{asset.pk}/download/")
        self.assertEqual(allowed.status_code, 200)

    def test_analytics_filters_course_user_views_skips_dwell_ai_and_lab(self):
        course = self.create_course(slug='analytics-course')
        self.enroll_learner(course['id'])
        lesson_id = course['modules'][0]['lessons'][0]['id']
        self.client.force_login(self.learner)
        for body in [
            {'kind': 'lesson.view', 'lesson_id': lesson_id},
            {'kind': 'lesson.skip', 'lesson_id': lesson_id},
            {'kind': 'lesson.dwell', 'lesson_id': lesson_id, 'duration_seconds': 90},
            {'kind': 'lab.use', 'lesson_id': lesson_id},
        ]:
            response = self.post_json(f"/api/lms/courses/{course['id']}/events/", body)
            self.assertEqual(response.status_code, 201, response.content)

        self.client.force_login(self.admin)
        report = self.client.get(
            f"/api/platform/admin/lms/analytics/?course_id={course['id']}&user_id={self.learner.pk}"
        )
        self.assertEqual(report.status_code, 200, report.content)
        data = report.json()
        self.assertEqual(data['summary']['enrollments'], 1)
        self.assertEqual(data['summary']['by_kind']['lesson.view']['count'], 1)
        self.assertEqual(data['summary']['by_kind']['lesson.skip']['count'], 1)
        self.assertEqual(data['summary']['by_kind']['lesson.dwell']['duration_seconds'], 90)
        self.assertEqual(data['summary']['by_kind']['lab.use']['count'], 1)
        self.assertEqual(data['learners'][0]['dwell_seconds'], 90)

    def test_learning_path_graph_and_course_taxonomy_are_future_ready(self):
        self.client.force_login(self.admin)
        category = self.post_json('/api/platform/admin/lms/meta/', {
            'kind': 'category',
            'name': 'Research Methods',
            'slug': 'research-methods',
        })
        self.assertEqual(category.status_code, 201, category.content)
        tag = self.post_json('/api/platform/admin/lms/meta/', {
            'kind': 'tag',
            'name': 'Evidence',
            'slug': 'evidence',
        })
        self.assertEqual(tag.status_code, 201, tag.content)

        path = self.post_json('/api/lms/paths/', {
            'title': 'Researcher pathway',
            'slug': 'researcher-pathway',
            'status': 'draft',
            'nodes': [
                {'id': 'intro', 'course_id': 1},
                {'id': 'advanced', 'course_id': 2},
            ],
            'edges': [
                {'from': 'intro', 'to': 'advanced', 'rule': 'complete'},
            ],
            'payment_config': {'enabled': False, 'provider': 'future'},
        })
        self.assertEqual(path.status_code, 201, path.content)
        self.assertEqual(len(path.json()['path']['nodes']), 2)
        self.assertEqual(len(path.json()['path']['edges']), 1)


class OpenEdXLmsFrontendContractTests(SimpleTestCase):
    def test_learner_course_has_ai_lab_zotero_exports_and_telemetry(self):
        root = Path(__file__).resolve().parents[2]
        js = (root / 'assets/ws/ws-member-lms.js').read_text(encoding='utf-8')
        self.assertIn("courseTutorPanel(course)", js)
        self.assertIn("zoteroConnectionPanel()", js)
        self.assertIn("lesson.kind === 'lab'", js)
        self.assertIn("kind: 'lesson.dwell'", js)
        self.assertIn("kind: 'lesson.skip'", js)
        self.assertIn("/export/", js)

    def test_admin_course_builder_has_openedx_taxonomy_instructors_forms_assets_paths_and_analytics(self):
        root = Path(__file__).resolve().parents[2]
        js = (root / 'assets/ws/ws-admin.js').read_text(encoding='utf-8')
        for needle in [
            'Open edX mapping',
            'Categories & tags',
            'Instructors',
            'Enrollment & profile form',
            'Course media library',
            'Learning paths',
            'Learning analytics',
            'Activity overview',
            'AI tutor uses',
            'Lab uses',
        ]:
            self.assertIn(needle, js)

    def test_openedx_installer_keeps_existing_nginx_and_uses_internal_proxy_port(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / '.github/workflows/install-openedx.yml').read_text(encoding='utf-8')
        self.assertIn('Tutor v22', workflow)
        self.assertIn('release/verawood.1', workflow)
        self.assertIn('ENABLE_WEB_PROXY=false', workflow)
        self.assertIn('127.0.0.1:8181', workflow)
        self.assertIn('gravitas-openedx', workflow)
        self.assertIn('INDIGO_PRIMARY_COLOR="#003049"', workflow)
