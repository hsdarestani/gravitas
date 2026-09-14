import json

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .layer_models import ActivityEvent
from .models import Comment, ContentItem, ContentTranslation


@override_settings(
    GRAVITAS_DEFAULT_QUOTA_BYTES=1024 * 1024 * 100,
    GRAVITAS_MAX_UPLOAD_BYTES=1024 * 1024 * 10,
    SECURE_SSL_REDIRECT=False,
)
class SiteLayerAdminTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='site-admin@example.com',
            email='site-admin@example.com',
            password='test-pass-123',
        )
        self.member = User.objects.create_user(
            username='reader@example.com',
            email='reader@example.com',
            password='test-pass-123',
        )
        # The first bootstrap establishes the canonical Core workspace and
        # makes this account its initial internal administrator.
        self.client.force_login(self.admin)
        boot = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(boot.status_code, 200, boot.content)

    def test_core_admin_can_create_multilingual_public_content(self):
        response = self.client.post(
            '/api/platform/admin/site/content/',
            data=json.dumps({
                'kind': 'article',
                'status': 'published',
                'slug': 'five-layer-research',
                'title': 'Five-layer research',
                'summary': 'Public summary',
                'body': 'Public body',
                'translations': [{
                    'locale': 'de',
                    'status': 'published',
                    'title': 'Fuenf Ebenen',
                    'summary': 'Zusammenfassung',
                    'body': 'Inhalt',
                }],
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        item = ContentItem.objects.get(slug='five-layer-research')
        self.assertEqual(item.status, ContentItem.Status.PUBLISHED)
        self.assertIsNotNone(item.published_at)
        translated = ContentTranslation.objects.get(content=item, locale='de')
        self.assertEqual(translated.status, ContentTranslation.Status.PUBLISHED)
        self.assertIsNotNone(translated.published_at)
        self.assertTrue(
            ActivityEvent.objects.filter(
                actor=self.admin,
                layer=ActivityEvent.Layer.SHELL,
                action='content.created',
                object_id=str(item.pk),
            ).exists()
        )

    def test_regular_member_cannot_use_site_admin(self):
        self.client.force_login(self.member)
        response = self.client.get('/api/platform/admin/site/content/')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error'], 'core_admin_required')

    def test_comment_moderation_is_audited(self):
        comment = Comment.objects.create(
            author=self.member,
            content_key='dossier-machine-hypothesis',
            body='A useful correction.',
            status=Comment.Status.PENDING,
        )
        self.client.force_login(self.admin)
        response = self.client.patch(
            f'/api/platform/admin/site/comments/{comment.pk}/',
            data=json.dumps({'status': 'published'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        comment.refresh_from_db()
        self.assertEqual(comment.status, Comment.Status.PUBLISHED)
        event = ActivityEvent.objects.get(action='comment.moderated', object_id=str(comment.pk))
        self.assertEqual(event.actor, self.admin)
        self.assertEqual(event.subject_user, self.member)
        self.assertEqual(event.detail['from'], 'pending')
        self.assertEqual(event.detail['to'], 'published')
