#!/usr/bin/env bash
# Install isolated, resource-limited forum services. Local S3, when explicitly
# requested, gets its own TLS bucket routes. Existing app containers and Django
# users/databases are not restarted or changed here.
set -Eeuo pipefail
test "$(id -u)" = 0
SOURCE="$(realpath "$1")"
exec 9>/run/graviquest-discourse-install.lock
flock -n 9
command -v docker >/dev/null
systemctl is-active --quiet docker
python3 - <<'PY'
from pathlib import Path
import shutil, subprocess
memory = {k: int(v.split()[0]) for k,v in (line.split(':',1) for line in Path('/proc/meminfo').read_text().splitlines()) if v.strip().endswith('kB')}
running = subprocess.run(['docker','inspect','-f','{{.State.Running}}','graviquest'],capture_output=True,text=True).stdout.strip() == 'true'
minimum = 2500 if running else 4500
assert memory['MemAvailable'] >= minimum*1024, 'Insufficient free memory for this installation; existing apps left unchanged.'
assert shutil.disk_usage('/var').free >= 25*1024**3, 'Less than 25 GiB free; shared host left unchanged.'
PY
install -d -m 750 -o root -g gravitas /etc/gravitas
set -a
. /etc/gravitas/backend.env
set +a
export PYTHONPATH=/opt/gravitas-backend DJANGO_SETTINGS_MODULE=gravitas_backend.settings
/opt/gravitas-backend/.venv/bin/python "$SOURCE/ops/discourse/prepare_environment.py"
if [ "${GQ_INSTALL_LOCAL_S3:-0}" = 1 ] || [ -f /etc/graviquest-objectstore/credentials.json ]; then
  bash "$SOURCE/ops/discourse/storage.sh" "$SOURCE"
fi
if [ ! -d /var/discourse ]; then
  git clone https://github.com/discourse/discourse_docker.git /var/discourse
fi
test "$(git -C /var/discourse remote get-url origin)" = https://github.com/discourse/discourse_docker.git
git -C /var/discourse fetch origin 1309ec425ab697996a33b931e309df95c1fbd981
git -C /var/discourse checkout --detach 1309ec425ab697996a33b931e309df95c1fbd981
install -d -m 700 /var/discourse/shared/graviquest/graviquest-integration
INTEGRATION=/var/discourse/shared/graviquest/graviquest-integration
cp /etc/gravitas/forum.json "$INTEGRATION/environment.json"
python3 "$SOURCE/ops/discourse/assemble_theme.py" "$SOURCE" "$INTEGRATION/theme"
cp -R "$SOURCE/assets/logos" "$INTEGRATION/"
cp "$SOURCE/ops/discourse/bootstrap.rb" "$SOURCE/ops/discourse/verify_native.rb" "$INTEGRATION/"
cp "$SOURCE/ops/discourse/storage-plugin.rb" "$INTEGRATION/"
# Read the published CMS content in the existing runtime; no schema writes.
set -a
. /etc/gravitas/backend.env
set +a
export PYTHONPATH=/opt/gravitas-backend DJANGO_SETTINGS_MODULE=gravitas_backend.settings
runuser -u gravitas -- /opt/gravitas-backend/.venv/bin/python "$SOURCE/ops/discourse/export_published.py" > "$INTEGRATION/content.json"
chown -R 1000:1000 "$INTEGRATION"
chmod 700 "$INTEGRATION"
chmod 600 "$INTEGRATION/environment.json"
python3 "$SOURCE/ops/discourse/render_config.py" /etc/gravitas/forum.json /var/discourse/containers/graviquest.yml
cd /var/discourse
if ! docker inspect graviquest >/dev/null 2>&1; then
  test -z "$(ss -lntH sport = :18880)"
  install -m 600 /dev/null /var/log/graviquest-discourse-build.log
  # The official launcher can print environment values. Keep its complete log
  # root-only, and never copy it into GitHub logs or artifacts.
  if ! ./launcher bootstrap graviquest >> /var/log/graviquest-discourse-build.log 2>&1; then
    echo 'Discourse build failed; private diagnostic log: /var/log/graviquest-discourse-build.log' >&2
    exit 1
  fi
  ./launcher start graviquest >> /var/log/graviquest-discourse-build.log 2>&1
else
  test "$(docker inspect -f '{{.State.Running}}' graviquest)" = true
fi
if [ -f /etc/graviquest-objectstore/credentials.json ]; then
  PREVIOUS_PLUGIN="$(docker exec graviquest sha256sum /var/www/discourse/plugins/graviquest-local-object-storage/plugin.rb 2>/dev/null | cut -d' ' -f1 || true)"
  CURRENT_PLUGIN="$(sha256sum "$SOURCE/ops/discourse/storage-plugin.rb" | cut -d' ' -f1)"
  docker exec -u root graviquest mkdir -p /var/www/discourse/plugins/graviquest-local-object-storage
  docker cp "$SOURCE/ops/discourse/storage-plugin.rb" graviquest:/var/www/discourse/plugins/graviquest-local-object-storage/plugin.rb
  if [ "$PREVIOUS_PLUGIN" != "$CURRENT_PLUGIN" ]; then docker restart graviquest >/dev/null; fi
fi
ready=false
for attempt in $(seq 1 60); do
  if curl -fsS --max-time 5 -H 'Host: forum.graviquest.com' -H 'X-Forwarded-Proto: https' http://127.0.0.1:18880/srv/status >/dev/null; then ready=true; break; fi
  sleep 5
done
test "$ready" = true
docker exec -u discourse -w /var/www/discourse graviquest bundle exec rails runner /shared/graviquest-integration/bootstrap.rb
docker exec -e GQ_CLEANUP_INTERRUPTED_ACCEPTANCE=1 -u discourse -w /var/www/discourse graviquest bundle exec rails runner /shared/graviquest-integration/verify_native.rb
docker exec -u discourse -w /var/www/discourse graviquest bundle exec rails runner /shared/graviquest-integration/verify_native.rb
# The system wrapper invokes sudo and is intended for root. Run the official
# CLI directly as its service account, matching the wrapper's production env.
if ! docker exec -e RAILS_ENV=production -u discourse -w /var/www/discourse graviquest bundle exec ruby script/discourse backup --s3-uploads > /var/log/graviquest-discourse-backup.log 2>&1; then
  python3 - <<'PY'
import json, re
from pathlib import Path
log=Path('/var/log/graviquest-discourse-backup.log').read_text()[-6000:]
env=json.loads(Path('/etc/gravitas/forum.json').read_text())
for value in env.values():
    if isinstance(value,str) and len(value)>4:
        log=log.replace(value,'[redacted]')
log=re.sub(r'postgres(?:ql)?://\S+','[redacted database URL]',log)
print('Native backup diagnostic: '+log[-2500:])
PY
  exit 1
fi
# Restart only this new forum container; prove its own data survives.
docker restart graviquest >/dev/null
sleep 10
docker exec -e GQ_VERIFY_AFTER_RESTART=1 -u discourse -w /var/www/discourse graviquest bundle exec rails runner /shared/graviquest-integration/verify_native.rb
echo 'Internal Discourse staging verified. Port 18880 is loopback-only. Public launch still requires forum DNS and HTTPS.'
