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
