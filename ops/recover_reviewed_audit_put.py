"""Recover one reviewed ambiguous audit PUT using exact byte readback."""
import json,os,hashlib,django
from pathlib import Path
django.setup()
from django.db import transaction
from core.canonical_projects import dav_read,dav_write
from core.canonical_journal import recover_journal
from core.canonical_models import CanonicalProject,CanonicalWriteCommit
from core.platform_models import ProjectAuditEvent
path='GRV-000224/06_Archive/CanonicalTransactions/ea94720c-bc35-40a0-9059-a1d9b19d0cca.json'
root=Path('/var/lib/gravitas-source-migrations/team-docs-20261015-v1')
with transaction.atomic():
 CanonicalProject.objects.select_for_update().get(project_id=224)
 remote=dav_read(path);m=json.loads(remote['content'])
 if m['state']=='rolled_back':
  print(json.dumps({'already_recovered':True}));raise SystemExit(0)
 assert m['state']=='pending' and not CanonicalWriteCommit.objects.filter(pk=m['batch_id']).exists()
 assert len(m['operations'])==18
 op=m['operations'][17]
 assert op['kind']=='put' and op['before'] is None and not op.get('written_etag')
 assert op['path']=='GRV-000224/02_Working/Research/activity/ProjectAuditEvent-508/content.json'
 current=dav_read(op['path'])
 assert current and current['content']==op['content'] and current['etag'] and current['file_id']
 data=json.loads(current['content'])
 assert data['type']=='ProjectAuditEvent' and data['id']==508 and data['project_id']==224
 assert data['fields']['action']=='task_project_consolidated'
 assert data['fields']['detail']['before_project_id']==212 and data['fields']['detail']['after_project_id']==224
 assert not ProjectAuditEvent.objects.filter(pk=508).exists()
 backup=root/'reviewed-ambiguous-put-ea94720c.json'
 if not backup.exists():
  fd=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'w') as out:
   json.dump({'journal':remote,'reviewed_file':current,'reason':'Interrupted PUT completed before its native response marker was persisted; exact generated audit bytes confirmed and no committed DB witness.'},out);out.flush();os.fsync(out.fileno())
 # Record the successful PUT response witnessed by this explicit exact-byte
 # review. Retain native If-Match on both journal update and later rollback.
 op['written_etag']=current['etag']
 assert dav_write(path,json.dumps(m,ensure_ascii=False),remote['etag'])
 result=recover_journal(path)
 assert result=='rolled_back'
 print(json.dumps({'reviewed_operation':17,'exact_generated_bytes_confirmed':True,'journal_state':result}),flush=True)
