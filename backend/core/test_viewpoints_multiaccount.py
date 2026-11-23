"""Multi-account Viewpoints contract: real Django views, isolated test DB.

No test writes to production. A member owns one choice per poll across devices;
different members have independent choices; anonymous browser votes remain
possible; moderated reasons/replies stay private until an admin publishes them.
"""
import json

from django.contrib.auth import get_user_model
from django.test import Client, TestCase

from .models import Comment, CommentLike, ContentItem, TopicPollVote


class ViewpointsMultiAccountTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.alice = User.objects.create_user(
            username='vp-alice@example.invalid', email='vp-alice@example.invalid',
            password='test-password-not-used',
        )
        self.bob = User.objects.create_user(
            username='vp-bob@example.invalid', email='vp-bob@example.invalid',
            password='test-password-not-used',
        )
        self.topic = ContentItem.objects.get(slug='answer-that-looked-right')
        self.poll = self.topic.topic_data['viewpoints']['polls'][0]
        self.poll_id = self.poll['id']
        self.first = self.poll['options'][0]['id']
        self.second = self.poll['options'][1]['id']
        self.poll_url = f'/api/content/{self.topic.slug}/poll/'
        self.reason_key = f'{self.topic.slug}-poll-{self.poll_id}'
        self.comments_url = f'/api/community/comments/{self.reason_key}/'
        self.a = Client()
        self.a.force_login(self.alice)
        self.b = Client()
        self.b.force_login(self.bob)

    def vote(self, client, option, poll_id=None):
        return client.post(self.poll_url, json.dumps({
            'poll_id': poll_id or self.poll_id, 'option_id': option,
        }), content_type='application/json')

    def poll_for(self, client, **extra):
        return client.get(self.poll_url, {'poll_id': self.poll_id, 'sealed': '1', **extra}).json()['poll']

    def post_reason(self, client, body, *, parent=None):
        payload = {'body': body}
        if parent:
            payload['parent_id'] = parent
        else:
            payload['anchor'] = {'kind': 'reason', 'option': self.first, 'side': self.first}
        return client.post(self.comments_url, json.dumps(payload), content_type='application/json')

    def visible(self, client):
        result = client.get(self.comments_url)
        self.assertEqual(result.status_code, 200)
        return result.json()['comments']

    def test_two_distinct_accounts_get_independent_votes(self):
        self.assertEqual(self.vote(self.a, self.first).status_code, 200)
        self.assertEqual(self.vote(self.b, self.second).status_code, 200)
        self.assertEqual(TopicPollVote.objects.filter(topic=self.topic, poll_id=self.poll_id).count(), 2)
        self.assertEqual(self.poll_for(self.a)['selected'], self.first)
        self.assertEqual(self.poll_for(self.b)['selected'], self.second)

    def test_one_account_two_browsers_updates_one_vote(self):
        other_browser = Client()
        other_browser.force_login(self.alice)
        self.assertEqual(self.vote(self.a, self.first).status_code, 200)
        self.assertEqual(self.vote(other_browser, self.second).status_code, 200)
        self.assertEqual(TopicPollVote.objects.filter(topic=self.topic, poll_id=self.poll_id).count(), 1,
                         'A member must not produce two counts by using another browser')
        self.assertEqual(self.poll_for(self.a)['selected'], self.second)
        self.assertEqual(self.poll_for(other_browser)['selected'], self.second)

    def test_anonymous_vote_is_preserved_when_that_browser_signs_in(self):
        guest = Client()
        self.assertEqual(self.vote(guest, self.first).status_code, 200)
        self.assertEqual(TopicPollVote.objects.filter(topic=self.topic, poll_id=self.poll_id).count(), 1)
        guest.force_login(self.alice)
        self.assertEqual(self.poll_for(guest)['selected'], self.first,
                         'Logging in must not make an earlier browser vote disappear')
        self.assertEqual(self.vote(guest, self.second).status_code, 200)
        self.assertEqual(TopicPollVote.objects.filter(topic=self.topic, poll_id=self.poll_id).count(), 1)

    def test_reveal_first_is_session_local_and_cannot_override_a_vote(self):
        self.assertTrue(self.poll_for(self.a)['sealed'])
        self.assertTrue(self.poll_for(self.a, reveal='1')['seen_first'])
        self.assertEqual(self.vote(self.a, self.first).status_code, 409)
        self.assertEqual(self.vote(self.b, self.second).status_code, 200)
        self.assertEqual(self.poll_for(self.b)['selected'], self.second)

    def test_moderated_reasons_replies_and_reactions_are_isolated(self):
        submitted = self.post_reason(self.a, 'Reason from Alice')
        self.assertEqual(submitted.status_code, 201)
        self.assertEqual(submitted.json()['moderation'], 'pending')
        reason = Comment.objects.get(pk=submitted.json()['comment']['id'])
        self.assertEqual([r['id'] for r in self.visible(self.a)], [reason.pk])
        self.assertEqual(self.visible(self.b), [])
        self.assertEqual(self.visible(Client()), [])

        reason.status = Comment.Status.PUBLISHED
        reason.save(update_fields=['status'])
        self.assertEqual([r['id'] for r in self.visible(self.b)], [reason.pk])

        reply_result = self.post_reason(self.b, 'Reply from Bob', parent=reason.pk)
        self.assertEqual(reply_result.status_code, 201)
        reply = Comment.objects.get(pk=reply_result.json()['comment']['id'])
        self.assertEqual(len(self.visible(self.a)), 1)
        self.assertEqual(len(self.visible(self.b)), 2)
        reply.status = Comment.Status.PUBLISHED
        reply.save(update_fields=['status'])
        self.assertEqual(len(self.visible(self.a)), 2)
        self.assertEqual(len(self.visible(Client())), 2)

        reaction_url = self.comments_url + f'{reason.pk}/reaction/'
        self.assertEqual(Client().post(reaction_url, json.dumps({'value': 'like'}),
                                       content_type='application/json').status_code, 401)
        self.assertEqual(self.b.post(reaction_url, json.dumps({'value': 'like'}),
                                     content_type='application/json').status_code, 200)
        self.assertEqual(self.a.post(reaction_url, json.dumps({'value': 'dislike'}),
                                     content_type='application/json').status_code, 200)
        self.assertEqual(CommentLike.objects.filter(comment=reason).count(), 2)
        alice_view = next(r for r in self.visible(self.a) if r['id'] == reason.pk)
        bob_view = next(r for r in self.visible(self.b) if r['id'] == reason.pk)
        self.assertEqual((alice_view['like_count'], alice_view['dislike_count']), (1, 1))
        self.assertEqual(alice_view['viewer_reaction'], 'dislike')
        self.assertEqual(bob_view['viewer_reaction'], 'like')
