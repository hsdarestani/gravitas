"""Read-only process/audit/DB progress; no credentials or source text."""
import json,subprocess
from pathlib import Path
root=Path('/var/lib/gravitas-source-migrations/team-docs-20261015-v1')
for p in sorted(root.glob('audit-*.json')):
 try:
  a=json.loads(p.read_text());print(json.dumps({'audit':p.name,'state':a.get('state','committed'),'created':a.get('created'),'updated':a.get('updated'),'matched':a.get('matched')}))
 except Exception:print(json.dumps({'audit':p.name,'state':'unreadable'}))
for pattern in ['graviquest-approved-','graviquest-finalize-']:
 r=subprocess.run(['pgrep','-f',pattern],capture_output=True,text=True)
 for pid in r.stdout.split():
  if pid.isdigit():subprocess.run(['ps','-p',pid,'-o','pid,ppid,etime,stat,comm'])
import django
django.setup()
from core.operating_models import OperatingTask
print(json.dumps({'core_tasks':OperatingTask.objects.filter(workspace_id=75).count(),'source_bound':OperatingTask.objects.filter(source_metadata__migration_run_id='team-docs-20261015-v1').count(),'qa_remaining':list(OperatingTask.objects.filter(pk__in=[728,729]).values_list('id',flat=True))}))
from django.db.models import Count
print(json.dumps({'task_project_counts':list(OperatingTask.objects.filter(workspace_id=75).values('project_id').annotate(count=Count('id')).order_by('project_id'))}))
from core.canonical_models import CanonicalProject,CanonicalFile
from django.db.models import Exists,OuterRef
files=CanonicalFile.objects.filter(object_type='OperatingTask',deleted=False,project__workspace_id=76)
missing=OperatingTask.objects.filter(workspace_id=75,source_key__isnull=False).exclude(source_key='').annotate(has_native=Exists(files.filter(project_id=OuterRef('project_id'),object_id=OuterRef('pk')))).filter(has_native=False).count()
print(json.dumps({'canonical_health':{'active_project_ids':list(CanonicalProject.objects.filter(project__workspace_id=76,enabled=True).values_list('project_id',flat=True)),'source_tasks_missing_active_native_file':missing,'duplicate_active_task_file_groups':files.values('object_id').annotate(total=Count('id')).filter(total__gt=1).count()}}))
from django.db import connection
with connection.cursor() as cursor:
    cursor.execute("SELECT pid,state,wait_event_type,wait_event,pg_blocking_pids(pid),EXTRACT(EPOCH FROM (now()-xact_start))::integer FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()")
    print(json.dumps({'database_waits':cursor.fetchall()},default=str))
with connection.cursor() as cursor:
    cursor.execute("SELECT pid,regexp_match(query, '(?i)(?:UPDATE|INTO|FROM)\\s+\"?([A-Za-z_]+)') FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")
    print(json.dumps({'blocked_statement_tables':cursor.fetchall()}))
import requests
from django.conf import settings
try:
    response=requests.get(settings.NEXTCLOUD_INTERNAL_URL+'/status.php',timeout=(2,5))
    print(json.dumps({'native_status_http':response.status_code}))
except requests.RequestException as exc:
    print(json.dumps({'native_status_error':type(exc).__name__}))

# Inspect only newest native journal counters; never print user content.
from core import cloud
from core.canonical_projects import dav_read
from core.models import ResearchProject
from xml.etree import ElementTree as ET
from urllib.parse import unquote
for project in ResearchProject.objects.filter(pk__in=[212,218,224]):
 folder=cloud.project_mountpoint(project)+'/06_Archive/CanonicalTransactions'
 response=cloud._request('PROPFIND',cloud._admin_dav_url(folder),auth=cloud._admin_auth(),expected={207,404},headers={'Depth':'1'})
 if response.status_code!=207:continue
 candidates=[]
 for row in ET.fromstring(response.content).findall('{DAV:}response'):
  href=unquote(row.findtext('{DAV:}href') or '')
  if not href.rstrip('/').endswith('.json'):continue
  modified=row.findtext('.//{DAV:}getlastmodified') or ''
  from email.utils import parsedate_to_datetime
  try:stamp=parsedate_to_datetime(modified).timestamp()
  except ValueError:stamp=0
  candidates.append((stamp,href.rstrip('/').rsplit('/',1)[-1]))
 for stamp,name in sorted(candidates,reverse=True)[:2]:
  remote=dav_read(folder+'/'+name)
  if remote:
   manifest=json.loads(remote['content'])
   print(json.dumps({'project_id':project.pk,'journal':name,'state':manifest.get('state'),'operations':len(manifest.get('operations',[])),'kinds':[o.get('kind') for o in manifest.get('operations',[])],'restored':sum(bool(o.get('restored')) for o in manifest.get('operations',[])),'commit_witness':__import__('core.canonical_models',fromlist=['CanonicalWriteCommit']).CanonicalWriteCommit.objects.filter(pk=manifest['batch_id']).exists(),'modified_epoch':stamp}),flush=True)

progress=root/'recovery-progress.jsonl'
if progress.exists():
 print(json.dumps({'recovery_progress_tail':progress.read_text().splitlines()[-12:]}),flush=True)

portfolio=root/'portfolio-plan.json'
if portfolio.exists():
 plan=json.loads(portfolio.read_text())
 projects={}
 for item in plan['projects']:
  projects[item['key']]=item.get('id') or ResearchProject.objects.get(description__contains='<!-- gq-migration-project:'+item['key']+' -->').pk
 rows={t.source_key:t for t in OperatingTask.objects.filter(source_key__in=[x['source_key'] for x in plan['tasks']])}
 remaining=[rows[x['source_key']] for x in plan['tasks'] if rows[x['source_key']].project_id!=projects[x['project']]]
 roots=set()
 for task in remaining:
  while task.parent_id:task=task.parent
  roots.add(task.pk)
 print(json.dumps({'remaining_task_routes':len(remaining),'remaining_family_routes':len(roots),'portfolio_verification_present':(root/'portfolio-verification.json').exists(),'final_verification_present':(root/'verification.json').exists()}),flush=True)
verification=root/'verification-progress.jsonl'
if verification.exists():print(json.dumps({'verification_progress_tail':verification.read_text().splitlines()[-8:]}),flush=True)
