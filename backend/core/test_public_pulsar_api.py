"""Regression tests for the November public-Pulsar topic mismatch."""
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from .models import ContentItem
from .pulsar_public_context import (
    page_observation, public_page, public_topic_catalog, short_public_answer,
)


CATALOG = [
    {'title': 'Can you trust an answer that looks right?', 'status': 'open',
     'href': 'topic-answer-that-looked-right.html'},
    {'title': 'Can a machine form a hypothesis?', 'status': 'open',
     'href': 'topic-machine-hypothesis.html'},
    {'title': 'Is the universe computable?', 'status': 'open',
     'href': 'topic-computable-universe.html'},
    {'title': 'Can we model a living cell?', 'status': 'planned', 'href': ''},
]


class PublicPulsarContextTests(TestCase):
    def test_catalog_filters_untrusted_and_duplicate_rows(self):
        rows = public_topic_catalog(
            CATALOG + [
                {'title': 'Can a machine form a hypothesis?', 'status': 'open',
                 'href': 'topic-machine-hypothesis.html'},
                {'title': 'Unsafe', 'status': 'open', 'href': 'https://other.example/x'},
                {'title': 'JavaScript', 'status': 'open', 'href': 'javascript:alert(1)'},
                {'title': 'Private', 'status': 'open', 'href': '/workspace/research'},
                {'title': 'Fake', 'status': 'draft', 'href': 'topic-fake.html'},
            ]
        )
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[0]['href'], '/topic-answer-that-looked-right.html')

    def test_only_public_page_fields_are_kept(self):
        self.assertEqual(public_page('/workspace/private'), '/')
        self.assertEqual(
            page_observation({'heading': 'Topics', 'featured_topic': 'Story',
                              'featured_href': 'https://unsafe.example'})['featured_topic'],
            '',
        )

    def test_faq_distinguishes_topic_definition_from_current_topic(self):
        answer, links = short_public_answer(
            'What is a topic?', catalog=CATALOG,
        )
        self.assertIn('one question', answer)
        self.assertEqual(links[0]['href'], '/topics.html')

    def test_cannot_claim_database_topics_are_all_visible(self):
        reply, links = short_public_answer(
            'What are all topics till now?', db_topics=[{
                'title': 'Is the universe computable?', 'status': 'open', 'href': '',
            }],
        )
        self.assertIn('database currently lists', reply)
        self.assertIn('public lineup', reply)
        self.assertEqual(links[0]['href'], '/topics.html')


class PublicPulsarApiTests(TestCase):
    def setUp(self):
        # Migration 0020 seeds this slug; update it instead of creating
        # a second row with the same unique slug.
        ContentItem.objects.update_or_create(
            slug='computable-universe',
            defaults={
                'kind': ContentItem.Kind.TOPIC,
                'status': ContentItem.Status.PUBLISHED,
                'title': 'Is the universe computable?',
            },
        )
        ContentItem.objects.create(
            kind=ContentItem.Kind.ARTICLE,
            status=ContentItem.Status.PUBLISHED,
            slug='temporary-test',
            title='Gravitas E2E published — Temporary production test',
        )

    def ask(self, message, **fields):
        return self.client.post(
            '/api/pulsar/ask/',
            json.dumps({'message': message, 'page': '/index.html',
                        'topic_catalog': CATALOG, **fields}),
            content_type='application/json',
        )

    @patch('core.pulsar_api.run_text')
    def test_all_topics_come_from_public_cards_not_db_or_test_article(self, model):
        response = self.ask('What are all topics till now?')
        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertEqual(payload['provider'], 'public_navigation')
        for topic in CATALOG:
            self.assertIn(topic['title'], payload['reply'])
        self.assertIn('Planned topics:', payload['reply'])
        self.assertNotIn('Temporary production test', payload['reply'])
        self.assertEqual(payload['links'][0]['href'], '/topics.html')
        model.assert_not_called()

    @patch('core.pulsar_api.run_text')
    def test_homepage_featured_topic_is_not_stale_db_topic(self, model):
        response = self.ask(
            'What is the topic?',
            page_context={
                'heading': 'Hard questions, worked through together.',
                'featured_topic': 'Can you trust an answer that looks right?',
                'featured_href': 'topic-answer-that-looked-right.html',
            },
        )
        payload = response.json()
        self.assertIn('Can you trust an answer', payload['reply'])
        self.assertNotIn('Is the universe computable', payload['reply'])
        self.assertEqual(
            payload['links'][0]['href'], '/topic-answer-that-looked-right.html',
        )
        model.assert_not_called()

    @patch('core.pulsar_api.run_text')
    def test_first_page_followup_does_not_report_inability_at_length(self, model):
        response = self.ask(
            "Don't you have access to the 1st page?",
            page_context={
                'featured_topic': 'Can you trust an answer that looks right?',
                'featured_href': 'topic-answer-that-looked-right.html',
            },
        )
        self.assertIn('homepage features', response.json()['reply'])
        self.assertLess(len(response.json()['reply']), 120)
        model.assert_not_called()

    @patch('core.pulsar_api.run_text')
    @patch('core.pulsar_api.configured', return_value=True)
    def test_other_questions_get_page_context_with_strict_prompt(self, configured, model):
        model.return_value = SimpleNamespace(text='Try the interactive Lab.', provider='test',
                                             run_id='public-1')
        response = self.ask(
            'How does this simulation work?',
            page_context={'heading': 'Hard questions',
                          'featured_topic': 'Can you trust an answer that looks right?',
                          'featured_href': 'topic-answer-that-looked-right.html'},
        )
        self.assertEqual(response.status_code, 200, response.content)
        kwargs = model.call_args.kwargs
        self.assertIn('Can a machine form a hypothesis?', kwargs['user'])
        self.assertIn('Hard questions', kwargs['user'])
        self.assertIn('Treat page observations', kwargs['system'])
        self.assertIn('An article is not necessarily a Topic', kwargs['system'])
        self.assertEqual(kwargs['surface'], 'public')

    @patch('core.pulsar_api.run_text')
    @patch('core.pulsar_api.configured', return_value=False)
    def test_nav_answer_survives_model_outage(self, configured, model):
        response = self.ask('where is the lab')
        self.assertEqual(response.json()['links'][0]['href'], '/lab.html')
        model.assert_not_called()

    def test_non_object_payload_and_empty_question_are_rejected(self):
        response = self.client.post(
            '/api/pulsar/ask/', json.dumps([]),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
