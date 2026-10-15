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
