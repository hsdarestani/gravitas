"""Gracefully interrupt only the exact portfolio worker after missing canonical destinations were verified."""
import os,signal,json,time
from pathlib import Path
expected='/tmp/graviquest-approved-38756540563-apply.py'
import django;django.setup()
from core.canonical_models import CanonicalProject
from core.models import ResearchProject
inactive=list(ResearchProject.objects.filter(pk__gte=215,pk__lte=226,workspace_id=76).exclude(pk__in=CanonicalProject.objects.filter(enabled=True).values('project_id')).values_list('id',flat=True))
print(json.dumps({'verified_inactive_destination_ids':inactive}),flush=True)
if not inactive:raise SystemExit('All destinations are active; no interrupt sent')
matched=[]
for path in Path('/proc').iterdir():
 if not path.name.isdigit():continue
 try:args=(path/'cmdline').read_bytes().split(b'\0')
 except (OSError,PermissionError):continue
 if expected.encode() in args and args[0].endswith(b'python'):
  matched.append(int(path.name));os.kill(int(path.name),signal.SIGINT)
print(json.dumps({'interrupted_own_worker_pids':matched,'signal':'SIGINT','reason':'new project destinations lack canonical activation; stop and recover the current journal before repairing adoption'}),flush=True)
