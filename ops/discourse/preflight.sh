#!/usr/bin/env bash
# Read-only capacity and prerequisite check. Never prints environment values.
set -euo pipefail
python3 - <<'PY'
import json, os, pathlib, shutil, socket, subprocess, urllib.request, urllib.error
def run(argv):
    p = subprocess.run(argv, capture_output=True, text=True, timeout=15)
    return p.returncode, p.stdout.strip()
mem = dict(line.split(':', 1) for line in pathlib.Path('/proc/meminfo').read_text().splitlines())
disk = shutil.disk_usage('/var')
config = pathlib.Path('/etc/gravitas/forum.env')
keys = set()
if config.exists():
    keys = {line.split('=', 1)[0].strip() for line in config.read_text().splitlines() if '=' in line and not line.startswith('#')}
try:
    socket.getaddrinfo('forum.graviquest.com', 443)
    dns = True
    dns_error = None
except socket.gaierror as exc:
    dns = False
    dns_error = exc.errno
environment_path = pathlib.Path('/etc/gravitas/forum.json')
environment = json.loads(environment_path.read_text()) if environment_path.exists() else {}
acceptance_path = pathlib.Path('/var/discourse/shared/graviquest/graviquest-integration/acceptance-results.json')
acceptance = json.loads(acceptance_path.read_text()) if acceptance_path.exists() else {}
storage_path=pathlib.Path('/etc/graviquest-objectstore/acceptance.json')
storage=json.loads(storage_path.read_text()) if storage_path.exists() else {}
acceptance_keys = ['native_workflows_verified', 'private_category_permissions_verified',
                   'private_uploads_verified', 'restart_persistence_verified',
                   'acceptance_cleanup_complete', 'browser_sso_verified', 'email_delivery_verified']
docker = shutil.which('docker')
backend_env = pathlib.Path('/etc/gravitas/backend.env')
backend_keys = {}
cf_token = None
provider = {}
if backend_env.exists():
    for line in backend_env.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            backend_keys[k.strip()] = bool(v.strip().strip('\"\''))
            if k.strip() == 'CLOUDFLARE_AI_API_TOKEN': cf_token=v.strip().strip(chr(34)+chr(39))
if cf_token:
    try:
        req=urllib.request.Request('https://api.cloudflare.com/client/v4/zones?name=graviquest.com',headers={'Authorization':'Bearer '+cf_token,'Accept':'application/json'})
        with urllib.request.urlopen(req,timeout=12) as response: zones=json.load(response).get('result',[])
        provider={'existing_cloudflare_token_can_read_zone': bool(zones), 'zone_states':[z.get('status') for z in zones], 'zone_permissions':[z.get('permissions',[]) for z in zones]}
    except urllib.error.HTTPError as exc:
        provider={'existing_cloudflare_token_can_read_zone':False,'http_status':exc.code}
    except Exception as exc:
        provider={'existing_cloudflare_token_can_read_zone':False,'error_type':type(exc).__name__}
else:
    provider={'existing_cloudflare_token_present':False}
containers = run(['docker', 'ps', '--format', '{{.Names}}'])[1].splitlines() if docker else []
print(json.dumps({
    'cpu_count': os.cpu_count(),
    'memory_total_mib': int(mem['MemTotal'].split()[0]) // 1024,
    'memory_available_mib': int(mem['MemAvailable'].split()[0]) // 1024,
    'disk_free_gib': round(disk.free / 1024**3, 1),
    'docker_available': bool(docker),
    'running_container_names': containers,
    'forum_dns_resolves': dns,
    'existing_dns_provider_access': provider,
    'forum_dns_addresses': sorted({item[4][0] for item in socket.getaddrinfo('forum.graviquest.com',443)}) if dns else [],
    'main_dns_addresses': sorted({item[4][0] for item in socket.getaddrinfo('graviquest.com',443)}),
    'local_storage_service_active': run(['systemctl','is-active','--quiet','graviquest-objectstore'])[0]==0,
    'local_storage_resource_usage': run(['systemctl','show','graviquest-objectstore','--property=MemoryCurrent,CPUUsageNSec,TasksCurrent'])[1],
    'storage_acceptance': storage,
    'storage_health_timer_active': run(['systemctl','is-active','--quiet','graviquest-objectstore-health.timer'])[0]==0,
    'storage_health_last_result': run(['systemctl','show','graviquest-objectstore-health.service','--property=Result'])[1],
    'public_storage_listing_http_status': run(['curl','-sS','--max-time','8','-o','/dev/null','-w','%{http_code}','https://graviquest.com/graviquest-uploads?list-type=2'])[1],
    'existing_public_forum_page_healthy': run(['curl','-fsS','--max-time','8','-o','/dev/null','https://graviquest.com/forum.html'])[0]==0,
    'forum_dns_matches_main': {item[4][0] for item in socket.getaddrinfo('forum.graviquest.com',443)}.issubset({item[4][0] for item in socket.getaddrinfo('graviquest.com',443)}) if dns else False,
    'forum_certificate_exists': pathlib.Path('/etc/letsencrypt/live/forum.graviquest.com/fullchain.pem').exists(),
    'forum_dns_error_code': dns_error,
    'forum_install_exists': pathlib.Path('/var/discourse/containers/graviquest.yml').exists(),
    'reviewed_django_forum_feature_deployed': pathlib.Path('/opt/gravitas-backend/core/forum.py').exists(),
    'private_s3_configuration_present': all(environment.get(k) for k in [
        'DISCOURSE_S3_ACCESS_KEY_ID', 'DISCOURSE_S3_SECRET_ACCESS_KEY',
        'DISCOURSE_S3_REGION', 'DISCOURSE_S3_UPLOAD_BUCKET']),
    'native_acceptance': {k:bool(acceptance.get(k)) for k in acceptance_keys},
    'forum_internal_http_healthy': run(['curl', '-fsS', '--max-time', '8', '-H', 'Host: forum.graviquest.com',
                                      '-H', 'X-Forwarded-Proto: https', 'http://127.0.0.1:18880/srv/status'])[0] == 0,
    'forum_env_exists': config.exists(),
    'existing_mail_credential_configured': backend_keys.get('EMAIL_HOST_PASSWORD', False),
    'loopback_port_18880_available': run(['bash', '-c', 'test -z "$(ss -lntH sport = :18880)"'])[0] == 0,
    'forum_env_key_presence': {k: k in keys for k in [
        'GRAVITAS_FORUM_URL', 'GRAVITAS_DISCOURSE_CONNECT_SECRET',
        'GRAVITAS_DISCOURSE_API_KEY',
    ]},
    'backend_healthy': run(['curl', '-fsS', '--max-time', '8', '-H', 'X-Forwarded-Proto: https', 'http://127.0.0.1:8000/api/health/'])[0] == 0,
}, indent=2))
PY
