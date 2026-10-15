"""Private, resumable batches for the explicitly approved reconciliation plan."""
import argparse
import json
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', required=True)
    parser.add_argument('--expected-sha', required=True)
    args = parser.parse_args()
    import django
    django.setup()
    from django.core.management import call_command
    from django.core.serializers.json import DjangoJSONEncoder
    from core.task_source_migration import validate, digest
    import inspect
    from core import cloud
    if 'Reading an established identity' not in inspect.getsource(cloud.ensure_identity):
        raise ValueError('identity_lock_fix_must_be_deployed_first')
    from core.task_reconciliation_export import snapshot
    plan_path = Path(args.plan)
    plan = json.loads(plan_path.read_text())
    if digest(plan) != args.expected_sha:
        raise ValueError('unreviewed_plan_digest')
    # Export snapshots use DjangoJSONEncoder's millisecond precision. Resolve
    # only that identical serialized instant to full DB precision, never accept
    # a newer timestamp. The original encrypted plan digest was checked above.
    from core.operating_models import OperatingTask
    encoder = DjangoJSONEncoder()
    resolved = []
    for item in plan['tasks']:
        if item.get('task_id'):
            current = OperatingTask.objects.get(pk=item['task_id'])
            if current.source_key == item['source_key']:
                continue
            if encoder.default(current.updated_at) != item['expected_updated_at']:
                raise ValueError('live_task_changed_since_snapshot:' + str(current.pk))
            resolved.append({'task_id':current.pk,'snapshot_timestamp':item['expected_updated_at'],'precise_timestamp':current.updated_at.isoformat()})
            item['expected_updated_at'] = current.updated_at.isoformat()
    validate(plan)
    root = plan_path.parent
    def save(path, data):
        with path.open('x') as output:
            os.chmod(path, 0o600)
            output.write(json.dumps(data, cls=DjangoJSONEncoder, ensure_ascii=False))
            output.flush();os.fsync(output.fileno())
    precision = root / 'timestamp-precision.json'
    if not precision.exists():
        save(precision, resolved)
    before = root / 'before-apply.json'
    if not before.exists():
        save(before, snapshot())
    # Parent-first source ordering is retained across committed batches.
    for index, start in enumerate(range(0, len(plan['tasks']), 12)):
        batch = dict(plan, tasks=plan['tasks'][start:start+12])
        path = root / f'batch-{index:03d}.json'
        audit = root / f'audit-{index:03d}.json'
        if audit.exists():
            prior = json.loads(audit.read_text())
            if index == 0 and prior.get('state') == 'prepared' and not OperatingTask.objects.filter(source_key__in=[i['source_key'] for i in batch['tasks']]).exists():
                # Reviewed failure was before the first Nextcloud request:
                # missing service environment. Preserve that prepared audit.
                preserved = root / 'audit-000.before-env-fix.json'
                if preserved.exists():
                    # A second reviewed attempt was gracefully interrupted after
                    # its auth_user lock was diagnosed; no source task committed.
                    preserved = root / 'audit-000.auth-lock-interrupted.json'
                    if preserved.exists():
                        # Reviewed connection refusal occurred before the first
                        # native request while post-deploy acceptance checkpointed.
                        preserved = root / 'audit-000.native-checkpoint-window.json'
                        if preserved.exists():
                            raise ValueError('further_prepared_failure_requires_review')
                audit.rename(preserved)
            elif prior.get('plan_sha256') != digest(batch) or prior.get('state') == 'prepared':
                raise ValueError('incomplete_batch_requires_review')
            else:
                continue
        if not path.exists():
            save(path, batch)
        call_command('migrate_source_tasks', str(path))
        call_command('migrate_source_tasks', str(path), apply=True,
                     expected_plan_sha=digest(batch), audit_output=str(audit))
    # Idempotency and live readback are checked after all commits.
    validate(plan)
    after = snapshot()
    by_key = {task.get('source_key'):task for task in after['tasks'] if task.get('source_key')}
    missing = [item['source_key'] for item in plan['tasks'] if item['source_key'] not in by_key]
    if missing:
        raise ValueError('post_apply_source_bindings_missing')
    final = root / 'after-apply.json'
    if not final.exists():
        save(final, after)
    print(json.dumps({'verified_source_bindings':len(plan['tasks']), 'batches':index+1}))


if __name__ == '__main__':
    main()
