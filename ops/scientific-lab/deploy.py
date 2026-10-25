"""Root-run additive release with an exact baseline, backup, and automatic code rollback.
The feature remains disabled; no model calls or unrelated service restarts.
"""
import hashlib, json, os, pathlib, shutil, subprocess, sys, time
source=pathlib.Path(__file__).resolve().parent
sha=sys.argv[1]
assert len(sha)==40 and all(c in '0123456789abcdef' for c in sha)
assert os.geteuid()==0
manifest=json.loads((source/'manifest.json').read_text())
backup=pathlib.Path('/var/backups/gravitas/scientific-lab')/sha
assert not backup.exists(), 'Release backup already exists; inspect before retry'
backend=pathlib.Path('/opt/gravitas-backend')
web=pathlib.Path('/var/www/gravitas')
def run(*args, **kwargs):
    return subprocess.run(args,check=True,timeout=120,**kwargs)
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
def destination(path):
    p=pathlib.PurePosixPath(path)
    assert not p.is_absolute() and '..' not in p.parts
    return backend/path[8:] if path.startswith('backend/') else web/path

def django(code):
    # Env is read only by the child; never copied into logs or the release archive.
    result=run('sudo','-n','-u','gravitas','bash','-c',
      'set -a; . /etc/gravitas/backend.env; set +a; export DJANGO_SETTINGS_MODULE=gravitas_backend.settings PYTHONPATH=/opt/gravitas-backend; exec /opt/gravitas-backend/.venv/bin/python -',
      input=code,text=True,capture_output=True)
    return result.stdout

for entry in manifest:
    assert digest(source/entry['path'])==entry['after'], 'Invalid release payload'
    assert digest(destination(entry['path']))==entry['before'], 'Production differs from reviewed baseline: '+entry['path']
run('systemctl','is-active','--quiet','gravitas-backend')
# Do not change flag configuration or use an already enabled release accidentally.
assert 'PREFLIGHT_OK' in django("import django; django.setup(); from django.conf import settings; from django.db.migrations.recorder import MigrationRecorder as M; assert settings.DATABASES['default']['NAME']=='gravitas'; assert not getattr(settings,'SCIENTIFIC_LAB_ENABLED',False); assert M.Migration.objects.filter(app='core',name='0075_operating_task_external_links').exists(); print('PREFLIGHT_OK')")
backup.mkdir(parents=True,mode=0o700)
os.chmod(backup,0o700)
with (backup/'database.dump').open('wb') as handle:
    run('sudo','-n','-u','postgres','pg_dump','-Fc','gravitas',stdout=handle)
run('pg_restore','--list',str(backup/'database.dump'),stdout=subprocess.DEVNULL)
(backup/'manifest.json').write_text(json.dumps(manifest))
for entry in manifest:
    dest=destination(entry['path'])
    if dest.exists():
        prior=backup/entry['path'];prior.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dest,prior)
# Preflight is complete before mutating application files.
changed=[]
try:
    for entry in manifest:
        dest=destination(entry['path']);dest.parent.mkdir(parents=True,exist_ok=True)
        temp=dest.with_name(dest.name+'.lab-new')
        shutil.copyfile(source/entry['path'],temp);os.chmod(temp,0o644)
        shutil.chown(temp,user='gravitas' if entry['path'].startswith('backend/') else 'root',group='gravitas' if entry['path'].startswith('backend/') else 'root')
        os.replace(temp,dest);changed.append(entry)
    assert 'MIGRATION_OK' in django("import django; django.setup(); from django.db import connection; from django.db.migrations.executor import MigrationExecutor; from django.core.management import call_command; ex=MigrationExecutor(connection); plan=ex.migration_plan([('core','0076_scientific_lab_runs')]); assert all(m.app_label=='core' and m.name=='0076_scientific_lab_runs' and not backwards for m,backwards in plan); call_command('migrate','core','0076_scientific_lab_runs',interactive=False); call_command('check'); print('MIGRATION_OK')")
    run('systemctl','reload','gravitas-backend')
    healthy=False
    for _ in range(15):
        probe=subprocess.run(['curl','-fsS','--max-time','3','-H','X-Forwarded-Proto: https','http://127.0.0.1:8000/api/health/'],capture_output=True)
        if probe.returncode==0 and b'"ok"' in probe.stdout: healthy=True;break
        time.sleep(1)
    assert healthy, 'Backend health regression'
    assert 'ACCEPTANCE_OK' in django("import django; django.setup(); from django.test import Client; from core.scientific_lab_models import ScientificLabRun; c=Client(HTTP_HOST='localhost'); r=c.get('/api/scientific-lab/catalog/',secure=True); assert r.status_code==401, r.status_code; assert ScientificLabRun.objects.count()==0; print('ACCEPTANCE_OK')")
    # Install but do not enable: real run readiness requires valid operator pricing.
    for name in ['gravitas-scientific-lab.service','gravitas-scientific-lab.timer']:
        target=pathlib.Path('/etc/systemd/system')/name
        assert not target.exists(), 'Unexpected existing Lab worker configuration'
    for name in ['gravitas-scientific-lab.service','gravitas-scientific-lab.timer']:
        shutil.copyfile(source/name,pathlib.Path('/etc/systemd/system')/name)
    run('systemctl','daemon-reload')
    (backup/'SUCCESS').write_text(sha+'\nfeature_disabled=true\nworker_enabled=false\n')
    print('LAB_RELEASE_OK',sha,'feature_disabled=true worker_enabled=false')
except BaseException:
    for entry in reversed(changed):
        dest=destination(entry['path']);prior=backup/entry['path']
        if prior.exists(): shutil.copy2(prior,dest)
        elif dest.exists(): dest.unlink()
    subprocess.run(['systemctl','reload','gravitas-backend'],check=False,timeout=45)
    print('LAB_CODE_ROLLED_BACK; additive migration/data preserved; backup retained')
    raise
