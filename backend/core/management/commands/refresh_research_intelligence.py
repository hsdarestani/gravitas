from django.core.management.base import BaseCommand

from core.models import ResearchIntelligenceRun
from core.research_intelligence_api import _build_payload
from core.research_intelligence_history import mark_run_failed, persist_payload


class Command(BaseCommand):
    help = 'Collect Research Intelligence sources and persist new/changed items to history.'

    def handle(self, *args, **options):
        run = ResearchIntelligenceRun.objects.create(status=ResearchIntelligenceRun.Status.RUNNING)
        try:
            payload = _build_payload()
            run, counts = persist_payload(payload, run=run)
        except Exception as exc:
            mark_run_failed(run, exc)
            raise

        self.stdout.write(
            self.style.SUCCESS(
                'Research Intelligence refreshed: '
                f"funding={counts['funding']} "
                f"papers_tools={counts['papers_tools']} "
                f"developments={counts['developments']} "
                f"new={counts['new']} updated={counts['updated']} "
                f"status={run.status}"
            )
        )
