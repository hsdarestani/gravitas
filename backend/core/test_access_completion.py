import json
import tempfile
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from .layer_access import module_access, set_module_grant
from .layer_models import ActivityEvent, ModuleGrant
from .models import (
    Comment,
    ContentItem,
    NewsletterSubscriber,
    ReaderSavedItem,
    SupportTicket,
    TopicProgress,
    WorkspaceMembership,
)
from .platform_models import ContentWorkAttachment, ContentWorkComment, ContentWorkItem, CoreAsset
from .platform_runtime_v3 import ensure_platform_workspaces


User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False)
class AccessHierarchyCompletionTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='layer-admin@example.test',
            email='layer-admin@example.test',
            password='Strong-pass-123!',
        )
        self.member = User.objects.create_user(
            username='layer-member@example.test',
            email='layer-member@example.test',
            password='Strong-pass-123!',
        )
        self.client.force_login(self.admin)
        response = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(response.status_code, 200, response.content)
        self.spaces = ensure_platform_workspaces(self.admin)

    def test_member_cannot_cross_into_research_or_core_by_url(self):
        self.client.force_login(self.member)
        self.assertEqual(self.client.get('/api/platform/projects/').status_code, 403)
        self.assertEqual(self.client.get('/api/operating/dashboard/').status_code, 403)

    def test_research_inherits_learning_but_not_core(self):
        set_module_grant(
            self.member,
            ModuleGrant.Module.RESEARCH,
            enabled=True,
            access_level=ModuleGrant.AccessLevel.PARTICIPATE,
            source=ModuleGrant.Source.ADMIN,
            granted_by=self.admin,
        )
        self.assertTrue(module_access(self.member, ModuleGrant.Module.RESEARCH))
        self.assertTrue(module_access(self.member, ModuleGrant.Module.LMS))
        self.assertFalse(module_access(self.member, ModuleGrant.Module.CORE))

        self.client.force_login(self.member)
        self.assertEqual(self.client.get('/api/lms/enrollments/').status_code, 200)
        self.assertEqual(self.client.get('/api/platform/projects/').status_code, 200)
        self.assertEqual(self.client.get('/api/operating/dashboard/').status_code, 403)

    def test_core_member_gets_lower_layers_but_initiatives_remain_admin_only(self):
        WorkspaceMembership.objects.create(
            workspace=self.spaces['core'],
            user=self.member,
            role='member',
        )
        self.assertTrue(module_access(self.member, ModuleGrant.Module.CORE))
        self.assertTrue(module_access(self.member, ModuleGrant.Module.RESEARCH))
        self.assertTrue(module_access(self.member, ModuleGrant.Module.LMS))

        self.client.force_login(self.member)
        self.assertEqual(self.client.get('/api/operating/dashboard/').status_code, 200)
        self.assertEqual(self.client.get('/api/operating/initiatives/').status_code, 403)


