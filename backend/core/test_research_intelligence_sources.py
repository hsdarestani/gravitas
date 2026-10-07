from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from .research_intelligence_api import _build_payload
from .research_intelligence_sources import (
    DEFAULT_SOURCE_IDS,
    get_source_profile,
    sanitise_source_profile,
    save_source_profile,
    validate_public_https_url,
)


class ResearchIntelligenceSourceProfileTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='ri-source-user',
            email='ri-source@example.com',
            password='test-password',
        )

    def test_recommended_defaults_are_europe_first(self):
        profile = get_source_profile(self.user)
        self.assertIn('eu_funding', profile['enabled_sources'])
        self.assertIn('ukri_funding', profile['enabled_sources'])
        self.assertIn('dfg_funding', profile['enabled_sources'])
        self.assertNotIn('grants_gov', profile['enabled_sources'])

    def test_profile_can_disable_every_builtin_source(self):
        profile = save_source_profile(
            self.user,
            {'enabled_sources': [], 'custom_sources': []},
        )
        self.assertEqual(profile['enabled_sources'], [])
        self.assertEqual(get_source_profile(self.user)['enabled_sources'], [])

    def test_custom_feed_requires_public_https(self):
        with self.assertRaisesRegex(ValueError, 'source_url_https_required'):
            validate_public_https_url('http://example.com/feed.xml')
        with self.assertRaisesRegex(ValueError, 'source_url_private_host'):
            validate_public_https_url('https://127.0.0.1/feed.xml')
        with self.assertRaisesRegex(ValueError, 'source_url_private_host'):
            validate_public_https_url('https://10.0.0.8/feed.xml')

    def test_custom_feed_is_normalised(self):
        enabled, custom = sanitise_source_profile(
            list(DEFAULT_SOURCE_IDS),
            [{
                'name': '  European Research Feed  ',
                'url': 'https://1.1.1.1/feed.xml',
                'kind': 'funding',
            }],
        )
        self.assertIn('eu_funding', enabled)
        self.assertEqual(custom[0]['name'], 'European Research Feed')
        self.assertEqual(custom[0]['kind'], 'funding')
        self.assertTrue(custom[0]['id'].startswith('custom:'))


class ResearchIntelligenceSelectedFetchTests(TestCase):
    @patch('core.research_intelligence_api._developments')
    @patch('core.research_intelligence_api._github_tools')
    @patch('core.research_intelligence_api._arxiv_papers')
    @patch('core.research_intelligence_api._ukri_funding_calls')
    @patch('core.research_intelligence_api._funding_calls')
    @patch('core.research_intelligence_api._eu_funding_calls')
    def test_only_selected_builtin_sources_are_fetched(
        self,
        eu,
        grants,
        ukri,
        arxiv,
        github,
        developments,
    ):
        eu.return_value = []
        payload = _build_payload(['eu_funding'], [])
        eu.assert_called_once()
        grants.assert_not_called()
        ukri.assert_not_called()
        arxiv.assert_not_called()
        github.assert_not_called()
        developments.assert_not_called()
        self.assertEqual(payload['sources']['funding'], ['EU Funding & Tenders'])
        self.assertEqual(payload['papers_tools'], [])
        self.assertEqual(payload['developments'], [])

    @patch('core.research_intelligence_api._eu_funding_calls')
    def test_empty_source_selection_fetches_nothing(self, eu):
        payload = _build_payload([], [])
        eu.assert_not_called()
        self.assertEqual(payload['funding'], [])
        self.assertEqual(payload['sources']['funding'], [])
