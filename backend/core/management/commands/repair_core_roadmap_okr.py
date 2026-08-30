from django.core.management.base import BaseCommand, CommandError

from core.operating_models import KeyResult, StrategicObjective, WorkStatus
from core.platform_models import WorkspaceProfile
from core.roadmap_okr import ROADMAP_PERIOD, sync_workspace_okr


class Command(BaseCommand):
    help = 'Ensure the canonical Core workspace contains the active Gravitas Roadmap OKRs.'

    def handle(self, *args, **options):
        core = (
            WorkspaceProfile.objects.filter(purpose=WorkspaceProfile.Purpose.CORE)
            .select_related('workspace')
            .order_by('workspace_id')
            .first()
        )
        if not core:
            raise CommandError('canonical_core_workspace_missing')
        workspace = core.workspace

        def counts():
            objectives = StrategicObjective.objects.filter(
                workspace=workspace,
                quarter=ROADMAP_PERIOD,
                status=WorkStatus.ACTIVE,
            )
            return (
                objectives.count(),
                KeyResult.objects.filter(
                    objective__in=objectives,
                    status=WorkStatus.ACTIVE,
                ).count(),
            )

        objective_count, kr_count = counts()
        repaired = False
        if objective_count < 4 or kr_count < 4:
            sync_workspace_okr(workspace)
            repaired = True
            objective_count, kr_count = counts()

        if objective_count < 4 or kr_count < 4:
            raise CommandError(
                f'core_roadmap_incomplete objectives={objective_count} key_results={kr_count}'
            )

        self.stdout.write(
            self.style.SUCCESS(
                f'core roadmap ready objectives={objective_count} '
                f'key_results={kr_count} repaired={str(repaired).lower()}'
            )
        )
