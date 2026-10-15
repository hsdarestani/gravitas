"""Stop owned migration only at the next pre-write family boundary."""
import os,json,signal,time
from pathlib import Path
progress=Path('/var/lib/gravitas-source-migrations/team-docs-20261015-v1/recovery-progress.jsonl')
target=b'/tmp/graviquest-approved-38801907153-apply.py'
for _ in range(12000):
 lines=progress.read_text().splitlines() if progress.exists() else []
 last=json.loads(lines[-1]) if lines else {}
 if last.get('phase')=='recover_scope' and last.get('root_id') not in (None,756):
  pids=[]
  for name in os.listdir('/proc'):
   if not name.isdigit():continue
   try:args=Path('/proc/'+name+'/cmdline').read_bytes().split(b'\0')
   except (FileNotFoundError,PermissionError):continue
   if target in args and b'python' in args[0]:pids.append(int(name))
  for pid in pids:os.kill(pid,signal.SIGTERM)
  print(json.dumps({'stopped_at_prewrite_family_boundary':last,'worker_pids':pids}),flush=True)
  break
 time.sleep(.05)
else:raise RuntimeError('no_safe_boundary_observed_no_signal_sent')
