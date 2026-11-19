#!/usr/bin/env bash
# Existing native theme, shared public widget, one narrowly scoped API route.
# Compilation and HTTP failures restore the exported theme and nginx vhost.
set -euo pipefail
SOURCE="${1:?source checkout required}"
VHOST=/etc/nginx/sites-available/graviquest-forum
test -f "$VHOST"
test -d /var/discourse/shared/graviquest/graviquest-integration
test -f "$SOURCE/discourse/theme/javascripts/discourse/api-initializers/graviquest-pulsar.js"
FINGERPRINT=$(cat "$SOURCE/assets/chat.js" "$SOURCE/assets/chat.css" "$SOURCE/ops/discourse/public-pulsar.conf" "$SOURCE/ops/discourse/assemble_theme.py" "$SOURCE/discourse/theme/javascripts/discourse/api-initializers/graviquest-pulsar.js" | sha256sum | cut -d' ' -f1)
MARKER=/var/discourse/shared/graviquest/graviquest-integration/public-pulsar-sha
if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$FINGERPRINT" ]; then
  echo 'Shared public Pulsar already installed on the Forum.'
  exit 0
fi
RELEASE="pulsar-$(date +%Y%m%d%H%M%S)"
SHARED="/var/discourse/shared/graviquest/graviquest-integration/$RELEASE"
CONTAINER="/shared/graviquest-integration/$RELEASE"
BACKUP="/var/backups/graviquest-forum-pulsar/$RELEASE"
install -d -m 700 "$BACKUP"
install -d -m 700 "$SHARED"
cp "$VHOST" "$BACKUP/nginx.previous"
if [ -f /etc/nginx/snippets/graviquest-public-pulsar.conf ]; then
  cp /etc/nginx/snippets/graviquest-public-pulsar.conf "$BACKUP/pulsar.previous"
fi
python3 "$SOURCE/ops/discourse/assemble_theme.py" "$SOURCE" "$SHARED/candidate"
cp "$SOURCE/ops/discourse/deploy_theme.rb" "$SHARED/"
rollback() {
  STATUS=$?
  if [ "$STATUS" -ne 0 ]; then
    echo 'Public Pulsar installation failed; restoring the previous Forum theme and route.'
    docker exec -u discourse -w /var/www/discourse -e GQ_THEME_RELEASE="$CONTAINER" -e GQ_THEME_MODE=rollback graviquest bundle exec rails runner "$CONTAINER/deploy_theme.rb" || true
    cp "$BACKUP/nginx.previous" "$VHOST"
    if [ -f "$BACKUP/pulsar.previous" ]; then
      cp "$BACKUP/pulsar.previous" /etc/nginx/snippets/graviquest-public-pulsar.conf
    else
      install -m 644 /dev/null /etc/nginx/snippets/graviquest-public-pulsar.conf
    fi
    nginx -t && systemctl reload nginx
  fi
}
trap rollback EXIT
install -m 644 "$SOURCE/ops/discourse/public-pulsar.conf" /etc/nginx/snippets/graviquest-public-pulsar.conf
python3 - "$VHOST" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); text=p.read_text()
anchor='    include /etc/nginx/snippets/graviquest-storage.conf;'
addition='    include /etc/nginx/snippets/graviquest-public-pulsar.conf;'
if addition not in text:
    if text.count(anchor)!=1: raise SystemExit('Unexpected Forum vhost; no change made')
    p.write_text(text.replace(anchor,anchor+'\n'+addition))
PY
nginx -t
systemctl reload nginx
chown -R 1000:1000 "$SHARED"
docker exec -u discourse -w /var/www/discourse -e GQ_THEME_RELEASE="$CONTAINER" -e GQ_THEME_MODE=apply graviquest bundle exec rails runner "$CONTAINER/deploy_theme.rb"
curl -fsS --max-time 15 https://forum.graviquest.com/srv/status >/dev/null
# Empty input returns before any context lookup or model invocation. Validate
# the proxy/application route without running functional AI acceptance.
REPLY=$(curl -sS --max-time 20 -w '\n%{http_code}' -H 'Content-Type: application/json' --data '{"message":""}' https://forum.graviquest.com/gq-pulsar/ask/)
python3 -c 'import json,sys; body,status=sys.argv[1].rsplit("\n",1); r=json.loads(body); assert status=="400" and r.get("error")=="message_required"' "$REPLY"
printf '%s\n' "$FINGERPRINT" > "$MARKER"
echo "Shared public Pulsar compiled on the Forum. Previous theme: $SHARED/previous"
