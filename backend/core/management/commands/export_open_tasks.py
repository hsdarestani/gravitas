import json

from django.core.management.base import BaseCommand
from django.db.models import Count
from django.utils import timezone

from core.operating_models import OperatingTask, WorkStatus


class Command(BaseCommand):
    help = 'Export every open platform task as JSON for review.'

    def handle(self, *args, **options):
        today = timezone.localdate()
        rows = (
            OperatingTask.objects
            .exclude(status__in=[WorkStatus.DONE, WorkStatus.ARCHIVED])
            .select_related(
                'workspace',
                'owner',
                'initiative__process',
                'initiative__key_result__objective',
                'milestone',
                'work_package',
                'cycle',
                'project',
                'meeting',
                'dependency',
            )
            .annotate(
                comment_count=Count('board_comments', distinct=True),
                attachment_count=Count('board_attachments', distinct=True),
            )
            .order_by('workspace__name', 'status', 'priority', 'due_date', 'id')
        )

        tasks = []
        for task in rows:
            kr = task.initiative.key_result
            objective = kr.objective
            overdue = bool(task.due_date and task.due_date < today)
            days_overdue = (today - task.due_date).days if overdue else 0
            tasks.append({
                'id': task.pk,
                'workspace': task.workspace.name,
                'title': task.title,
                'description': task.description,
                'status': task.status,
                'priority': task.priority,
                'owner': task.owner.get_full_name() or task.owner.email,
                'owner_email': task.owner.email,
                'objective': objective.title,
                'key_result': kr.title,
                'kr_metric': kr.metric_name,
                'kr_current': str(kr.current_value) if kr.current_value is not None else None,
                'kr_target': str(kr.target_value) if kr.target_value is not None else None,
                'kr_unit': kr.unit,
                'milestone': task.milestone.title if task.milestone else '',
                'work_package': task.work_package.title if task.work_package else '',
                'project': task.project.title if task.project else '',
                'meeting': task.meeting.title if task.meeting else '',
                'due_date': task.due_date.isoformat() if task.due_date else None,
                'overdue': overdue,
                'days_overdue': days_overdue,
                'definition_of_done': task.definition_of_done,
                'blocked_reason': task.blocked_reason,
                'dependency': task.dependency.title if task.dependency else '',
                'comment_count': task.comment_count,
                'attachment_count': task.attachment_count,
                'created_at': task.created_at.isoformat(),
                'updated_at': task.updated_at.isoformat(),
                'legacy_initiative': task.initiative.title,
                'legacy_cycle': task.cycle.name if task.cycle else '',
            })

        payload = {
            'generated_at': timezone.now().isoformat(),
            'count': len(tasks),
            'tasks': tasks,
        }
        self.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
