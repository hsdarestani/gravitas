from django.test import TestCase

from .models import ResearchIntelligenceEvent, ResearchIntelligenceItem, ResearchIntelligenceRun
from .research_intelligence_history import history_payload, persist_payload


def payload(tool_stars=10, funding_status='open'):
    return {
        'ok': True,
        'generated_at': '2026-09-20T10:00:00+00:00',
        'funding': [{
            'id': 'eu:test-call',
            'kind': 'funding',
            'source': 'EU Funding & Tenders',
            'title': 'AI for research call',
            'summary': 'Funding for AI in research.',
            'status': funding_status,
            'open_date': '2026-09-01',
            'close_date': '2026-12-01',
            'award_ceiling': '',
            'award_floor': '',
            'template_available': False,
            'template_names': [],
            'attachment_count': 0,
            'eligibility': [],
            'categories': ['Horizon Europe'],
            'url': 'https://example.test/call',
            'relevance': 90,
        }],
        'papers_tools': [{
            'id': 'repo-1',
            'kind': 'tool',
            'source': 'GitHub',
            'title': 'example/research-agent',
            'summary': 'Research assistant.',
            'language': 'Python',
            'stars': tool_stars,
            'date': '2026-09-20',
            'topics': ['research'],
            'url': 'https://github.com/example/research-agent',
            'relevance': 80,
        }],
        'developments': [],
        'sources': {},
        'errors': [],
    }


class ResearchIntelligenceHistoryTests(TestCase):
    def test_first_collection_creates_new_events(self):
        run, counts = persist_payload(payload())

        self.assertEqual(run.status, ResearchIntelligenceRun.Status.SUCCESS)
        self.assertEqual(counts['new'], 2)
        self.assertEqual(counts['updated'], 0)
        self.assertEqual(ResearchIntelligenceItem.objects.count(), 2)
        self.assertEqual(
            ResearchIntelligenceEvent.objects.filter(
                event_type=ResearchIntelligenceEvent.EventType.NEW
            ).count(),
            2,
        )

    def test_identical_collection_does_not_duplicate_history(self):
        persist_payload(payload())
        persist_payload(payload())

        self.assertEqual(ResearchIntelligenceItem.objects.count(), 2)
        self.assertEqual(ResearchIntelligenceEvent.objects.count(), 2)

    def test_only_significant_changes_create_update_event(self):
        persist_payload(payload(tool_stars=10, funding_status='open'))
        # Star count is deliberately noisy and should not create a history event.
        persist_payload(payload(tool_stars=11, funding_status='open'))
        self.assertEqual(ResearchIntelligenceEvent.objects.count(), 2)

        persist_payload(payload(tool_stars=11, funding_status='closed'))
        updated = ResearchIntelligenceEvent.objects.filter(
            event_type=ResearchIntelligenceEvent.EventType.UPDATED
        ).get()

        self.assertIn('status', updated.changed_fields)
        self.assertEqual(ResearchIntelligenceEvent.objects.count(), 3)

    def test_history_payload_is_dashboard_ready(self):
        persist_payload(payload())
        history = history_payload(10)

        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]['event_type'], 'new')
        self.assertTrue(history[0]['title'])
        self.assertIn('date', history[0])
