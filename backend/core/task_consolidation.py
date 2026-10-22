"""Safe, bounded read overlay for logically consolidated Core tasks.

No canonical files, original task records, activity events or report links move.
"""
from .operating_models import OperatingTaskConsolidation


def canonical_id(task_id):
    return (OperatingTaskConsolidation.objects.filter(source_id=task_id)
            .values_list('target_id', flat=True).first() or task_id)


def family_ids(task_id):
    target_id = canonical_id(task_id)
    ids = list(OperatingTaskConsolidation.objects.filter(target_id=target_id)
               .order_by('source_id').values_list('source_id', flat=True)[:100])
    return [target_id, *ids]


def source_rows(task_id):
    return list(OperatingTaskConsolidation.objects.filter(target_id=canonical_id(task_id))
                .select_related('source').order_by('source_id'))
