"""Exact QA cleanup and native Markdown research notes for approved migration."""
import json
import os
from pathlib import Path

ROOT = Path('/var/lib/gravitas-source-migrations/team-docs-20261015-v1')


def save(path, data):
    from django.core.serializers.json import DjangoJSONEncoder
    with path.open('x') as out:
        os.chmod(path, 0o600)
        out.write(json.dumps(data, cls=DjangoJSONEncoder, ensure_ascii=False))
        out.flush();os.fsync(out.fileno())


def main():
    import django
    django.setup()
    from django.core import serializers
    from django.db import transaction
    from django.contrib.auth import get_user_model
    from core.models import KnowledgeResource, ResearchProject
    from core.operating_models import OperatingTask
    from core.platform_access import can_view, can_edit, policy_for, INHERIT_VISIBILITY
    from core.canonical_journal import journal_transaction
    from core.canonical_projects import _pending, refresh_project, dav_read
    from core.canonical_signals import flush_pending
    from core.canonical_models import CanonicalFile
    from core import cloud
    from core.task_reconciliation_export import snapshot
    plan = json.loads((ROOT/'plan.json').read_text())
    if not (ROOT/'after-apply.json').exists():
        raise ValueError('complete_import_required')
    actor = get_user_model().objects.get(pk=18)
    import sys
    sys.path.insert(0,str(ROOT))
    from reconciliation_notes import ensure_revenue_notes
    revenue,tasks=ensure_revenue_notes(plan)
    # Only the two exact disposable QA records authorized by the user.
    qa_ids=[728,729]
    if OperatingTask.objects.filter(pk__in=qa_ids).exists():
        raise ValueError('qa_cleanup_failed')
    bindings={t.source_key:t for t in OperatingTask.objects.filter(source_metadata__migration_run_id=plan['run_id'])}
    before={t['id']:t for t in json.loads((ROOT/'before-apply.json').read_text())['tasks']}
    # Validate the actual committed migration audit before judging later team
    # edits. Native refreshes and legitimate reassignments must be preserved.
    audit_bindings={}
    for path in ROOT.glob('audit-*.json'):
        audit=json.loads(path.read_text())
        if audit.get('plan_sha256'):
            for row in audit.get('tasks',[]):audit_bindings.setdefault(row['source_key'],row)
    current_changes=[]
    for item in plan['tasks']:
        task=bindings.get(item['source_key']);row=audit_bindings.get(item['source_key'])
        if not task or not row or row['task_id']!=task.pk:raise ValueError('source_audit_binding_failed')
        initial=row['after']
        if row.get('action')=='updated':
            for field in ('title','description','status','owner_id','due_date','dependency_id'):
                if row['before'][field]!=initial[field]:raise ValueError('migration_overwrote_existing_state')
        if initial['owner_id']!=item['owner_id']:raise ValueError('migration_owner_wrong')
        if not item.get('task_id') and (initial['status']!=item['status'] or initial['due_date'] is not None):raise ValueError('migration_status_or_date_wrong')
        for field in ('title','description','status','owner_id','priority','due_date','dependency_id'):
            actual=getattr(task,field)
            if hasattr(actual,'isoformat'):actual=actual.isoformat()
            if actual!=initial[field]:current_changes.append({'task_id':task.pk,'field':field,'preserved_latest':True})
        parent=item.get('parent_source_key')
        if parent and task.parent_id!=bindings[parent].pk:raise ValueError('source_parent_requires_review')
    verification={'qa_deleted':qa_ids,'native_notes':[],'canonical_task_readback':[], 'owner_access':[],'preserved_post_migration_edits':current_changes}
    for project in ResearchProject.objects.filter(pk__in=OperatingTask.objects.filter(source_metadata__migration_run_id=plan['run_id']).values('project_id')).distinct():
        journal_transaction(refresh_project)(project,actor)
        for task in OperatingTask.objects.filter(project=project,source_metadata__migration_run_id=plan['run_id']).select_related('owner'):
            access={'task_id':task.pk,'owner_id':task.owner_id,'can_view':can_view(task.owner,task),'can_edit':can_edit(task.owner,task)}
            if not access['can_view'] or not access['can_edit']:
                raise ValueError('task_owner_access_failed')
            verification['owner_access'].append(access)
            file=CanonicalFile.objects.get(project=project,object_type='OperatingTask',object_id=task.pk,deleted=False)
            remote=dav_read(cloud.project_mountpoint(project)+'/'+file.path)
            if not remote or remote['content']!=file.base_content:
                raise ValueError('canonical_task_readback_failed')
            verification['canonical_task_readback'].append({'task_id':task.pk,'path':file.path,'etag_match':remote['etag']==file.etag})
    from core.models import NextcloudIdentity
    native_checks=[]
    seen=set()
    for task in OperatingTask.objects.filter(source_metadata__migration_run_id=plan['run_id']).select_related('project'):
        pair=(task.project_id,task.owner_id)
        if pair in seen:
            continue
        seen.add(pair)
        identity=NextcloudIdentity.objects.get(user_id=task.owner_id)
        f=CanonicalFile.objects.get(project=task.project,object_type='OperatingTask',object_id=task.pk,deleted=False)
        response=cloud.download(identity,cloud.project_mountpoint(task.project)+'/'+f.path)
        try:
            if response.text!=f.base_content:
                raise ValueError('owner_native_file_read_failed')
        finally:
            response.close()
        native_checks.append({'project_id':task.project_id,'user_id':task.owner_id,'task_id':task.pk,'native_read':True})
    verification['native_owner_access']=native_checks
    for n in KnowledgeResource.objects.filter(project=revenue,metadata__migration_run_id=plan['run_id']):
        f=CanonicalFile.objects.get(project=revenue,object_type='KnowledgeResource',object_id=n.pk,deleted=False)
        remote=dav_read(cloud.project_mountpoint(revenue)+'/'+f.path)
        if not remote or remote['content']!=f.base_content:
            raise ValueError('canonical_note_readback_failed')
        sajad_identity=NextcloudIdentity.objects.get(user_id=289)
        response=cloud.download(sajad_identity,cloud.project_mountpoint(revenue)+'/'+f.path)
        try:
            if response.text!=f.base_content:
                raise ValueError('sajad_native_note_read_failed')
        finally:
            response.close()
        verification['native_notes'].append({'id':n.pk,'title':n.title,'path':f.path,'sajad_can_edit':can_edit(get_user_model().objects.get(pk=289),n)})
    # Exercise the production board handlers with an ordinary member, then
    # persist an unchanged priority through the edit handler and re-read it.
    from django.test import RequestFactory
    from django.urls import resolve
    from core.canonical_middleware import CanonicalProjectMiddleware
    boundary=CanonicalProjectMiddleware(lambda request: None)
    def actual_route(request):
        matched=resolve(request.path)
        response=boundary.process_view(request,matched.func,matched.args,matched.kwargs)
        return response if response is not None else matched.func(request,*matched.args,**matched.kwargs)
    factory=RequestFactory()
    member=get_user_model().objects.get(pk=455)
    request=factory.get('/api/operating/task-board/',{'workspace_id':75});request.user=member
    response=actual_route(request)
    payload=json.loads(response.content)
    visible={t['id'] for t in payload.get('tasks',[])}
    owned=set(OperatingTask.objects.filter(owner=member,source_metadata__migration_run_id=plan['run_id']).values_list('id',flat=True))
    if response.status_code!=200 or not owned.issubset(visible):
        raise ValueError('ordinary_member_board_visibility_failed')
    sample=OperatingTask.objects.get(pk=tasks[0].pk)
    request=factory.patch('/api/operating/task-board/'+str(sample.pk)+'/?workspace_id=75',data=json.dumps({}),content_type='application/json');request.user=actor
    response=actual_route(request)
    if response.status_code!=200:
        raise ValueError('board_edit_failed')
    sample.refresh_from_db()
    request=factory.get('/api/operating/task-board/'+str(sample.pk)+'/',{'workspace_id':75});request.user=actor
    reread=actual_route(request)
    if reread.status_code!=200 or json.loads(reread.content)['task']['priority']!=sample.priority:
        raise ValueError('board_edit_readback_failed')
    verification['api_checks']={'ordinary_member_id':455,'own_tasks_visible':len(owned),'edit_readback_task_id':sample.pk,'result':'passed','route_layer_and_canonical_middleware':True,'browser_refresh_tested':False}
    save(ROOT/'verification.json',verification)
    save(ROOT/'final-snapshot.json',snapshot())
    # Retain private transport key until outstanding direct material uploads
    # and rollback review are resolved. It is never exported.
    print(json.dumps({'qa_deleted':qa_ids,'verified_tasks':len(verification['owner_access']),'native_markdown_notes':len(verification['native_notes'])}))


if __name__=='__main__':
    main()
