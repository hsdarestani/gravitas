from io import StringIO
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command, CommandError
from django.test import RequestFactory, TestCase, override_settings

from gravitas_backend.staging_metadata import staging_release_metadata

from .lms_models import Course
from .models import ContentItem, InteractiveLab
from .platform_runtime_v3 import ensure_platform_workspaces


class StagingFixtureTest(TestCase):
    def test_production_settings_reject_fixture_writes(self):
        with self.assertRaisesMessage(CommandError, 'isolated staging settings'):
            call_command('staging_content_fixture', 'qa-005', owner='owner@example.test')

    @override_settings(GRAVIQUEST_STAGING=True, PUBLIC_BASE_URL='https://staging.graviquest.com')
    def test_create_is_repeatable_and_cleanup_preserves_review_progress(self):
        actor = get_user_model().objects.create_user('owner@example.test', email='owner@example.test')
        ensure_platform_workspaces(actor)
        target = {'default': {'NAME': 'gravitas_workspace_staging'}}

        def fixture(cohort='qa-005', **extra):
            with patch.object(settings, 'DATABASES', target):
                call_command('staging_content_fixture', cohort, owner=actor.email, stdout=StringIO(), **extra)

        fixture()
        fixture()
        slug = 'synthetic-staging-qa-005'
        topic = ContentItem.objects.get(slug=slug)
        course = Course.objects.get(slug=slug)
        self.assertEqual(course.modules.get().lessons.count(), 1)
        self.assertTrue(InteractiveLab.objects.filter(slug=slug, studio_enabled=True).exists())
        course.title = 'Reviewed draft'
        course.save(update_fields=['title'])
        with self.assertRaisesMessage(CommandError, 'draft was edited'):
            fixture(remove=True)
        self.assertTrue(ContentItem.objects.filter(pk=topic.pk).exists())
        fixture(cohort='qa-006')
        fixture(cohort='qa-006', remove=True)
        for model in (ContentItem, Course, InteractiveLab):
            self.assertFalse(model.objects.filter(slug='synthetic-staging-qa-006').exists())

    def test_staging_rejects_checkout_and_webhooks_before_request_handler(self):
        factory = RequestFactory()
        with patch('django.core.handlers.base.BaseHandler') as handler:
            middleware = staging_release_metadata(handler)
            for endpoint in ('checkout', 'payment-webhook'):
                response = middleware(factory.post(f'/api/lms/courses/12/{endpoint}/'))
                self.assertEqual(response.status_code, 503)
                self.assertIn('noindex', response['X-Robots-Tag'])
            handler.assert_not_called()
