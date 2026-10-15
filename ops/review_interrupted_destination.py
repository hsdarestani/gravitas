"""Read-only review of the exact interrupted destination journal."""
import json,django
django.setup()
from core.canonical_projects import dav_read
from core import cloud
from core.canonical_models import CanonicalWriteCommit,CanonicalFile
from core.operating_models import OperatingTask
path='GRV-000224/06_Archive/CanonicalTransactions/ea94720c-bc35-40a0-9059-a1d9b19d0cca.json'
remote=dav_read(path);m=json.loads(remote['content'])
print(json.dumps({'state':m['state'],'commit_witness':CanonicalWriteCommit.objects.filter(pk=m['batch_id']).exists(),'operations':len(m['operations'])}),flush=True)
for index,op in enumerate(m['operations']):
 row={'index':index,'kind':op['kind'],'restored':bool(op.get('restored')),'not_written':bool(op.get('not_written')),'before_exists':bool(op.get('before'))}
 if op['kind']!='acl':
  current=dav_read(op['path'])
  row.update(current_exists=bool(current),content_matches_proposed=bool(current and current['content']==op.get('content')),etag_matches_recorded=bool(current and current['etag']==op.get('written_etag')),written_etag_recorded=bool(op.get('written_etag')))
  if current and op.get('content'):
   try:
    data=json.loads(current['content']);task=OperatingTask.objects.filter(pk=data.get('id')).first()
    row.update(object_type=data.get('type'),object_id=data.get('id'),native_project=data.get('project_id'),db_project=task.project_id if task else None,source_matches=bool(task and data.get('fields',{}).get('source_key')==task.source_key),canonical_target_record=CanonicalFile.objects.filter(project_id=224,object_type=data.get('type'),object_id=data.get('id'),deleted=False).exists())
   except (ValueError,TypeError):pass
 print(json.dumps(row),flush=True)
