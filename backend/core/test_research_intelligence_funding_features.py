from django.test import SimpleTestCase

from .research_intelligence_api import (
    _classify_applicant_scope,
    _funding_metadata,
    _iso_date,
)


class ResearchIntelligenceFundingFeatureTests(SimpleTestCase):
    def test_ukri_style_dates_are_normalized(self):
        self.assertEqual(_iso_date('23 September 2026'), '2026-09-23')
        self.assertEqual(_iso_date('7 Oct 2026'), '2026-10-07')

    def test_applicant_scope_supports_individual_team_and_institution(self):
        self.assertIn('individual', _classify_applicant_scope('postdoctoral fellowship for researchers'))
        self.assertIn('team', _classify_applicant_scope('collaborative consortium team'))
        self.assertIn('company_institution', _classify_applicant_scope('university and company applicants'))

    def test_funding_metadata_marks_old_deadlines_archived(self):
        item = {
            'title': 'AI research fellowship',
            'summary': 'Artificial intelligence research opportunity',
            'close_date': '2000-01-01',
            'eligibility': ['Individual researchers may apply'],
            'categories': ['Research'],
        }
        metadata = _funding_metadata(
            item,
            geography_scope='country',
            geographies=['United Kingdom'],
            region='Europe',
        )
        self.assertTrue(metadata['archived'])
        self.assertIn('individual', metadata['applicant_scope'])
        self.assertIn('topic', metadata['relevance_factors'])
        self.assertIn('ai', metadata['relevance_factors'])
        self.assertIn('deadline', metadata['relevance_factors'])

    def test_explicit_worldwide_eligibility_becomes_international(self):
        item = {
            'title': 'Research grant',
            'summary': 'Open research call',
            'close_date': '2099-01-01',
            'eligibility': ['International applicants from any country are eligible worldwide'],
            'categories': ['Research'],
        }
        metadata = _funding_metadata(
            item,
            geography_scope='country',
            geographies=['United States'],
            region='North America',
        )
        self.assertEqual(metadata['geography_scope'], 'international')
        self.assertEqual(metadata['geographies'], ['International'])
