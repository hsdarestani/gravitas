#!/usr/bin/env bash
# User-authorized isolated local S3 installation. No existing container restarts.
set -Eeuo pipefail
test "$(id -u)" = 0
SOURCE="$(realpath "$1")"
exec 8>/run/graviquest-objectstore-install.lock
flock -n 8
python3 - <<'PY'
from pathlib import Path
import shutil, platform
mem={k:int(v.split()[0]) for k,v in (line.split(':',1) for line in Path('/proc/meminfo').read_text().splitlines()) if v.strip().endswith('kB')}
assert platform.machine()=='x86_64', 'Pinned storage binary requires x86_64'
assert mem['MemAvailable']>=3*1024**2, 'Preserve 3 GiB available RAM before installing storage'
assert shutil.disk_usage('/var').free>=50*1024**3, 'Preserve 50 GiB free storage before installation'
PY
install -d -m 755 /opt/graviquest-objectstore
if [ ! -x /opt/graviquest-objectstore/weed ]; then
  ARCHIVE="$(mktemp /tmp/graviquest-seaweedfs.XXXXXX)"
  trap 'rm -f "$ARCHIVE"' EXIT
  curl --fail --location --proto '=https' --tlsv1.2 --retry 2 -o "$ARCHIVE" https://github.com/seaweedfs/seaweedfs/releases/download/4.52/linux_amd64.tar.gz
  printf '%s  %s\n' 8b538c22d47d0c3fb6792adaa6b0c735a967401270a53427d5a476dcaca9b7ae "$ARCHIVE" | sha256sum -c -
  tar -xzf "$ARCHIVE" -C /opt/graviquest-objectstore weed
  chmod 755 /opt/graviquest-objectstore/weed
fi
install -m 600 "$SOURCE/ops/discourse/storage.py" /opt/graviquest-objectstore/storage.py
if [ ! -x /opt/graviquest-objectstore/venv/bin/python ]; then
  python3 -m venv /opt/graviquest-objectstore/venv
fi
/opt/graviquest-objectstore/venv/bin/python -m pip install --quiet boto3==1.43.126
PYTHON=/opt/graviquest-objectstore/venv/bin/python
"$PYTHON" /opt/graviquest-objectstore/storage.py setup
"$PYTHON" /opt/graviquest-objectstore/storage.py provision
# Reuse the existing, valid apex TLS certificate. Forum A/AAAA currently point
# to a different host, so this installation must not depend on new DNS or ACME.
curl -fsS --max-time 15 https://graviquest.com/api/health/ >/dev/null
"$PYTHON" /opt/graviquest-objectstore/storage.py main-https
"$PYTHON" /opt/graviquest-objectstore/storage.py verify
"$PYTHON" /opt/graviquest-objectstore/storage.py connect
"$PYTHON" /opt/graviquest-objectstore/storage.py monitor
systemctl is-active --quiet graviquest-objectstore
# Existing shared backend and containers are inspected, not restarted.
curl -fsS --max-time 10 -H 'X-Forwarded-Proto: https' http://127.0.0.1:8000/api/health/ >/dev/null
curl -fsS --max-time 15 https://graviquest.com/api/health/ >/dev/null
curl -fsS --max-time 15 https://graviquest.com/forum.html >/dev/null
curl -fsS --max-time 15 https://graviquest.com/ >/dev/null
echo 'Private self-hosted S3 installed and verified; existing GraviQuest backend remains healthy.'
