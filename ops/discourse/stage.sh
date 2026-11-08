#!/usr/bin/env bash
# Install a new, resource-limited loopback-only service. No nginx changes,
# existing container restarts, database migrations, or user changes here.
set -Eeuo pipefail
test "$(id -u)" = 0
SOURCE="$(realpath "$1")"
exec 9>/run/graviquest-discourse-install.lock
flock -n 9
command -v docker >/dev/null
systemctl is-active --quiet docker
python3 - <<'PY'
from pathlib import Path
import shutil
memory = {k: int(v.split()[0]) for k,v in (line.split(':',1) for line in Path('/proc/meminfo').read_text().splitlines()) if v.strip().endswith('kB')}
assert memory['MemAvailable'] >= 4500*1024, 'Less than 4.5 GiB available; shared host left unchanged.'
assert shutil.disk_usage('/var').free >= 25*1024**3, 'Less than 25 GiB free; shared host left unchanged.'
PY
install -d -m 750 /etc/gravitas
set -a
. /etc/gravitas/backend.env
set +a
export PYTHONPATH=/opt/gravitas-backend DJANGO_SETTINGS_MODULE=gravitas_backend.settings
/opt/gravitas-backend/.venv/bin/python "$SOURCE/ops/discourse/prepare_environment.py"
if [ ! -d /var/discourse ]; then
  git clone https://github.com/discourse/discourse_docker.git /var/discourse
fi
test "$(git -C /var/discourse remote get-url origin)" = https://github.com/discourse/discourse_docker.git
git -C /var/discourse fetch origin 1309ec425ab697996a33b931e309df95c1fbd981
git -C /var/discourse checkout --detach 1309ec425ab697996a33b931e309df95c1fbd981
install -d -m 700 /var/discourse/shared/graviquest/graviquest-integration
INTEGRATION=/var/discourse/shared/graviquest/graviquest-integration
cp /etc/gravitas/forum.json "$INTEGRATION/environment.json"
cp -R "$SOURCE/discourse/theme" "$INTEGRATION/"
cp -R "$SOURCE/assets/logos" "$INTEGRATION/"
cp "$SOURCE/ops/discourse/bootstrap.rb" "$SOURCE/ops/discourse/verify_native.rb" "$INTEGRATION/"
# Read the published CMS content in the existing runtime; no schema writes.
set -a
. /etc/gravitas/backend.env
set +a
export PYTHONPATH=/opt/gravitas-backend DJANGO_SETTINGS_MODULE=gravitas_backend.settings
/opt/gravitas-backend/.venv/bin/python "$SOURCE/ops/discourse/export_published.py" > "$INTEGRATION/content.json"
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
ready=false
for attempt in $(seq 1 60); do
  if curl -fsS --max-time 5 -H 'Host: forum.graviquest.com' -H 'X-Forwarded-Proto: https' http://127.0.0.1:18880/srv/status >/dev/null; then ready=true; break; fi
  sleep 5
done
test "$ready" = true
docker exec -u discourse -w /var/www/discourse graviquest bundle exec rails runner /shared/graviquest-integration/bootstrap.rb
docker exec -u discourse -w /var/www/discourse graviquest bundle exec rails runner /shared/graviquest-integration/verify_native.rb
docker exec -u discourse -w /var/www/discourse graviquest discourse backup > /var/log/graviquest-discourse-backup.log 2>&1
# Restart only this new forum container; prove its own data survives.
docker restart graviquest >/dev/null
sleep 10
docker exec -e GQ_VERIFY_AFTER_RESTART=1 -u discourse -w /var/www/discourse graviquest bundle exec rails runner /shared/graviquest-integration/verify_native.rb
echo 'Internal Discourse staging verified. Port 18880 is loopback-only. Public launch still requires forum DNS and HTTPS.'
