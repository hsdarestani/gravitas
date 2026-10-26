"""Finish placeholder repair for workspace redesign and interface defect tasks.

The existing migration intentionally skipped unclassified titles. This
follow-up adds a narrow action/domain rule, with exact placeholder and
optimistic-version guards. No status, acceptance, ownership or provenance
is inferred or modified.
"""
import re
from django.db import migrations
from django.db.models import F
from django.utils import timezone

LEGACY_DESCRIPTION = "Historical team task imported from the linked Google Docs record."
LEGACY_DOD = (
    "The original documented deliverable is preserved with its source reference. "
    "Source-reported completion does not establish production acceptance."
)


def propose_copy(title):
    text = ' '.join(str(title or '').split())
    if not re.match(r'^redesign\b', text, re.IGNORECASE):
        return None
    if not re.search(r'workspace|interface|product ui|user experience', text, re.IGNORECASE):
        return None
    return (
        "Review and redesign the scoped workspace experience while diagnosing "
        "and addressing the major interface defects identified in the original task. "
        "Cover navigation, layout, core interactions, loading and error states, and "
        "supported desktop and mobile viewports.",
        "A reviewable implementation or design handoff identifies the affected "
        "screens and documented defects. Critical interaction paths are verified "
        "with representative regression cases on desktop and mobile; remaining "
        "issues and acceptance gaps are explicitly recorded."
    )


def repair(apps, schema_editor):
    Task = apps.get_model('core', 'OperatingTask')
    CanonicalProject = apps.get_model('core', 'CanonicalProject')
    Outbox = apps.get_model('core', 'CanonicalTaskSyncOutbox')
    alias = schema_editor.connection.alias
    rows = Task.objects.using(alias).exclude(source_key__isnull=True).exclude(
        source_key=''
    ).filter(definition_of_done=LEGACY_DOD)
    for task in rows.iterator(chunk_size=100):
        copy = propose_copy(task.title)
        if copy is None:
            continue
        description, done = copy
        updates = {'definition_of_done': done}
        if (task.description or '').startswith(LEGACY_DESCRIPTION):
            updates['description'] = description
        now = timezone.now()
        updates['updated_at'] = now
        updated = Task.objects.using(alias).filter(
            pk=task.pk, updated_at=task.updated_at,
            definition_of_done=LEGACY_DOD
        ).update(**updates)
        if not updated or not task.project_id or not CanonicalProject.objects.using(alias).filter(
            project_id=task.project_id, enabled=True
        ).exists():
            continue
        job, created = Outbox.objects.using(alias).get_or_create(
            project_id=task.project_id, task_id=task.pk,
            defaults={'generation': 1, 'next_attempt_at': now, 'state': 'pending'},
        )
        if not created:
            Outbox.objects.using(alias).filter(pk=job.pk).update(
                generation=F('generation') + 1,
                next_attempt_at=now, state='pending', attempts=0, last_error='',
            )


class Migration(migrations.Migration):
    dependencies = [('core', '0079_repair_remaining_historical_task_copy')]
    operations = [migrations.RunPython(repair, reverse_code=migrations.RunPython.noop)]
