"""Private resumable execution of the exact approved source reconciliation."""
import argparse,inspect,json,os,sys
from pathlib import Path


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--plan',required=True);parser.add_argument('--expected-sha',required=True);args=parser.parse_args()
    import django
    django.setup()
    from django.core.management import call_command
    from django.core.serializers.json import DjangoJSONEncoder
    from core.task_source_migration import validate,digest
    from core.task_reconciliation_export import snapshot
    from core.operating_models import OperatingTask
    from core import cloud,canonical_middleware,task_board_api
    if 'Reading an established identity' not in inspect.getsource(cloud.ensure_identity):
        raise ValueError('identity_lock_fix_required')
    if "'task-board/'" not in inspect.getsource(canonical_middleware.CanonicalProjectMiddleware.process_view) or 'not task.source_key' not in inspect.getsource(task_board_api.task_board_detail):
        raise ValueError('core_board_canonical_and_historical_edit_fixes_required')
    plan_path=Path(args.plan);root=plan_path.parent;plan=json.loads(plan_path.read_text())
    if digest(plan)!=args.expected_sha:
        raise ValueError('unreviewed_plan_digest')
    def save(path,data):
        with path.open('x') as output:
            os.chmod(path,0o600);output.write(json.dumps(data,cls=DjangoJSONEncoder,ensure_ascii=False));output.flush();os.fsync(output.fileno())
    # Keep each committed batch digest stable across a resume, using the
    # original precise instant rather than the later migrated updated_at.
    precision=root/'timestamp-precision.json'
    prior_precision={p['task_id']:p for p in json.loads(precision.read_text())} if precision.exists() else {}
    encoder=DjangoJSONEncoder();resolved=[]
    for item in plan['tasks']:
        if not item.get('task_id'):continue
        current=OperatingTask.objects.get(pk=item['task_id'])
        if current.source_key==item['source_key']:
            if current.pk not in prior_precision:raise ValueError('original_timestamp_precision_missing')
            item['expected_updated_at']=prior_precision[current.pk]['precise_timestamp']
        else:
            if encoder.default(current.updated_at)!=item['expected_updated_at']:
                raise ValueError('live_task_changed_since_snapshot:'+str(current.pk))
            resolved.append({'task_id':current.pk,'snapshot_timestamp':item['expected_updated_at'],'precise_timestamp':current.updated_at.isoformat()})
            item['expected_updated_at']=current.updated_at.isoformat()
    validate(plan)
    if not precision.exists():save(precision,resolved)
    if not (root/'before-apply.json').exists():save(root/'before-apply.json',snapshot())
    def run_batch(name,batch):
        path=root/f'batch-{name}.json';audit=root/f'audit-{name}.json';sha=digest(batch)
        if audit.exists():
            previous=json.loads(audit.read_text())
            if previous.get('state')=='pause_requested_for_controlled_deployment':
                # This was a control sentinel, never an executed import audit.
                # Preserve it without overwriting anything before resuming.
                preserved=root/f'control-pause-{name}.json'
                os.link(audit,preserved);audit.unlink()
            elif previous.get('plan_sha256')==sha and previous.get('state')!='prepared':
                expected={t['source_key'] for t in batch['tasks']}
                actual=set(OperatingTask.objects.filter(source_key__in=expected).values_list('source_key',flat=True))
                if actual!=expected:raise ValueError('committed_binding_missing_requires_review')
                return
            else:raise ValueError('incomplete_or_changed_batch_requires_review:'+name)
        if path.exists():
            if digest(json.loads(path.read_text()))!=sha:raise ValueError('reserved_batch_plan_changed')
        else:save(path,batch)
        call_command('migrate_source_tasks',str(path))
        call_command('migrate_source_tasks',str(path),apply=True,expected_plan_sha=sha,audit_output=str(audit))
    # Execute the already approved current Revenue/meeting subset before the
    # remaining historical backlog. Stable keys make the later full pass no-op.
    priority=[t for t in plan['tasks'] if not t['source_metadata'].get('records')]
    if len(priority)!=12 or sum(t['project']=='revenue-20261015' for t in priority)!=9:
        raise ValueError('reviewed_priority_subset_changed')
    run_batch('priority',dict(plan,tasks=priority))
    sys.path.insert(0,str(root))
    from reconciliation_notes import ensure_revenue_notes
    ensure_revenue_notes(plan)
    for index,start in enumerate(range(0,len(plan['tasks']),12)):
        run_batch(f'{index:03d}',dict(plan,tasks=plan['tasks'][start:start+12]))
    validate(plan);after=snapshot()
    keys={t.get('source_key') for t in after['tasks']}
    if any(t['source_key'] not in keys for t in plan['tasks']):raise ValueError('post_apply_source_bindings_missing')
    if not (root/'after-apply.json').exists():save(root/'after-apply.json',after)
    print(json.dumps({'verified_source_bindings':len(plan['tasks']),'historical_batches':index+1,'priority_records':len(priority)}))


if __name__=='__main__':main()
