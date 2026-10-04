import base64
import json

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .lms_api import COVER_MAX_BYTES
from .lms_models import Course


User = get_user_model()
PNG = b'\x89PNG\r\n\x1a\n' + b'cover-bytes' * 8


def data_uri(raw, mime='image/png'):
    return f'data:{mime};base64,{base64.b64encode(raw).decode("ascii")}'


@override_settings(SECURE_SSL_REDIRECT=False, OPENEDX_ENABLED=False)
class CourseCoverTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            username='cover-admin@example.test',
            email='cover-admin@example.test',
            password='Strong-pass-123!',
        )
        self.client.force_login(self.admin)
        bootstrap = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(bootstrap.status_code, 200, bootstrap.content)
        self.course = Course.objects.create(
            slug='cover-course',
            title='Cover course',
            status=Course.Status.PUBLISHED,
            created_by=self.admin,
        )

    def patch_cover(self, value, course=None):
        course = course or self.course
        response = self.client.patch(
            f'/api/lms/courses/{course.pk}/',
            json.dumps({'cover_image': value}),
            content_type='application/json',
        )
        if response.status_code == 200 and course.status == Course.Status.PUBLISHED:
            self.assertTrue(response.json().get('staged'))
            response = self.client.post(
                f'/api/lms/courses/{course.pk}/revision/publish/',
                json.dumps({'action': 'publish_now'}),
                content_type='application/json',
            )
        return response

    def test_uploaded_cover_is_served_from_a_versioned_url(self):
        response = self.patch_cover(data_uri(PNG))
        self.assertEqual(response.status_code, 200, response.content)
        url = response.json()['course']['cover_url']
        self.assertTrue(url.startswith(f'/api/lms/courses/{self.course.pk}/cover/?v='), url)

        self.client.logout()
        served = self.client.get(url)
        self.assertEqual(served.status_code, 200)
        self.assertEqual(served['Content-Type'], 'image/png')
        self.assertIn('immutable', served['Cache-Control'])
        self.assertEqual(served.content, PNG)

    def test_catalog_and_enrollment_payloads_carry_the_url_not_the_bytes(self):
        self.patch_cover(data_uri(PNG))
        bare = Course.objects.create(slug='bare', title='Bare', status=Course.Status.PUBLISHED, created_by=self.admin)
        catalog = self.client.get('/api/lms/courses/').json()['courses']
        by_id = {item['id']: item for item in catalog}
        self.assertTrue(by_id[self.course.pk]['cover_url'])
        self.assertEqual(by_id[bare.pk]['cover_url'], '')
        self.assertNotIn('base64', json.dumps(catalog))

    def test_cover_can_be_removed(self):
        self.patch_cover(data_uri(PNG))
        response = self.patch_cover('')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['course']['cover_url'], '')
        self.assertEqual(self.client.get(f'/api/lms/courses/{self.course.pk}/cover/').status_code, 404)

    def test_unsafe_or_oversized_covers_are_refused(self):
        cases = (
            (data_uri(b'<svg onload="x()"/>', 'image/svg+xml'), 'cover_unsupported_type'),
            ('data:image/png;base64,***', 'cover_not_base64'),
            ('https://example.test/cover.png', 'cover_must_be_data_uri'),
            (data_uri(b'0' * (COVER_MAX_BYTES + 1)), 'cover_too_large'),
        )
        for value, error in cases:
            response = self.patch_cover(value)
            self.assertEqual(response.status_code, 400, error)
            self.assertEqual(response.json()['error'], error)
        self.course.refresh_from_db()
        self.assertEqual(self.course.cover_image, '')

    def test_draft_cover_is_not_public(self):
        draft = Course.objects.create(slug='draft', title='Draft', status=Course.Status.DRAFT, created_by=self.admin)
        self.assertEqual(self.patch_cover(data_uri(PNG), draft).status_code, 200)
        self.assertEqual(self.client.get(f'/api/lms/courses/{draft.pk}/cover/').status_code, 200)
        self.client.logout()
        self.assertEqual(self.client.get(f'/api/lms/courses/{draft.pk}/cover/').status_code, 404)
