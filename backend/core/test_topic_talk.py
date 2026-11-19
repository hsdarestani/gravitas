"""The Topic page's conversation parts: anchored comments, reactions, a
member's own comments while they wait for review, editing and deleting, and
the sealed Viewpoints poll whose results close the vote when seen first."""
import json

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import Comment, CommentLike, ContentItem, TopicPollVote


class TopicTalkTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.topic = ContentItem.objects.get(slug='answer-that-looked-right')
        self.author = User.objects.create_user(username='author', email='author@example.com', password='strong-pass-123', first_name='Amara')
        self.reader = User.objects.create_user(username='reader', email='reader@example.com', password='strong-pass-123')
        self.key = 'answer-that-looked-right-essay-1-annotations'

    def post(self, url, payload=None, method='post'):
        return getattr(self.client, method)(url, data=json.dumps(payload or {}), content_type='application/json')

    def test_an_annotation_keeps_its_anchor_and_drops_anything_else(self):
        self.client.force_login(self.author)
        response = self.post(f'/api/community/comments/{self.key}/', {
            'body': 'Plausible is not true.',
            'anchor': {'kind': 'passage', 'level': 'researcher', 'quote': 'the most plausible next words',
                       'prefix': 'writes ', 'suffix': '.', 'script': '<b>x</b>', 't': 'soon'},
        })
        self.assertEqual(response.status_code, 201)
        anchor = response.json()['comment']['anchor']
        self.assertEqual(anchor['quote'], 'the most plausible next words')
        self.assertEqual(anchor['prefix'], 'writes ')
        self.assertNotIn('script', anchor)
        self.assertNotIn('t', anchor)
        self.assertEqual(Comment.objects.get().anchor['kind'], 'passage')

    def test_a_video_moment_is_whole_seconds_and_an_unknown_kind_is_dropped(self):
        self.client.force_login(self.author)
        response = self.post('/api/community/comments/answer-that-looked-right-video-1/', {
            'body': 'This is where it turns.', 'anchor': {'kind': 'everything', 't': 134.7},
        })
        anchor = response.json()['comment']['anchor']
        self.assertEqual(anchor, {'t': 134})

    def test_the_author_sees_their_pending_comment_and_nobody_else_does(self):
        Comment.objects.create(author=self.author, content_key=self.key, body='Waiting', status=Comment.Status.PENDING)
        Comment.objects.create(author=self.reader, content_key=self.key, body='Published', status=Comment.Status.PUBLISHED)
        self.assertEqual([c['body'] for c in self.client.get(f'/api/community/comments/{self.key}/').json()['comments']], ['Published'])
        self.client.force_login(self.author)
        rows = self.client.get(f'/api/community/comments/{self.key}/').json()['comments']
        self.assertEqual({c['body']: (c['status'], c['mine']) for c in rows},
                         {'Waiting': ('pending', True), 'Published': ('published', False)})
        self.client.force_login(self.reader)
        self.assertEqual([c['body'] for c in self.client.get(f'/api/community/comments/{self.key}/').json()['comments']], ['Published'])

    def test_like_and_dislike_are_one_reaction_that_can_change_or_clear(self):
        comment = Comment.objects.create(author=self.author, content_key=self.key, body='Hi', status=Comment.Status.PUBLISHED)
        self.client.force_login(self.reader)
        url = f'/api/community/comments/{self.key}/{comment.pk}/reaction/'
        self.assertEqual(self.post(url, {'value': 'dislike'}).json()['dislike_count'], 1)
        changed = self.post(url, {'value': 'like'}).json()
        self.assertEqual((changed['like_count'], changed['dislike_count']), (1, 0))
        self.assertEqual(CommentLike.objects.filter(comment=comment).count(), 1)
        cleared = self.post(url, {'value': ''}).json()
        self.assertEqual((cleared['like_count'], cleared['dislike_count']), (0, 0))
        self.assertEqual(self.post(url, {'value': 'love'}).status_code, 400)

    def test_the_list_counts_likes_and_dislikes_apart_and_says_what_the_viewer_chose(self):
        comment = Comment.objects.create(author=self.author, content_key=self.key, body='Hi', status=Comment.Status.PUBLISHED)
        CommentLike.objects.create(comment=comment, user=self.author)
        CommentLike.objects.create(comment=comment, user=self.reader, value='dislike')
        self.client.force_login(self.reader)
        row = self.client.get(f'/api/community/comments/{self.key}/').json()['comments'][0]
        self.assertEqual((row['like_count'], row['dislike_count'], row['viewer_reaction']), (1, 1, 'dislike'))
        self.assertFalse(row['viewer_liked'])

    def test_the_old_like_toggle_still_counts_likes_only(self):
        comment = Comment.objects.create(author=self.author, content_key=self.key, body='Hi', status=Comment.Status.PUBLISHED)
        CommentLike.objects.create(comment=comment, user=self.author, value='dislike')
        self.client.force_login(self.reader)
        first = self.client.post(f'/api/community/comments/{self.key}/{comment.pk}/like/').json()
        self.assertEqual((first['liked'], first['like_count']), (True, 1))
        second = self.client.post(f'/api/community/comments/{self.key}/{comment.pk}/like/').json()
        self.assertEqual((second['liked'], second['like_count']), (False, 0))

    def test_an_edit_goes_back_to_the_moderator_and_only_the_author_may_edit(self):
        comment = Comment.objects.create(author=self.author, content_key=self.key, body='First', status=Comment.Status.PUBLISHED)
        url = f'/api/community/comments/{self.key}/{comment.pk}/'
        self.client.force_login(self.reader)
        self.assertEqual(self.post(url, {'body': 'Hijack'}, method='patch').status_code, 404)
        self.client.force_login(self.author)
        response = self.post(url, {'body': 'Second'}, method='patch')
        self.assertEqual(response.json()['moderation'], 'pending')
        comment.refresh_from_db()
        self.assertEqual((comment.body, comment.status), ('Second', 'pending'))

    def test_an_author_can_delete_their_own_comment(self):
        comment = Comment.objects.create(author=self.author, content_key=self.key, body='Gone', status=Comment.Status.PENDING)
        url = f'/api/community/comments/{self.key}/{comment.pk}/'
        self.client.force_login(self.reader)
        self.assertEqual(self.client.delete(url).status_code, 404)
        self.client.force_login(self.author)
        self.assertTrue(self.client.delete(url).json()['deleted'])
        self.assertFalse(Comment.objects.filter(pk=comment.pk).exists())


