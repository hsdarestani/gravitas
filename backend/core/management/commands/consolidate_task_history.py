"""Safely attach vetted historical duplicate tasks to one canonical read view.

No tasks, logs, source keys, parents, notes, comments or attachments are deleted
or reassigned. A single reversible alias row is created for each reviewed pair.

Validate: python manage.py consolidate_task_history --plan /private/plan.json
Apply: python manage.py consolidate_task_history --plan /private/plan.json \
  --apply --expected-plan-sha <sha256> --audit-output /private/new-audit.json

The plan is a sensitive, private server-side file. Its fingerprints bind to
exact database task versions and prevent stale assumptions from applying.
"""
import hashlib
import json
import os
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from core.models import KnowledgeResource, Workspace
from core.operating_models import OperatingTask, OperatingTaskConsolidation, WorkStatus


def task_fingerprint(task):
    value = {
        'id': task.pk, 'title': task.title, 'source_key': task.source_key,
        'updated_at': task.updated_at.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        'project_id': task.project_id, 'owner_id': task.owner_id,
        'initiative_id': task.initiative_id, 'status': task.status,
    }
    return hashlib.sha256(json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(',', ':'),
    ).encode('utf-8')).hexdigest()


def validate_pairs(rows, pairs):
    ids = set()
    for item in pairs:
        source_id, target_id = item.get('source'), item.get('target')
        if (not isinstance(source_id, int) or not isinstance(target_id, int)
                or source_id == target_id or source_id in ids or target_id in ids):
            raise CommandError('overlapping_or_invalid_consolidation_pair')
        ids.update([source_id, target_id])
        source, target = rows.get(source_id), rows.get(target_id)
        if not source or not target:
            raise CommandError('consolidation_task_missing')
        if source.workspace_id != target.workspace_id:
            raise CommandError('cross_workspace_merge_rejected')
        if not (source.owner_id == target.owner_id
                and source.project_id == target.project_id
                and source.initiative_id == target.initiative_id
                and source.status == target.status == WorkStatus.DONE):
            raise CommandError('different_scope_or_not_completed')
        if not source.project_id or not (source.source_key or '').startswith('gdocs:'):
            raise CommandError('source_not_reviewed_historical_record')
        if not (target.source_key or '').startswith('gdocs:'):
            raise CommandError('target_not_reviewed_historical_record')
        if source.subtasks.exists() or source.dependants.exists():
            raise CommandError('source_has_live_hierarchy_or_dependencies')
        if source.google_task_links.exists():
            raise CommandError('source_has_external_google_task_link')
        if not isinstance(item.get('reason'), str) or not 10 <= len(item['reason']) <= 400:
            raise CommandError('consolidation_reason_required')
        if task_fingerprint(source) != item.get('source_fingerprint'):
            raise CommandError('source_fingerprint_stale')
        if task_fingerprint(target) != item.get('target_fingerprint'):
            raise CommandError('target_fingerprint_stale')
        if OperatingTaskConsolidation.objects.filter(target_id=source_id).exists():
            raise CommandError('source_is_already_canonical_parent')
        if OperatingTaskConsolidation.objects.filter(source_id=target_id).exists():
            raise CommandError('target_is_an_alias')
        existing = OperatingTaskConsolidation.objects.filter(source_id=source_id).first()
        if existing and existing.target_id != target_id:
            raise CommandError('conflicting_existing_alias')
        # A historical timer still running must be resolved, not hidden.
        if KnowledgeResource.objects.filter(
                project_id=source.project_id, kind=KnowledgeResource.Kind.NOTE,
                metadata__pm_type='task_time_log_v1',
                metadata__task_id=source_id,
                metadata__active_started_at__isnull=False,
        ).exclude(metadata__active_started_at='').exists():
            raise CommandError('historical_timer_still_running')
    return True


class Command(BaseCommand):
    help = 'Create reversible read-only aliases for independently reviewed historical duplicate tasks.'

    def add_arguments(self, parser):
        parser.add_argument('--plan', type=Path, required=True)
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--expected-plan-sha', default='')
        parser.add_argument('--audit-output', type=Path)

    def handle(self, *args, **kwargs):
        plan_path = Path(kwargs['plan'])
        raw = plan_path.read_bytes()
        plan_sha = hashlib.sha256(raw).hexdigest()
        if kwargs['apply'] and plan_sha != kwargs['expected_plan_sha']:
            raise CommandError('plan_sha_mismatch')
        payload = json.loads(raw)
        pairs = payload.get('pairs', [])
        if payload.get('schema') != 1 or not isinstance(pairs, list) or not 0 < len(pairs) <= 25:
            raise CommandError('invalid_or_excessive_plan')
        all_ids = sorted({x[k] for x in pairs for k in ('source', 'target')})
        audit_output = Path(kwargs['audit_output']) if kwargs.get('audit_output') else None
        if kwargs['apply'] and (not audit_output or not audit_output.is_absolute()):
            raise CommandError('absolute_private_audit_output_required')

        with transaction.atomic():
            # Serialize against competing consolidation commands, then fetch
            # and validate *current* row versions inside the same transaction.
            workspace_ids = set(OperatingTask.objects.filter(
                pk__in=all_ids).values_list('workspace_id', flat=True).distinct())
            if len(workspace_ids) != 1:
                raise CommandError('task_workspace_scope_mismatch')
            Workspace.objects.select_for_update().get(pk=next(iter(workspace_ids)))
            rows = {
                x.pk: x for x in OperatingTask.objects.select_for_update()
                .filter(pk__in=all_ids).order_by('pk')
            }
            validate_pairs(rows, pairs)
            existing = {
                item.source_id: item.target_id for item in
                OperatingTaskConsolidation.objects.filter(source_id__in=[x['source'] for x in pairs])
            }
            pending = [p for p in pairs if p['source'] not in existing]
            if not kwargs['apply']:
                self.stdout.write(
                    'validated pairs=%s new=%s sha256=%s (no writes)' %
                    (len(pairs), len(pending), plan_sha)
                )
                return

            if not pending:
                self.stdout.write('already_consolidated pairs=%s' % len(pairs))
                return

            evidence = {
                'timestamp': timezone.now().isoformat(),
                'schema': 1, 'operation': 'reversible_task_alias',
                'plan_sha256': plan_sha,
                'pairs': [
                    {
                        'source_id': p['source'], 'target_id': p['target'],
                        'source_updated_at': rows[p['source']].updated_at.isoformat(),
                        'target_updated_at': rows[p['target']].updated_at.isoformat(),
                        'source_original_parent_id': rows[p['source']].parent_id,
                        'target_original_parent_id': rows[p['target']].parent_id,
                        'source_source_key': rows[p['source']].source_key,
                        'target_source_key': rows[p['target']].source_key,
                    }
                    for p in pending
                ],
                'note': 'No task, file, event, original parent or time log modified.',
            }
            flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
            if hasattr(os, 'O_NOFOLLOW'):
                flags |= os.O_NOFOLLOW
            fd = os.open(audit_output, flags, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as out:
                json.dump(evidence, out, ensure_ascii=False, indent=2)
                out.write('\n')
                out.flush()
                os.fsync(out.fileno())

            for p in pending:
                OperatingTaskConsolidation.objects.create(
                    source_id=p['source'], target_id=p['target'], reason=p['reason']
                )
            self.stdout.write('consolidated_aliases=%s original_task_records_deleted=0' % len(pending))
