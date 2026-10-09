import json

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import Comment, WorkspaceMembership
from .notifications import mentioned_users
from .operating_models import TaskInAppNotification
from .platform_models import ContentWorkItem
from .platform_runtime_v3 import ensure_platform_workspaces


User = get_user_model()


def make_user(email, first_name='', last_name='', **extra):
    return User.objects.create_user(
        username=email,
        email=email,
        password='Strong-pass-123!',
        first_name=first_name,
        last_name=last_name,
        **extra,
    )


class MentionResolutionTests(TestCase):
    def test_handles_resolve_by_first_name_local_part_and_full_name(self):
        darius = make_user('d.karimi@example.test', 'Darius', 'Karimi')
        mina = make_user('mina@example.test', 'Mina')
        found = mentioned_users('Thanks @darius and @mina.', [darius, mina])
        self.assertEqual({user.pk for user in found}, {darius.pk, mina.pk})
        self.assertEqual(mentioned_users('cc @d.karimi', [darius, mina]), [darius])
        self.assertEqual(mentioned_users('cc @DariusKarimi', [darius, mina]), [darius])

    def test_ambiguous_or_foreign_handles_notify_nobody(self):
        one = make_user('sam.one@example.test', 'Sam')
        two = make_user('sam.two@example.test', 'Sam')
        stranger = make_user('stranger@example.test', 'Stranger')
        self.assertEqual(mentioned_users('@sam look at this', [one, two]), [])
        self.assertEqual(mentioned_users('@stranger', [one, two]), [])
        self.assertEqual(mentioned_users('mail me at sam@example.test', [one, two, stranger]), [])


@override_settings(SECURE_SSL_REDIRECT=False, PUBLIC_BASE_URL='https://gravitas.test')
class SiteCommentNotificationTests(TestCase):
    key = 'machine-hypothesis'

    def setUp(self):
        self.author = make_user('author@example.test', 'Ava')
        self.replier = make_user('replier@example.test', 'Rumi')
        self.darius = make_user('darius@example.test', 'Darius')
        self.moderator = make_user('mod@example.test', 'Mod', is_superuser=True, is_staff=True)
        self.parent = Comment.objects.create(
            author=self.author, content_key=self.key, body='First thought', status=Comment.Status.PUBLISHED,
        )
        Comment.objects.create(
            author=self.darius, content_key=self.key, body='Second thought', status=Comment.Status.PUBLISHED,
        )

    def notices(self, user):
        return list(TaskInAppNotification.objects.filter(recipient=user).order_by('id'))

    def moderate(self, comment_id, status):
        self.client.force_login(self.moderator)
        response = self.client.patch(
            f'/api/platform/admin/site/comments/{comment_id}/',
            json.dumps({'status': status}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_reply_and_mention_are_announced_on_publication_not_submission(self):
        self.client.force_login(self.replier)
        response = self.client.post(
            f'/api/community/comments/{self.key}/',
            json.dumps({'body': 'Agreed, and @darius said the same.', 'parent_id': self.parent.pk}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        comment_id = response.json()['comment']['id']
        self.assertFalse(TaskInAppNotification.objects.exists())

        self.moderate(comment_id, 'published')

        [reply] = self.notices(self.author)
        self.assertEqual(reply.event_type, 'site.comment_reply')
        self.assertEqual(reply.actor, self.replier)
        self.assertEqual(reply.payload['url'], 'https://gravitas.test/topic.html?slug=machine-hypothesis')
        [mention] = self.notices(self.darius)
        self.assertEqual(mention.event_type, 'site.mentioned')
        [live] = self.notices(self.replier)
        self.assertEqual(live.event_type, 'site.comment_published')

        # Publishing again is not a second event.
        self.moderate(comment_id, 'hidden')
        self.moderate(comment_id, 'published')
        self.assertEqual(TaskInAppNotification.objects.count(), 3)

    def test_like_notifies_the_author_once_per_liker(self):
        self.client.force_login(self.replier)
        url = f'/api/community/comments/{self.key}/{self.parent.pk}/like/'
        for _ in range(3):
            self.assertEqual(self.client.post(url).status_code, 200)
        [like] = self.notices(self.author)
        self.assertEqual(like.event_type, 'site.comment_liked')

        self.client.force_login(self.author)
        self.client.post(url)
        self.assertEqual(len(self.notices(self.author)), 1)

    def test_feed_endpoint_lists_and_marks_site_notifications(self):
        self.client.force_login(self.replier)
        self.client.post(f'/api/community/comments/{self.key}/{self.parent.pk}/like/')
        self.client.force_login(self.author)
        feed = self.client.get('/api/task-notifications/in-app/').json()
        self.assertEqual(feed['unread_count'], 1)
        self.assertEqual(feed['notifications'][0]['title'], 'Rumi liked your comment')
        self.assertIsNone(feed['notifications'][0]['task_id'])
        marked = self.client.patch(
            '/api/task-notifications/in-app/', json.dumps({'all': True}), content_type='application/json',
        ).json()
        self.assertEqual(marked['unread_count'], 0)


@override_settings(SECURE_SSL_REDIRECT=False)
class ContentCardNotificationTests(TestCase):
    def setUp(self):
        self.admin = make_user('core-admin@example.test', 'Leila')
        self.member = make_user('core-member@example.test', 'Omid')
        self.outsider = make_user('outsider@example.test', 'Outsider')
        self.client.force_login(self.admin)
        self.assertEqual(self.client.get('/api/platform/bootstrap/').status_code, 200)
        self.spaces = ensure_platform_workspaces(self.admin)
        WorkspaceMembership.objects.create(workspace=self.spaces['core'], user=self.member, role='member')
        self.item = ContentWorkItem.objects.create(
            workspace=self.spaces['core'],
            title='Black hole explainer',
            kind=ContentWorkItem.Kind.VIDEO,
            created_by=self.admin,
        )

    def comment(self, user, body):
        self.client.force_login(user)
        response = self.client.post(
            f'/api/platform/content/{self.item.pk}/comments/',
            json.dumps({'body': body}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_mentions_reach_members_only_and_replies_reach_the_thread(self):
        self.comment(self.member, 'Ready for review @leila, also @outsider')
        [mention] = TaskInAppNotification.objects.filter(recipient=self.admin)
        self.assertEqual(mention.event_type, 'content.mentioned')
        self.assertFalse(TaskInAppNotification.objects.filter(recipient=self.outsider).exists())
        self.assertFalse(TaskInAppNotification.objects.filter(recipient=self.member).exists())

        self.comment(self.admin, 'Looks good.')
        [reply] = TaskInAppNotification.objects.filter(recipient=self.member)
        self.assertEqual(reply.event_type, 'content.comment_added')
        self.assertEqual(reply.payload['url'].rsplit('/workspace', 1)[1], '/core/content')
