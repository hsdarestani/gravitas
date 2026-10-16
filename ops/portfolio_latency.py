import django,json,time,signal
from django.db import connection
from django.test import RequestFactory
from django.urls import resolve
django.setup()
from django.contrib.auth import get_user_model
from core.canonical_middleware import CanonicalProjectMiddleware
from core.models import ResearchProject
from core.canonical_models import CanonicalFile
with connection.cursor() as c:
 c.execute("SELECT state,wait_event_type,wait_event,count(*),max(EXTRACT(EPOCH FROM now()-query_start))::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY 1,2,3")
 print(json.dumps({'db_activity':c.fetchall()},default=str),flush=True)
 c.execute("SET statement_timeout='15000'")
u=get_user_model().objects.get(pk=18)
f=RequestFactory()
for path in ['/api/platform/projects/']:
 r=f.get(path);r.user=u
 start=time.monotonic()
 try:
  match=resolve(path);response=match.func(r,**match.kwargs)
  payload=json.loads(response.content)
  print(json.dumps({'path':path,'seconds':round(time.monotonic()-start,3),'status':response.status_code,'projects':len(payload.get('projects',[]))}),flush=True)
 except Exception as e:print(json.dumps({'path':path,'error':type(e).__name__,'seconds':round(time.monotonic()-start,3)}),flush=True)
print(json.dumps({'canonical_files':CanonicalFile.objects.filter(deleted=False).count()}),flush=True)
