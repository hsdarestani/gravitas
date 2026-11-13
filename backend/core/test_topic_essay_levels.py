"""Reading levels and the "Was this essay useful?" answer on Topic 01."""
from django.test import TestCase
from django.utils import timezone

from .models import TopicEssayPublication, TopicEssayReaction
from .topic_essay_sources import SLOTS, SOURCE_PATHS, slot_label

PUBLIC_URL = '/api/topics/answer-that-looked-right/essays/'


def publish(slot, text='# Title\n\nBody.'):
    return TopicEssayPublication.objects.create(
        depth=slot, source_path=SOURCE_PATHS[slot], source_etag='"1"', markdown=text, published_at=timezone.now(),
    )


class EssayLevelTests(TestCase):
    def test_every_slot_names_one_essay_at_one_level(self):
        self.assertEqual(set(SLOTS), set(TopicEssayPublication.Depth.values))
        self.assertEqual(len(set(SLOTS.values())), len(SLOTS))
        self.assertEqual(SLOTS['overview'], (1, 'researcher'))
        self.assertEqual(SLOTS['deep'], (2, 'researcher'))
        self.assertEqual(slot_label('e2-curious'), 'Essay 2 · Curious')
        self.assertEqual(len(set(SOURCE_PATHS.values())), len(SOURCE_PATHS))

    def test_public_essays_say_which_essay_and_level_they_are(self):
        publish('overview')
        publish('e1-curious', '# Title\n\nSimple.')
        essays = self.client.get(PUBLIC_URL).json()['essays']
        self.assertEqual((essays['overview']['essay'], essays['overview']['level']), (1, 'researcher'))
        self.assertEqual((essays['e1-curious']['essay'], essays['e1-curious']['level']), (1, 'curious'))
        self.assertEqual(essays['e1-curious']['label'], 'Essay 1')
        self.assertIn('Simple.', essays['e1-curious']['html'])


class EssayReactionTests(TestCase):
    def url(self, essay):
        return f'/api/topics/answer-that-looked-right/essays/{essay}/reaction/'

    def test_unpublished_essay_cannot_be_answered(self):
        self.assertEqual(self.client.get(self.url(1)).status_code, 404)
        publish('overview')
        self.assertEqual(self.client.get(self.url(2)).status_code, 404)
        self.assertEqual(self.client.get(self.url(3)).status_code, 404)

    def test_answer_is_one_per_reader_changeable_and_counted(self):
        publish('e1-curious')
        empty = self.client.get(self.url(1)).json()['reaction']
        self.assertEqual((empty['useful'], empty['not_useful'], empty['selected']), (0, 0, ''))

        first = self.client.post(self.url(1), {'value': 'useful'}, content_type='application/json').json()['reaction']
        self.assertEqual((first['useful'], first['selected']), (1, 'useful'))
        changed = self.client.post(self.url(1), {'value': 'not_useful'}, content_type='application/json').json()['reaction']
        self.assertEqual((changed['useful'], changed['not_useful'], changed['selected']), (0, 1, 'not_useful'))
        self.assertEqual(TopicEssayReaction.objects.count(), 1)

        other = self.client_class()
        other.post(self.url(1), {'value': 'useful'}, content_type='application/json')
        both = self.client.get(self.url(1)).json()['reaction']
        self.assertEqual((both['useful'], both['not_useful']), (1, 1))

        withdrawn = self.client.post(self.url(1), {'value': ''}, content_type='application/json').json()['reaction']
        self.assertEqual((withdrawn['not_useful'], withdrawn['selected']), (0, ''))

    def test_unknown_value_is_refused(self):
        publish('overview')
        result = self.client.post(self.url(1), {'value': 'love'}, content_type='application/json')
        self.assertEqual(result.status_code, 400)
        self.assertFalse(TopicEssayReaction.objects.exists())


class PollKindTests(TestCase):
    """A scale poll is drawn as a slider; the route says which kind it is."""

    def test_poll_reports_its_kind_and_defaults_to_choice(self):
        from .models import ContentItem
        ContentItem.objects.create(
            kind=ContentItem.Kind.TOPIC, status=ContentItem.Status.PUBLISHED, slug='kind-topic', title='Kinds',
            topic_data={'viewpoints': {'polls': [
                {'id': 'rely', 'question': 'How far?', 'kind': 'scale', 'options': [{'id': 'never', 'label': 'Never'}, {'id': 'always', 'label': 'Always'}]},
                {'id': 'who', 'question': 'Who checks?', 'kind': 'anything', 'options': [{'id': 'me', 'label': 'Me'}]},
            ]}},
        )
        scale = self.client.get('/api/content/kind-topic/poll/?poll_id=rely').json()['poll']
        self.assertEqual(scale['kind'], 'scale')
        self.assertEqual([o['id'] for o in scale['options']], ['never', 'always'])
        choice = self.client.get('/api/content/kind-topic/poll/?poll_id=who').json()['poll']
        self.assertEqual(choice['kind'], 'choice')