class SealedPollTests(TestCase):
    def setUp(self):
        self.topic = ContentItem.objects.get(slug='answer-that-looked-right')
        data = dict(self.topic.topic_data)
        data['viewpoints'] = dict(data.get('viewpoints') or {}, polls=[
            {'id': 'trust', 'question': 'How far?', 'kind': 'scale', 'options': [{'id': 'never', 'label': 'Never'}, {'id': 'always', 'label': 'Always'}]},
        ])
        self.topic.topic_data = data
        self.topic.save(update_fields=['topic_data'])
        self.url = f'/api/content/{self.topic.slug}/poll/'
        TopicPollVote.objects.create(topic=self.topic, voter_key='someone-else', poll_id='trust', option_id='never')

    def vote(self, option):
        return self.client.post(self.url, data=json.dumps({'poll_id': 'trust', 'option_id': option}), content_type='application/json')

    def test_sealed_counts_are_withheld_until_the_reader_answers(self):
        poll = self.client.get(self.url + '?poll_id=trust&sealed=1').json()['poll']
        self.assertTrue(poll['sealed'])
        self.assertEqual(poll['total_votes'], 1)
        self.assertEqual({o['votes'] for o in poll['options']}, {None})
        self.assertEqual(self.vote('always').status_code, 200)
        poll = self.client.get(self.url + '?poll_id=trust&sealed=1').json()['poll']
        self.assertFalse(poll['sealed'])
        self.assertEqual({o['id']: o['votes'] for o in poll['options']}, {'never': 1, 'always': 1})

    def test_an_unsealed_read_is_unchanged_for_the_other_pages(self):
        poll = self.client.get(self.url + '?poll_id=trust').json()['poll']
        self.assertFalse(poll['sealed'])
        self.assertEqual(poll['options'][0]['votes'], 1)

    def test_seeing_the_results_first_closes_the_vote_for_that_session(self):
        poll = self.client.get(self.url + '?poll_id=trust&sealed=1&reveal=1').json()['poll']
        self.assertTrue(poll['seen_first'])
        self.assertEqual(poll['options'][0]['votes'], 1)
        refused = self.vote('always')
        self.assertEqual(refused.status_code, 409)
        self.assertEqual(refused.json()['error'], 'results_seen_first')
        self.assertEqual(TopicPollVote.objects.filter(poll_id='trust').count(), 1)

    def test_a_reader_who_answered_can_look_and_still_change_their_answer(self):
        self.vote('never')
        self.client.get(self.url + '?poll_id=trust&sealed=1&reveal=1')
        self.assertEqual(self.vote('always').status_code, 200)
        self.assertEqual(TopicPollVote.objects.exclude(voter_key='someone-else').get().option_id, 'always')
