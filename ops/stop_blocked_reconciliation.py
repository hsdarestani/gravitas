"""Gracefully interrupt only our exact uncommitted migration worker."""
import os,signal,json,time
from pathlib import Path
expected='/tmp/graviquest-approved-38737394976-apply.py'
matched=[]
for path in Path('/proc').iterdir():
 if not path.name.isdigit():continue
 try:args=(path/'cmdline').read_bytes().split(b'\0')
 except (OSError,PermissionError):continue
 if expected.encode() in args and args[0].endswith(b'python'):
  matched.append(int(path.name));os.kill(int(path.name),signal.SIGINT)
print(json.dumps({'interrupted_own_worker_pids':matched,'signal':'SIGINT','reason':'verified auth_user self-block during canonical provisioning; preserve journal recovery'}),flush=True)
