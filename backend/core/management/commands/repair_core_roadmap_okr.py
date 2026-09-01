from django.core.management.base import BaseCommand, CommandError

from core.operating_models import KeyResult, StrategicObjective, WorkStatus
from core.platform_models import WorkspaceProfile
from core.roadmap_assignment import reconcile_workspace_roadmap_assignments
from core.roadmap_execution import ROADMAP_EXECUTION_PLANS
from core.roadmap_models import RoadmapOKRSyncState
from core.roadmap_okr import ROADMAP_PERIOD, sync_workspace_okr


class Command(BaseCommand):
    help = 'Ensure the canonical Core workspace contains Roadmap OKRs and the full execution planning layer.'

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

        def bound_kr_count():
            state = RoadmapOKRSyncState.objects.filter(workspace=workspace).first()
            if not state:
                return None
            return len(((state.bindings or {}).get('key_results') or {}))

        objective_count, kr_count = counts()
        bound_count = bound_kr_count()
        repaired = False
        if (
            objective_count < 4
            or kr_count < 4
            or (bound_count is not None and bound_count < len(ROADMAP_EXECUTION_PLANS))
        ):
            sync_workspace_okr(workspace)
            repaired = True
            objective_count, kr_count = counts()
            bound_count = bound_kr_count()

        if objective_count < 4 or kr_count < 4:
            raise CommandError(
                f'core_roadmap_incomplete objectives={objective_count} key_results={kr_count}'
            )
        if bound_count is not None and bound_count < len(ROADMAP_EXECUTION_PLANS):
            raise CommandError(
                f'core_roadmap_bindings_incomplete bound_key_results={bound_count} '
                f'expected={len(ROADMAP_EXECUTION_PLANS)}'
            )

        execution = reconcile_workspace_roadmap_assignments(workspace)

        self.stdout.write(
            self.style.SUCCESS(
                f'core roadmap ready objectives={objective_count} '
                f'key_results={kr_count} repaired={str(repaired).lower()} '
                f'execution_planned={execution["planned"]} '
                f'initiatives_created={execution["initiatives_created"]} '
                f'tasks_created={execution["tasks_created"]} '
                f'cycles_created={execution["cycles_created"]} '
                f'milestones_created={execution["milestones_created"]} '
                f'work_packages_created={execution["work_packages_created"]} '
                f'task_links_updated={execution["task_links_updated"]} '
                f'assignment_updates={execution["assignment_updates"]} '
                f'blocked_role_tasks={execution["blocked_role_tasks"]} '
                f'missing_bindings={execution["missing_bindings"]} '
                f'unresolved_roles={",".join(execution["unresolved_roles"]) or "none"}'
            )
        )
