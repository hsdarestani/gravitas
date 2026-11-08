#!/usr/bin/env bash
# Read-only capacity and prerequisite check. Never prints environment values.
set -euo pipefail
python3 - <<'PY'
import json, os, pathlib, shutil, socket, subprocess
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
except socket.gaierror:
    dns = False
docker = shutil.which('docker')
containers = run(['docker', 'ps', '--format', '{{.Names}}'])[1].splitlines() if docker else []
print(json.dumps({
    'cpu_count': os.cpu_count(),
    'memory_total_mib': int(mem['MemTotal'].split()[0]) // 1024,
    'memory_available_mib': int(mem['MemAvailable'].split()[0]) // 1024,
    'disk_free_gib': round(disk.free / 1024**3, 1),
    'docker_available': bool(docker),
    'running_container_names': containers,
    'forum_dns_resolves': dns,
    'forum_install_exists': pathlib.Path('/var/discourse/containers/graviquest.yml').exists(),
    'forum_env_exists': config.exists(),
    'forum_env_key_presence': {k: k in keys for k in [
        'GRAVITAS_FORUM_URL', 'GRAVITAS_DISCOURSE_CONNECT_SECRET',
        'GRAVITAS_DISCOURSE_API_KEY', 'DISCOURSE_SMTP_ADDRESS',
        'DISCOURSE_SMTP_USER_NAME', 'DISCOURSE_SMTP_PASSWORD',
        'DISCOURSE_NOTIFICATION_EMAIL', 'DISCOURSE_DEVELOPER_EMAILS',
    ]},
    'backend_healthy': run(['curl', '-fsS', '--max-time', '8', '-H', 'X-Forwarded-Proto: https', 'http://127.0.0.1:8000/api/health/'])[0] == 0,
}, indent=2))
PY
