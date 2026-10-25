#!/usr/bin/env python3
"""Local integration test only: real Django/DB/CSRF/browser, fixture external services.
Never run against production. Creates an isolated temporary SQLite database.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from unittest.mock import patch
from socketserver import ThreadingMixIn
from wsgiref.simple_server import make_server, WSGIServer, WSGIRequestHandler

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'backend'))
os.environ['DJANGO_SETTINGS_MODULE'] = 'gravitas_backend.test_settings'
import django
from django.conf import settings
scratch = tempfile.TemporaryDirectory(prefix='gq-lab-browser-')
settings.DATABASES['default']['NAME'] = str(Path(scratch.name)/'qa.sqlite3')
settings.SCIENTIFIC_LAB_ENABLED = True
settings.ALLOWED_HOSTS = ['127.0.0.1', 'localhost', 'testserver']
settings.SESSION_COOKIE_SECURE = False
settings.CSRF_COOKIE_SECURE = False
django.setup()
from django.core.management import call_command
from django.core.wsgi import get_wsgi_application
from django.contrib.auth import get_user_model
from django.test import Client
from core.models import ResearchProject, ProjectMembership
from core.platform_runtime_v3 import ensure_platform_workspaces
from core.scientific_lab_models import ScientificLabRun
from core.scientific_lab_runner import execute
from core.pulsar_runtime.types import ProviderResponse
call_command('migrate',verbosity=0)
owner=get_user_model().objects.create_user(username='lab-browser-owner')
reviewer=get_user_model().objects.create_user(username='lab-browser-reviewer')
with patch('core.space_signals._queue_project_sync'):
    project=ResearchProject.objects.create(owner=owner,workspace=ensure_platform_workspaces(owner)['research'],title='QA fixture · not empirical research')
ProjectMembership.objects.create(project=project,user=reviewer,role='owner')
for actor,name in ((owner,'OWNER'),(reviewer,'REVIEWER')):
    client=Client();client.force_login(actor)
    os.environ['GQ_QA_'+name+'_SESSION']=client.cookies[settings.SESSION_COOKIE_NAME].value
os.environ['GQ_QA_PROJECT']=str(project.pk)
application=get_wsgi_application()

def app(environ,start_response):
    path=environ['PATH_INFO']
    if path=='/__qa__/execute' and environ['REQUEST_METHOD']=='POST':
        for run in ScientificLabRun.objects.filter(state='queued'):
            execute(run.pk)
        start_response('200 OK',[('Content-Type','application/json')]);return [b'{"ok":true}']
    if path.startswith('/api/'):
        return application(environ,start_response)
    allowed = path in ('/lab-ai-reliability.html','/lab-observations.html') or path.startswith('/assets/labs/')
    target=(ROOT/path.lstrip('/')).resolve()
    if allowed and target.is_relative_to(ROOT) and target.is_file():
        import mimetypes
        start_response('200 OK',[('Content-Type',mimetypes.guess_type(str(target))[0] or 'application/octet-stream')]);return [target.read_bytes()]
    start_response('404 Not Found',[('Content-Type','text/plain')]);return [b'Not found']

class Server(ThreadingMixIn, WSGIServer):
    daemon_threads=True
class Quiet(WSGIRequestHandler):
    def log_message(self,*args):pass
response=ProviderResponse(text=json.dumps({'citations':[{'title':'QA fixture citation, not a real article','doi':'10.0000/fixture','first_author':'Fixture','year':'2020','journal':'Test fixture','claim':'No empirical finding is asserted by this fixture.'}]}),provider='cloudflare-workers-ai',model='qa-fixture-model',latency_ms=1)
with patch('core.scientific_lab_api.providers',return_value=[{'id':'cloudflare-workers-ai','model':'qa-fixture-model','pricing':{'input_per_million':0.1,'output_per_million':0.2}}]), patch('core.scientific_lab_runner.retrieve',return_value={'records':[], 'provenance':{'fixture':True}}), patch('core.scientific_lab_runner.verify',return_value={'status':'unknown','claim_support':'not_assessed','reason':'Controlled QA fixture; no external validation.'}), patch('core.pulsar_runtime.providers.ManagedCloudflareProvider.complete',return_value=response):
    server=make_server('127.0.0.1',18834,app,server_class=Server,handler_class=Quiet)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        result=subprocess.run(['node',str(ROOT/'scripts/test-scientific-lab-browser.cjs')],cwd=ROOT)
    finally:
        server.shutdown()
sys.exit(result.returncode)
