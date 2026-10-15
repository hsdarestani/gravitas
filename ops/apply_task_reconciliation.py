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
    from core.task_reconciliation_export import snapshot
    plan_path = Path(args.plan)
    plan = json.loads(plan_path.read_text())
    if digest(plan) != args.expected_sha:
        raise ValueError('unreviewed_plan_digest')
    validate(plan)
    root = plan_path.parent
    def save(path, data):
        with path.open('x') as output:
            os.chmod(path, 0o600)
            output.write(json.dumps(data, cls=DjangoJSONEncoder, ensure_ascii=False))
            output.flush();os.fsync(output.fileno())
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
            if prior.get('plan_sha256') != digest(batch) or prior.get('state') == 'prepared':
                raise ValueError('incomplete_batch_requires_review')
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
