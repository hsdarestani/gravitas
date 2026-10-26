"""Durably reconcile locally committed Core task edits with canonical Nextcloud files.

This is intentionally executed by a systemd worker, never inside task PATCH.
DB commit is confirmed immediately; Nextcloud sync is separate and conflict-aware.
"""
import logging
from datetime import timedelta

from django.db.models import F
from django.utils import timezone

from .canonical_models import CanonicalTaskSyncOutbox
from .canonical_projects import CanonicalConflict, export_object
from .canonical_journal import canonical_operation
from .operating_models import OperatingTask

logger = logging.getLogger(__name__)


def process_task_sync_outbox(*, limit=5):
    now = timezone.now()
    ids = list(CanonicalTaskSyncOutbox.objects.filter(
        next_attempt_at__lte=now, state='pending',
    ).order_by('next_attempt_at', 'pk').values_list('pk', flat=True)[:max(1, min(limit, 10))])
    totals = {'synced': 0, 'deferred': 0, 'conflict': 0, 'skipped': 0}
    for pk in ids:
        claimed = CanonicalTaskSyncOutbox.objects.filter(
            pk=pk, next_attempt_at__lte=now, state='pending',
        ).update(
            next_attempt_at=timezone.now() + timedelta(minutes=8),
            attempts=F('attempts') + 1,
        )
        if not claimed:
            continue
        job = CanonicalTaskSyncOutbox.objects.get(pk=pk)
        generation = job.generation
        task = OperatingTask.objects.filter(pk=job.task_id, project_id=job.project_id).first()
        if not task:
            # Task deletion uses the existing strict canonical deletion path;
            # no stale save operation can recreate a deleted task.
            CanonicalTaskSyncOutbox.objects.filter(pk=pk, generation=generation).delete()
            totals['skipped'] += 1
            continue
        try:
            with canonical_operation():
                # The object must be read from the latest DB projection and
                # conflicts with changed native ETags must fail closed.
                export_object(task, reject_external_changes=True)
            # Concurrent later saves increment generation and remain queued;
            # successful export of an earlier snapshot cannot clear them.
            cleared, _ = CanonicalTaskSyncOutbox.objects.filter(
                pk=pk, generation=generation,
            ).delete()
            if not cleared:
                CanonicalTaskSyncOutbox.objects.filter(pk=pk).update(
                    next_attempt_at=timezone.now(), state='pending',
                )
            totals['synced'] += 1
        except CanonicalConflict:
            CanonicalTaskSyncOutbox.objects.filter(
                pk=pk, generation=generation,
            ).update(state='conflict', last_error='native_revision_conflict')
            totals['conflict'] += 1
        except Exception as exc:
            delay = min(30, 2 ** min(job.attempts, 4))
            CanonicalTaskSyncOutbox.objects.filter(
                pk=pk, generation=generation,
            ).update(next_attempt_at=timezone.now() + timedelta(minutes=delay),
                     last_error=type(exc).__name__[:128])
            logger.warning('Task canonical sync deferred: job=%s reason=%s',
                           pk, type(exc).__name__)
            totals['deferred'] += 1
    return totals
