"""Stop only the explicitly superseded portfolio migration, then inspect safely."""
import os,signal,time,json
target='/tmp/graviquest-approved-38793232189-apply.py'
pids=[]
for name in os.listdir('/proc'):
 if not name.isdigit():continue
 try:
  args=open('/proc/'+name+'/cmdline','rb').read().split(b'\0')
 except (FileNotFoundError,PermissionError):continue
 if target.encode() in args and any(b'python' in x for x in args[:1]):
  pids.append(int(name))
for pid in pids:
 os.kill(pid,signal.SIGTERM)
print(json.dumps({'targeted_worker_pids':pids,'signal':'SIGTERM'}),flush=True)
for _ in range(20):
 live=[p for p in pids if os.path.exists('/proc/'+str(p))]
 if not live:break
 time.sleep(1)
if live:raise RuntimeError('worker_did_not_exit_no_force_kill')
print(json.dumps({'worker_stopped':True}),flush=True)
exec(compile(open('/opt/gravitas-backend/ops/inspect_reconciliation_progress.py').read(),'<inspect>','exec')) if os.path.exists('/opt/gravitas-backend/ops/inspect_reconciliation_progress.py') else None
