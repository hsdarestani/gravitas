import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from .lms_models import Course, CourseInstructor, CourseModule, CourseRevision, Lesson


User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False, OPENEDX_ENABLED=False)
class CourseRevisionWorkflowTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            username='revision-admin@example.test',
            email='revision-admin@example.test',
            password='Strong-pass-123!',
        )
        self.instructor = User.objects.create_user(
            username='revision-instructor@example.test',
            email='revision-instructor@example.test',
            password='Strong-pass-123!',
            first_name='Ada',
            last_name='Instructor',
        )
        self.course = Course.objects.create(
            slug='revision-course',
            title='Live title',
            summary='Live summary',
            status=Course.Status.PUBLISHED,
            created_by=self.admin,
            published_at=timezone.now(),
        )
        CourseInstructor.objects.create(
            course=self.course,
            user=self.instructor,
            role=CourseInstructor.Role.INSTRUCTOR,
        )
        self.module = CourseModule.objects.create(
            course=self.course,
            position=1,
            title='Live module',
        )
        self.lesson = Lesson.objects.create(
            module=self.module,
            position=1,
            title='Live lesson',
            kind=Lesson.Kind.ARTICLE,
            body='Live lesson body',
            published=True,
        )

    def patch_authoring(self, payload):
        return self.client.patch(
            f'/api/lms/courses/{self.course.pk}/?authoring=1',
            json.dumps(payload),
            content_type='application/json',
        )

    def post_publish(self, payload=None):
        return self.client.post(
            f'/api/lms/courses/{self.course.pk}/publish-revision/',
            json.dumps(payload or {}),
            content_type='application/json',
        )

    def test_instructor_edits_preview_without_touching_live_course_then_publishes(self):
        self.client.force_login(self.instructor)

        draft = self.patch_authoring({
            'title': 'Draft title',
            'summary': 'Draft summary',
            'modules': [{
                'id': self.module.pk,
                'position': 1,
                'title': 'Draft module',
                'summary': '',
                'lessons': [{
                    'id': self.lesson.pk,
                    'position': 1,
                    'title': 'Live lesson',
                    'kind': Lesson.Kind.ARTICLE,
                    'body': 'Live lesson body',
                    'published': True,
                }, {
                    'position': 2,
                    'title': 'New draft lesson',
                    'kind': Lesson.Kind.ARTICLE,
                    'body': 'Only visible after publish',
                    'published': True,
                }],
                'assessments': [],
            }],
            'assessments': [],
        })
        self.assertEqual(draft.status_code, 200, draft.content)
        self.assertEqual(draft.json()['course']['title'], 'Draft title')
        self.assertEqual(len(draft.json()['course']['modules'][0]['lessons']), 2)

        self.course.refresh_from_db()
        self.assertEqual(self.course.title, 'Live title')
        self.assertEqual(self.course.modules.get(pk=self.module.pk).lessons.count(), 1)

        live = self.client.get(f'/api/lms/courses/{self.course.pk}/')
        self.assertEqual(live.status_code, 200, live.content)
        self.assertEqual(live.json()['course']['title'], 'Live title')

        authoring = self.client.get(f'/api/lms/courses/{self.course.pk}/?authoring=1')
        self.assertEqual(authoring.status_code, 200, authoring.content)
        self.assertEqual(authoring.json()['course']['title'], 'Draft title')
        self.assertEqual(authoring.json()['revision']['state'], CourseRevision.State.DRAFT)

        published = self.post_publish()
        self.assertEqual(published.status_code, 200, published.content)
        self.assertIsNone(published.json()['revision'])

        self.course.refresh_from_db()
        self.assertEqual(self.course.title, 'Draft title')
        self.assertEqual(self.course.modules.get(pk=self.module.pk).title, 'Draft module')
        self.assertEqual(self.course.modules.get(pk=self.module.pk).lessons.count(), 2)
        self.assertFalse(CourseRevision.objects.filter(course=self.course).exists())

    def test_instructor_cannot_bypass_revision_with_direct_patch(self):
        self.client.force_login(self.instructor)
        response = self.client.patch(
            f'/api/lms/courses/{self.course.pk}/',
            json.dumps({'title': 'Should not go live'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403, response.content)
        self.course.refresh_from_db()
        self.assertEqual(self.course.title, 'Live title')

    def test_scheduled_revision_is_published_by_management_command(self):
        self.client.force_login(self.instructor)
        draft = self.patch_authoring({'title': 'Scheduled title'})
        self.assertEqual(draft.status_code, 200, draft.content)

        future = timezone.now() + timedelta(hours=2)
        scheduled = self.post_publish({'scheduled_for': future.isoformat()})
        self.assertEqual(scheduled.status_code, 200, scheduled.content)
        self.assertTrue(scheduled.json()['scheduled'])

        revision = CourseRevision.objects.get(course=self.course)
        self.assertEqual(revision.state, CourseRevision.State.SCHEDULED)
        self.course.refresh_from_db()
        self.assertEqual(self.course.title, 'Live title')

        revision.scheduled_for = timezone.now() - timedelta(minutes=1)
        revision.save(update_fields=['scheduled_for', 'updated_at'])
        call_command('publish_scheduled_course_revisions')

        self.course.refresh_from_db()
        self.assertEqual(self.course.title, 'Scheduled title')
        self.assertFalse(CourseRevision.objects.filter(course=self.course).exists())
