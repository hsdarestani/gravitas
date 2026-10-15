"""Controlled project consolidation; shared Core IDs and canonical history survive."""
import json,os,argparse
from pathlib import Path
import builtins

def print(*args, **kwargs):
    builtins.print(*args, **kwargs)
    path=Path('/var/lib/gravitas-source-migrations/team-docs-20261015-v1/recovery-progress.jsonl')
    fd=os.open(path,os.O_WRONLY|os.O_APPEND|os.O_CREAT,0o600)
    with os.fdopen(fd,'a') as out:
        out.write(' '.join(str(x) for x in args)+'\n');out.flush()


def move_tree(tasks,destination,actor):
    from core.canonical_projects import export_object,active
    if not active(destination):raise ValueError('destination_canonical_activation_required')
    from core.canonical_signals import archive_object
    from core.platform_models import ProjectAuditEvent
    from core.operating_models import OperatingTask
    from core.canonical_journal import _batch,RecoveryRequired
    if _batch.get() is None:raise RecoveryRequired('portfolio_move_requires_journal')
    changing=[t for t in tasks if t.project_id!=destination.pk]
    ids={t.pk for t in tasks}
    if OperatingTask.objects.filter(parent_id__in=ids).exclude(pk__in=ids).exists():
        raise ValueError('incomplete_task_family')
    before={t.pk:t.project_id for t in changing}
    for task in changing:archive_object(task)
    # Update the whole family projection together; validate every member before
    # any commit and export each native file once inside the same DAV journal.
    OperatingTask.objects.filter(pk__in=[t.pk for t in changing]).update(project=destination)
    for task in changing:
        task.refresh_from_db();task.full_clean();export_object(task,actor)
        ProjectAuditEvent.objects.create(project=destination,actor=actor,action='task_project_consolidated',object_type='OperatingTask',object_id=str(task.pk),detail={'before_project_id':before[task.pk],'after_project_id':destination.pk,'task_id_preserved':True})

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--plan',required=True);parser.add_argument('--expected-sha',required=True);args=parser.parse_args()
    import django;django.setup()
    from django.contrib.auth import get_user_model
    from django.core.serializers.json import DjangoJSONEncoder
    # Cache successful MKCOLs only in this isolated migration worker.
    # A concurrent external folder deletion still fails on the subsequent
    # conditional PUT/ACL read. No native revision or ACL checks are skipped.
    from core import cloud
    ensured_folders=set()
    def ensure_folder_once(path):
        clean=cloud.safe_relative_path(path)
        current=[]
        for part in clean.split('/'):
            current.append(part);folder='/'.join(current)
            if folder in ensured_folders:continue
            cloud._request('MKCOL',cloud._admin_dav_url(folder),auth=cloud._admin_auth(),expected={201,405})
            ensured_folders.add(folder)
    cloud.admin_make_folder=ensure_folder_once
    from core.task_source_migration import apply_plan,digest,task_snapshot,validate
    from core.canonical_projects import active,refresh_project,refresh_task_scope,export_object,_pending,dav_read
    from core.canonical_signals import flush_pending
    from core.canonical_journal import journal_transaction
    from core.canonical_models import CanonicalFile
    from core.models import ResearchProject,KnowledgeResource,ProjectMembership
    from core.operating_models import OperatingTask
    from core.platform_access import can_view,can_edit,policy_for,INHERIT_VISIBILITY
    from core.task_reconciliation_export import snapshot
    root=Path(args.plan).parent;plan=json.loads(Path(args.plan).read_text())
    if digest(plan)!=args.expected_sha:raise ValueError('portfolio_digest_mismatch')
    if not (root/'after-apply.json').exists():raise ValueError('source_migration_not_complete')
    actor=get_user_model().objects.get(pk=plan['actor_id'])
    def save(name,value):
        path=root/name
        with path.open('x') as f:os.chmod(path,0o600);json.dump(value,f,cls=DjangoJSONEncoder,ensure_ascii=False);f.flush();os.fsync(f.fileno())
    if not (root/'portfolio-before.json').exists():save('portfolio-before.json',snapshot())
    project_plan=dict(schema=1,run_id=plan['run_id'],actor_id=18,workspace_id=75,projects=[dict(item,adopt_canonical=True) for item in plan['projects']],tasks=[])
    _,_,_,before_projects=validate(project_plan)
    adoption_repair=[key for key,project in before_projects.items() if not active(project)]
    # Commit each destination independently. Existing active projects need no
    # full history crawl merely to validate an already reviewed destination.
    from django.db import connection
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(20261015, 75)")
        if not cursor.fetchone()[0]:raise RuntimeError('another_reconciliation_worker_active')
    for item in project_plan['projects']:
        project=before_projects[item['key']]
        print(json.dumps({'phase':'destination','project_id':project.pk if project else None,'active':bool(project and active(project))}),flush=True)
        if project and active(project):
            for uid in {item['owner_id'], *item.get('editors', [])}:
                if not ProjectMembership.objects.filter(project=project,user_id=uid).exists():
                    raise RuntimeError('existing_destination_membership_requires_review')
            continue
        apply_plan({**project_plan,'projects':[item]})
        print(json.dumps({'phase':'destination_committed','key':item['key']}),flush=True)
    projects={}
    for item in plan['projects']:
        projects[item['key']]=ResearchProject.objects.get(pk=item['id']) if item.get('id') else ResearchProject.objects.get(description__contains='<!-- gq-migration-project:'+item['key']+' -->')
    if any(not active(project) for project in projects.values()):raise ValueError('portfolio_canonical_activation_required')
    source={t.source_key:t for t in OperatingTask.objects.filter(source_key__in=[x['source_key'] for x in plan['tasks']])}
    if len(source)!=len(plan['tasks']):raise ValueError('source_bindings_incomplete')
    target={x['source_key']:projects[x['project']].pk for x in plan['tasks']}
    for item in plan['tasks']:
        task=source[item['source_key']]
        if task.parent_id:
            parent=task.parent
            if target.get(parent.source_key,parent.project_id)!=target[task.source_key]:raise ValueError('tree_would_split')
        if task.project_id not in (projects[item['expected_project']].pk,target[task.source_key]):raise ValueError('task_project_changed_requires_review')
    # Every root subtree commits as one file-first operation, leaving no split tree.
    trees={}
    for item in plan['tasks']:
        task=source[item['source_key']];cursor=task
        while cursor.parent_id:cursor=source.get(cursor.parent.source_key,cursor.parent)
        trees.setdefault(cursor.pk,[]).append(task)
    @journal_transaction
    def consolidate(tasks):
        destination=projects[next(x['project'] for x in plan['tasks'] if x['source_key']==tasks[0].source_key)]
        # Recover each source/destination journal once per atomic family,
        # then refresh every addressed task without rescanning all journals.
        from core.canonical_projects import refresh_file
        scope={task.project_id:task.project for task in tasks}
        scope[destination.pk]=destination
        for project_id in sorted(scope):
            print(json.dumps({'phase':'recover_scope','project_id':project_id,'root_id':tasks[0].pk}),flush=True)
            refresh_task_scope(scope[project_id],actor)
        for index,task in enumerate(tasks):
            file=CanonicalFile.objects.get(project=task.project,object_type='OperatingTask',object_id=task.pk,deleted=False)
            refresh_file(file,actor);task.refresh_from_db()
            if index%10==0:print(json.dumps({'phase':'refresh_family','completed':index+1,'total':len(tasks)}),flush=True)
        pending=[];token=_pending.set(pending)
        try:
            move_tree(tasks,destination,actor)
            # move_tree exports each Task once; don't export it again in this journal.
            flush_pending([x for x in pending if x[0]!='save' or x[1] is not OperatingTask],actor)
        finally:_pending.reset(token)
    for rootid,tasks in trees.items():
        if any(t.project_id!=target[t.source_key] for t in tasks):
            print(json.dumps({'phase':'move_tree','root_id':rootid,'count':len(tasks)}),flush=True)
            consolidate(tasks)
            print(json.dumps({'phase':'tree_committed','root_id':rootid}),flush=True)
    @journal_transaction
    def route_existing(item):
        task=OperatingTask.objects.select_for_update().get(pk=item['task_id'],workspace_id=75)
        destination=projects[item['project']]
        if task.project_id==destination.pk:return
        if task.project_id!=item['expected_project_id']:raise ValueError('existing_core_project_changed')
        if not can_edit(task.owner,destination):raise ValueError('existing_owner_project_access_missing')
        pending=[];token=_pending.set(pending)
        try:
            refresh_task_scope(destination,actor);move_tree([task],destination,actor)
            flush_pending([x for x in pending if x[0]!='save' or x[1] is not OperatingTask],actor)
        finally:_pending.reset(token)
    for item in plan['existing_core_tasks']:
        print(json.dumps({'phase':'route_existing','task_id':item['task_id']}),flush=True)
        route_existing(item)
    @journal_transaction
    def create_note(item):
        project=projects[item['project']]
        if KnowledgeResource.objects.filter(project=project,metadata__migration_key=item['key']).exists():return
        pending=[];token=_pending.set(pending)
        try:
            refresh_task_scope(project,actor)
            note=KnowledgeResource.objects.create(workspace=project.workspace,project=project,owner=actor,kind='note',title=item['title'],body=item['body'],source_url=item['source_url'],metadata={'migration_key':item['key'],'portfolio_revision':plan['portfolio_revision'],'historical_reference':True})
            policy_for(note,create=True,created_by=actor,default_visibility=INHERIT_VISIBILITY)
            flush_pending(pending,actor)
        finally:_pending.reset(token)
    for item in plan['notes']:
        print(json.dumps({'phase':'note','key':item['key']}),flush=True)
        create_note(item)
    @journal_transaction
    def manager_access(project):
        pending=[];token=_pending.set(pending)
        try:
            if active(project):refresh_task_scope(project,actor)
            for uid in (18,289):
                member=ProjectMembership.objects.filter(project=project,user_id=uid).first()
                if not member:ProjectMembership.objects.create(project=project,user_id=uid,role='owner' if project.owner_id==uid else 'editor')
                elif member.role=='viewer':member.role='editor';member.save(update_fields=['role'])
            flush_pending(pending,actor)
        finally:_pending.reset(token)
    for project in ResearchProject.objects.filter(workspace_id=76,archived=False):
        print(json.dumps({'phase':'manager_access','project_id':project.pk}),flush=True)
        manager_access(project)
    @journal_transaction
    def upload_asset(item):
        import base64,hashlib
        from django.test import RequestFactory
        from django.core.files.uploadedfile import SimpleUploadedFile
        from core.platform_resources_api import platform_file_upload
        project=projects[item['project']];data=base64.b64decode(item['content_base64'])
        if hashlib.sha256(data).hexdigest()!=item['sha256']:raise ValueError('asset_checksum_invalid')
        existing=KnowledgeResource.objects.filter(project=project,original_name=item['name']).first()
        if existing:
            if existing.checksum!='sha256:'+item['sha256']:raise ValueError('existing_asset_content_conflict')
            return
        pending=[];token=_pending.set(pending)
        try:
            refresh_task_scope(project,actor)
            request=RequestFactory().post('/api/platform/files/upload/',{'file':SimpleUploadedFile(item['name'],data,content_type=item['mime_type']),'project_id':project.pk,'kind':'file','description':'Original source asset from '+item['source_library_id']})
            request.user=actor
            response=platform_file_upload(request)
            if response.status_code!=201:raise ValueError('asset_upload_failed:'+str(response.status_code))
            flush_pending(pending,actor)
        finally:_pending.reset(token)
    for item in plan.get('assets',[]):upload_asset(item)
    checks=[]
    for item in plan['tasks']:
        task=OperatingTask.objects.get(source_key=item['source_key'])
        if task.project_id!=target[task.source_key]:raise ValueError('task_routing_failed')
        if not can_view(task.owner,task.project) or not can_edit(task.owner,task):raise ValueError('task_owner_access_failed')
        files=list(CanonicalFile.objects.filter(object_type='OperatingTask',object_id=task.pk,deleted=False))
        if len(files)!=1 or files[0].project_id!=task.project_id:raise ValueError('competing_native_task_file')
        checks.append({'task_id':task.pk,'project_id':task.project_id,'source_key':task.source_key,'owner_id':task.owner_id,'canonical_files':1})
    for project in ResearchProject.objects.filter(workspace_id=76,archived=False):
        for uid in (18,289):
            if not can_edit(get_user_model().objects.get(pk=uid),project):raise ValueError('manager_access_failed')
    before=json.loads((root/'portfolio-before.json').read_text())
    after=snapshot();after_tasks={t['id']:t for t in after['tasks']}
    preserve=['title','description','owner_id','status','priority','due_date','parent_id','dependency_id','source_key','source_metadata']
    concurrent_edits=[]
    for old in before['tasks']:
        current=after_tasks.get(old['id'])
        if current is None:raise ValueError('task_disappeared')
        # Native refreshes may import legitimate team edits made after the
        # initial snapshot. This job only updates the project column; retain
        # and report those edits instead of restoring stale source content.
        for field in preserve:
            if old.get(field)!=current.get(field):concurrent_edits.append({'task_id':old['id'],'field':field,'preserved_latest':True})
    from core import cloud
    from core.models import NextcloudIdentity
    native=[]
    for item in plan['notes']:
        note=KnowledgeResource.objects.get(project=projects[item['project']],metadata__migration_key=item['key'])
        file=CanonicalFile.objects.get(project=note.project,object_type='KnowledgeResource',object_id=note.pk,deleted=False)
        remote=dav_read(cloud.project_mountpoint(note.project)+'/'+file.path)
        if not remote or remote['content']!=file.base_content:raise ValueError('note_native_readback_failed')
    for project in projects.values():
        task=OperatingTask.objects.filter(project=project).select_related('owner').first()
        if not task:continue
        file=CanonicalFile.objects.get(project=project,object_type='OperatingTask',object_id=task.pk,deleted=False)
        for uid in {18,289,task.owner_id}:
            response=cloud.download(NextcloudIdentity.objects.get(user_id=uid),cloud.project_mountpoint(project)+'/'+file.path)
            try:
                if response.text!=file.base_content:raise ValueError('project_member_native_read_failed')
            finally:response.close()
            native.append({'project_id':project.pk,'user_id':uid,'task_id':task.pk})
    for item in plan.get('assets',[]):
        import hashlib
        resource=KnowledgeResource.objects.get(project=projects[item['project']],original_name=item['name'])
        response=cloud.download(NextcloudIdentity.objects.get(user_id=18),resource.storage_path)
        try:
            if hashlib.sha256(response.content).hexdigest()!=item['sha256']:raise ValueError('asset_readback_failed')
        finally:response.close()
    save('portfolio-after.json',after);save('portfolio-verification.json',{'tasks':checks,'projects':{k:v.pk for k,v in projects.items()},'notes':len(plan['notes']),'preserved_concurrent_edits':concurrent_edits,'native_access':native,'assets':len(plan.get('assets',[])),'browser_refresh_tested':False,'adopted_missing_destinations':adoption_repair,'canonical_destinations_verified':len(projects)})
    print(json.dumps({'verified_tasks':len(checks),'project_destinations':len(projects),'notes':len(plan['notes'])}))
if __name__=='__main__':main()
