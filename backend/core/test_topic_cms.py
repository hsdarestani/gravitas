import json
from django.contrib.auth import get_user_model
from django.test import TestCase
from .models import Comment, CommentLike, ContentItem, TopicPollVote


class TopicCmsTests(TestCase):
    def setUp(self):
        self.topic = ContentItem.objects.get(slug='computable-universe')

    def test_seeded_topic_is_public_and_structured(self):
        response = self.client.get('/api/content/?kind=topic')
        self.assertEqual(response.status_code, 200)
        item = next(row for row in response.json()['items'] if row['slug'] == self.topic.slug)
        self.assertEqual(item['kind'], 'topic')
        self.assertIn('essay', item['topic_data'])
        self.assertIn('timeline', item['topic_data'])
        self.assertIn('viewpoints', item['topic_data'])

    def test_anonymous_poll_vote_is_session_scoped(self):
        option = self.topic.topic_data['viewpoints']['poll_options'][0]['id']
        response = self.client.post(
            f'/api/content/{self.topic.slug}/poll/',
            data=json.dumps({'option_id': option}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['poll']['selected'], option)
        self.assertEqual(TopicPollVote.objects.filter(topic=self.topic).count(), 1)

    def test_reply_and_like(self):
        User = get_user_model()
        author = User.objects.create_user(username='author', email='author@example.com', password='strong-pass-123')
        reader = User.objects.create_user(username='reader', email='reader@example.com', password='strong-pass-123')
        parent = Comment.objects.create(author=author, content_key=self.topic.slug, body='Parent', status=Comment.Status.PUBLISHED)
        self.client.force_login(reader)
        reply = self.client.post(
            f'/api/community/comments/{self.topic.slug}/',
            data=json.dumps({'body': 'Reply', 'parent_id': parent.pk}),
            content_type='application/json',
        )
        self.assertEqual(reply.status_code, 201)
        self.assertEqual(reply.json()['comment']['parent_id'], parent.pk)
        like = self.client.post(f'/api/community/comments/{self.topic.slug}/{parent.pk}/like/')
        self.assertEqual(like.status_code, 200)
        self.assertTrue(like.json()['liked'])
        self.assertEqual(CommentLike.objects.filter(comment=parent, user=reader).count(), 1)