@override_settings(SECURE_SSL_REDIRECT=False)
class MemberIsolationAndProgressTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='activity-admin@example.test',
            email='activity-admin@example.test',
            password='Strong-pass-123!',
        )
        self.member = User.objects.create_user(
            username='activity-member@example.test',
            email='activity-member@example.test',
            password='Strong-pass-123!',
        )
        self.other = User.objects.create_user(
            username='activity-other@example.test',
            email='activity-other@example.test',
            password='Strong-pass-123!',
        )
        self.client.force_login(self.admin)
        self.client.get('/api/platform/bootstrap/')

    def post_json(self, path, payload):
        return self.client.post(path, json.dumps(payload), content_type='application/json')

    def test_recent_activity_is_personal_product_activity_not_system_audit_log(self):
        Comment.objects.create(
            author=self.member,
            content_key='personal-topic',
            body='My comment',
            status=Comment.Status.PUBLISHED,
        )
        Comment.objects.create(
            author=self.other,
            content_key='other-topic',
            body='Someone else',
            status=Comment.Status.PUBLISHED,
        )
        ActivityEvent.objects.create(
            layer=ActivityEvent.Layer.CORE,
            action='system.secret_log',
            actor=self.admin,
            subject_user=self.member,
            object_type='system',
            detail={'private': True},
        )

        self.client.force_login(self.member)
        response = self.client.get('/api/member/dashboard/')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertFalse(data['learning']['access'])
        self.assertFalse(data['research']['access'])
        self.assertEqual([row['kind'] for row in data['activity']], ['comment'])
        self.assertEqual(data['activity'][0]['meta'], 'Personal Topic')
        self.assertNotIn('system.secret_log', json.dumps(data))

    def test_library_remove_and_unfollow_are_real_server_actions(self):
        ReaderSavedItem.objects.create(
            user=self.member,
            relation=ReaderSavedItem.Relation.SAVED,
            kind=ReaderSavedItem.Kind.ARTICLE,
            item_key='article-one',
            title='Article one',
        )
        ReaderSavedItem.objects.create(
            user=self.member,
            relation=ReaderSavedItem.Relation.FOLLOWING,
            kind=ReaderSavedItem.Kind.TOPIC,
            item_key='topic-one',
            title='Topic one',
        )
        self.client.force_login(self.member)
        response = self.client.delete(
            '/api/reader/library/',
            json.dumps({'relation': 'saved', 'item_key': 'article-one'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(ReaderSavedItem.objects.filter(user=self.member, item_key='article-one').exists())

        response = self.client.delete(
            '/api/reader/library/',
            json.dumps({'relation': 'following', 'item_key': 'topic-one'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(ReaderSavedItem.objects.filter(user=self.member, item_key='topic-one').exists())

    def test_topic_progress_counts_only_components_that_exist(self):
        topic = ContentItem.objects.create(
            kind=ContentItem.Kind.TOPIC,
            status=ContentItem.Status.PUBLISHED,
            slug='progress-topic',
            title='Progress Topic',
            summary='Progress contract',
            topic_data={
                'video': {'source_type': 'youtube', 'youtube_url': 'https://www.youtube.com/watch?v=abc'},
                'discussion_enabled': True,
                'viewpoints': {
                    'poll_question': 'Which side?',
                    'poll_options': [{'id': 'yes', 'label': 'Yes'}],
                },
                'simulation': {'code': '<button>Run</button>'},
            },
        )
        empty_topic = ContentItem.objects.create(
            kind=ContentItem.Kind.TOPIC,
            status=ContentItem.Status.PUBLISHED,
            slug='empty-progress-topic',
            title='Empty Topic',
            topic_data={'discussion_enabled': False},
        )
        self.client.force_login(self.member)

        video = self.post_json('/api/content/progress-topic/progress/', {'action': 'video'})
        self.assertEqual(video.status_code, 200)
        self.assertEqual(video.json()['progress']['total'], 4)
        self.assertEqual(video.json()['progress']['progress_percent'], 25.0)

        comment = self.post_json('/api/community/comments/progress-topic/', {'body': 'A real discussion comment'})
        self.assertEqual(comment.status_code, 201)

        vote = self.post_json('/api/content/progress-topic/poll/', {'option_id': 'yes'})
        self.assertEqual(vote.status_code, 200)

        simulation = self.post_json('/api/content/progress-topic/progress/', {'action': 'simulation'})
        self.assertEqual(simulation.status_code, 200)
        progress = TopicProgress.objects.get(user=self.member, topic=topic)
        self.assertTrue(progress.video_viewed)
        self.assertTrue(progress.commented)
        self.assertTrue(progress.voted)
        self.assertTrue(progress.simulation_played)
        self.assertEqual(simulation.json()['progress']['progress_percent'], 100.0)

        missing = self.post_json('/api/content/empty-progress-topic/progress/', {'action': 'simulation'})
        self.assertEqual(missing.status_code, 409)
        detail = self.client.get('/api/content/empty-progress-topic/progress/').json()['progress']
        self.assertEqual(detail['total'], 0)
        self.assertEqual(detail['progress_percent'], 0)


@override_settings(SECURE_SSL_REDIRECT=False, CONTENT_ATTACHMENT_MAX_BYTES=100)
class CoreCollaborationCompletionTests(TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(CORE_UPLOAD_ROOT=Path(self.tmp.name))
        self.settings_override.enable()

        self.admin = User.objects.create_user(
            username='core-admin@example.test',
            email='core-admin@example.test',
            password='Strong-pass-123!',
        )
        self.core_member = User.objects.create_user(
            username='core-member@example.test',
            email='core-member@example.test',
            password='Strong-pass-123!',
        )
        self.outsider = User.objects.create_user(
            username='core-outsider@example.test',
            email='core-outsider@example.test',
            password='Strong-pass-123!',
        )
        self.client.force_login(self.admin)
        response = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(response.status_code, 200)
        self.spaces = ensure_platform_workspaces(self.admin)
        WorkspaceMembership.objects.create(workspace=self.spaces['core'], user=self.core_member, role='member')

    def tearDown(self):
        self.settings_override.disable()
        self.tmp.cleanup()
        super().tearDown()

    def test_content_card_supports_comments_and_ten_megabyte_capped_attachments(self):
        item = ContentWorkItem.objects.create(
            workspace=self.spaces['core'],
            title='Trelo style card',
            kind=ContentWorkItem.Kind.ARTICLE,
            created_by=self.admin,
        )
        self.client.force_login(self.core_member)
        response = self.client.post(
            f'/api/platform/content/{item.pk}/comments/',
            json.dumps({'body': 'Production comment'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(ContentWorkComment.objects.filter(item=item, author=self.core_member).exists())

        good = self.client.post(
            f'/api/platform/content/{item.pk}/attachments/',
            {'file': SimpleUploadedFile('brief.txt', b'12345', content_type='text/plain')},
        )
        self.assertEqual(good.status_code, 201, good.content)
        self.assertTrue(ContentWorkAttachment.objects.filter(item=item, name='brief.txt').exists())

        oversized = self.client.post(
            f'/api/platform/content/{item.pk}/attachments/',
            {'file': SimpleUploadedFile('too-big.txt', b'x' * 101, content_type='text/plain')},
        )
        self.assertEqual(oversized.status_code, 413)

    def test_core_asset_access_can_be_limited_to_selected_core_people(self):
        self.client.force_login(self.admin)
        created = self.client.post('/api/platform/core-assets/', {
            'title': 'Brand guide',
            'source_url': 'https://example.test/brand',
            'visible_to_all_core': '0',
            'allowed_user_ids': json.dumps([self.core_member.pk]),
        })
        self.assertEqual(created.status_code, 201, created.content)
        asset_id = created.json()['asset']['id']

        self.client.force_login(self.core_member)
        visible = self.client.get('/api/platform/core-assets/')
        self.assertEqual(visible.status_code, 200)
        self.assertIn(asset_id, [item['id'] for item in visible.json()['assets']])

        # A non-Core account cannot even enumerate the asset library.
        self.client.force_login(self.outsider)
        self.assertEqual(self.client.get('/api/platform/core-assets/').status_code, 403)


@override_settings(SECURE_SSL_REDIRECT=False)
class SupportNewsletterAndLabCompletionTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='service-admin@example.test',
            email='service-admin@example.test',
            password='Strong-pass-123!',
        )
        self.member = User.objects.create_user(
            username='service-member@example.test',
            email='service-member@example.test',
            password='Strong-pass-123!',
        )
        self.client.force_login(self.admin)
        response = self.client.get('/api/platform/bootstrap/')
        self.assertEqual(response.status_code, 200, response.content)

    def post_json(self, path, payload):
        return self.client.post(path, json.dumps(payload), content_type='application/json')

    def test_ticket_round_trip_member_to_admin_and_back(self):
        self.client.force_login(self.member)
        created = self.post_json('/api/member/tickets/', {
            'subject': 'Need help',
            'message': 'Something is unclear.',
            'priority': 'normal',
        })
        self.assertEqual(created.status_code, 201, created.content)
        ticket_id = created.json()['ticket']['id']

        self.client.force_login(self.admin)
        listing = self.client.get('/api/platform/admin/tickets/')
        self.assertIn(ticket_id, [item['id'] for item in listing.json()['tickets']])
        reply = self.post_json(f'/api/platform/admin/tickets/{ticket_id}/', {'message': 'We can help.'})
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(reply.json()['ticket']['status'], SupportTicket.Status.WAITING_MEMBER)

        self.client.force_login(self.member)
        thread = self.client.get(f'/api/member/tickets/{ticket_id}/')
        self.assertEqual(len(thread.json()['ticket']['messages']), 2)
        self.assertTrue(thread.json()['ticket']['messages'][-1]['is_team_reply'])

    def test_newsletter_admin_lists_confirmed_people_and_sends_campaign(self):
        NewsletterSubscriber.objects.create(
            email='reader@example.test',
            is_active=True,
            source='website',
        )
        self.client.force_login(self.admin)
        listing = self.client.get('/api/platform/admin/newsletter/')
        self.assertEqual(listing.status_code, 200, listing.content)
        self.assertEqual(listing.json()['active_count'], 1)

        mail.outbox.clear()
        sent = self.post_json('/api/platform/admin/newsletter/', {
            'subject': 'Gravitas+ update',
            'body': 'A new issue is ready.',
        })
        self.assertEqual(sent.status_code, 201, sent.content)
        self.assertEqual(sent.json()['sent_count'], 1)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['reader@example.test'])

    def test_interactive_lab_is_admin_managed_and_publicly_runnable(self):
        self.client.force_login(self.admin)
        created = self.post_json('/api/platform/admin/labs/', {
            'slug': 'sandbox-lab',
            'title': 'Sandbox Lab',
            'summary': 'Interactive test',
            'status': 'published',
            'files': [
                {'name': 'index.html', 'content': '<!doctype html><button id="go">Go</button><script src="app.js"></script>'},
                {'name': 'app.js', 'content': 'document.querySelector("#go").onclick=()=>document.body.dataset.ran="1";'},
            ],
        })
        self.assertEqual(created.status_code, 201, created.content)

        self.client.logout()
        listing = self.client.get('/api/labs/')
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json()['labs'][0]['slug'], 'sandbox-lab')
        run = self.client.get('/lab-run/sandbox-lab/')
        self.assertEqual(run.status_code, 200)
        self.assertIn(b'button', run.content)
