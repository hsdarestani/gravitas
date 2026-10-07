import json
from django.contrib.auth import get_user_model
from django.test import TestCase
from .models import Comment, CommentLike, ContentItem, TopicPollVote
from .topic_progress import topic_applicability


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

    def test_topic_supports_unlimited_repeatable_section_objects(self):
        data = dict(self.topic.topic_data)
        data['videos'] = [
            {'source_type': 'youtube', 'youtube_url': 'https://www.youtube.com/watch?v=one'},
            {'source_type': 'self_hosted', 'self_hosted_url': '/api/content/media/two.mp4'},
        ]
        data['video'] = {}
        data['essays'] = [
            {'title': 'Essay one', 'overview_html': '<p>One</p>'},
            {'title': 'Essay two', 'overview_html': '<p>Two</p>'},
        ]
        data['essay'] = {}
        data['simulations'] = [
            {'title': 'Simulation one', 'code': 'document.body.textContent="one"'},
            {'title': 'Simulation two', 'code': 'document.body.textContent="two"'},
        ]
        data['simulation'] = {}
        data['viewpoints'] = {
            'items': [
                {'label': 'A', 'text': 'First'},
                {'label': 'B', 'text': 'Second'},
                {'label': 'C', 'text': 'Third'},
            ],
            'polls': [
                {
                    'id': 'poll-a',
                    'question': 'Choose A',
                    'options': [
                        {'id': f'option-{index}', 'label': f'Option {index}'}
                        for index in range(25)
                    ],
                },
                {
                    'id': 'poll-b',
                    'question': 'Choose B',
                    'options': [
                        {'id': 'yes', 'label': 'Yes'},
                        {'id': 'no', 'label': 'No'},
                    ],
                },
            ],
        }
        self.topic.topic_data = data
        self.topic.save(update_fields=['topic_data'])

        response = self.client.get('/api/content/?kind=topic')
        self.assertEqual(response.status_code, 200)
        item = next(row for row in response.json()['items'] if row['slug'] == self.topic.slug)
        self.assertEqual(len(item['topic_data']['videos']), 2)
        self.assertEqual(len(item['topic_data']['essays']), 2)
        self.assertEqual(len(item['topic_data']['simulations']), 2)
        self.assertEqual(len(item['topic_data']['viewpoints']['items']), 3)
        self.assertTrue(topic_applicability(self.topic)['video'])
        self.assertTrue(topic_applicability(self.topic)['simulation'])

        first_poll = self.client.get(f'/api/content/{self.topic.slug}/poll/?poll_id=poll-a')
        self.assertEqual(first_poll.status_code, 200)
        self.assertEqual(len(first_poll.json()['poll']['options']), 25)
        second_poll = self.client.get(f'/api/content/{self.topic.slug}/poll/?poll_id=poll-b')
        self.assertEqual(second_poll.status_code, 200)
        self.assertEqual(len(second_poll.json()['poll']['options']), 2)
        self.assertTrue(topic_applicability(self.topic)['vote'])

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

    def test_same_session_can_vote_in_multiple_polls(self):
        data = dict(self.topic.topic_data)
        data['viewpoints'] = {
            'polls': [
                {'id': 'first', 'question': 'First?', 'options': [{'id': 'a', 'label': 'A'}]},
                {'id': 'second', 'question': 'Second?', 'options': [{'id': 'b', 'label': 'B'}]},
            ],
        }
        self.topic.topic_data = data
        self.topic.save(update_fields=['topic_data'])

        one = self.client.post(
            f'/api/content/{self.topic.slug}/poll/',
            data=json.dumps({'poll_id': 'first', 'option_id': 'a'}),
            content_type='application/json',
        )
        two = self.client.post(
            f'/api/content/{self.topic.slug}/poll/',
            data=json.dumps({'poll_id': 'second', 'option_id': 'b'}),
            content_type='application/json',
        )
        self.assertEqual(one.status_code, 200)
        self.assertEqual(two.status_code, 200)
        self.assertEqual(TopicPollVote.objects.filter(topic=self.topic).count(), 2)
        self.assertEqual(
            set(TopicPollVote.objects.filter(topic=self.topic).values_list('poll_id', flat=True)),
            {'first', 'second'},
        )

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
