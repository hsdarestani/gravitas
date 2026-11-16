#!/usr/bin/env bash
# Fail-closed, SSH-run Pulsar native worker setup. Never print tokens.
set -Eeuo pipefail
umask 077
test "$(id -u)" = 0
EXPECTED="$1"
SOURCE="$(realpath "$2")"
[[ "$EXPECTED" =~ ^[a-f0-9]{40}$ ]]
test "$(cat /etc/gravitas/last-successful-deploy-sha)" = "$EXPECTED"
exec 9>/run/graviquest-discourse-install.lock
flock -w 45 9
INTEGRATION=/var/discourse/shared/graviquest/graviquest-integration
CONFIG="$INTEGRATION/pulsar-moderation.json"
TOKEN=/etc/gravitas/forum-moderation.token
STATE="$INTEGRATION/pulsar-acceptance-state.json"
PLUGIN=/var/www/discourse/plugins/graviquest-pulsar-moderation/plugin.rb
rails() { docker exec -u discourse -w /var/www/discourse graviquest bundle exec rails runner "$@"; }
on_error() {
  if [ -f "$CONFIG" ]; then
    python3 - "$CONFIG" <<'PY'
import json,os,sys
p=sys.argv[1]
try:
 d=json.load(open(p));d["mode"]="observe";d["production_members"]=False
 with open(p,"w") as f:json.dump(d,f)
 os.chmod(p,0o600)
except Exception:pass
PY
  fi
  echo 'Pulsar setup stopped safely in observe-only mode; consult private host logs.' >&2
}
trap on_error ERR
test -f "$SOURCE/moderation-plugin.rb"
test -f "$SOURCE/pulsar-acceptance.rb"
test -f /etc/gravitas/backend.env
test -f /etc/gravitas/forum.env
test "$(docker inspect -f '{{.State.Running}}' graviquest)" = true
curl -fsS --max-time 10 https://forum.graviquest.com/srv/status >/dev/null
ruby -c "$SOURCE/moderation-plugin.rb" >/dev/null
ruby -c "$SOURCE/pulsar-acceptance.rb" >/dev/null
set -a
. /etc/gravitas/backend.env
. /etc/gravitas/forum.env
set +a
export PYTHONPATH=/opt/gravitas-backend DJANGO_SETTINGS_MODULE=gravitas_backend.settings
runuser -u gravitas -- /opt/gravitas-backend/.venv/bin/python -c 'from core.pulsar_runtime import configured; assert configured(), "Pulsar provider unavailable"'
echo 'Existing Pulsar model configured.'
if ! docker exec -e RAILS_ENV=production -u discourse -w /var/www/discourse graviquest bundle exec ruby script/discourse backup --s3-uploads >/var/log/graviquest-pulsar-backup.log 2>&1; then
  echo 'Native backup failed; nothing changed.' >&2
  exit 1
fi
echo 'Native backup with uploads passed.'
if [ ! -f "$TOKEN" ]; then openssl rand -hex 32 > "$TOKEN"; fi
chown root:gravitas "$TOKEN"
chmod 0640 "$TOKEN"
python3 - "$TOKEN" /etc/gravitas/backend.env <<'PY'
import os,pathlib,sys,tempfile
token=pathlib.Path(sys.argv[1]).read_text().strip()
assert len(token)>=48 and token.isascii() and token.isalnum()
p=pathlib.Path(sys.argv[2])
lines=[l for l in p.read_text().splitlines() if not l.startswith("GRAVITAS_FORUM_MODERATION_TOKEN=")]
lines.append("GRAVITAS_FORUM_MODERATION_TOKEN="+token)
fd,tmp=tempfile.mkstemp(prefix=".pulsar-",dir=str(p.parent))
try:
 with os.fdopen(fd,"w") as f:f.write("\n".join(lines)+"\n")
 os.chown(tmp,p.stat().st_uid,p.stat().st_gid)
 os.chmod(tmp,0o640)
 os.replace(tmp,p)
finally:
 if os.path.exists(tmp):os.unlink(tmp)
PY
systemctl restart gravitas-backend
curl -fsS --retry 8 --retry-delay 2 --max-time 10 https://graviquest.com/api/health/ >/dev/null
echo 'Dedicated private credential installed.'
install -m 0644 "$SOURCE/moderation-plugin.rb" "$INTEGRATION/moderation-plugin.rb"
install -m 0644 "$SOURCE/pulsar-acceptance.rb" "$INTEGRATION/pulsar-acceptance.rb"
chown 1000:1000 "$INTEGRATION/moderation-plugin.rb" "$INTEGRATION/pulsar-acceptance.rb"
if docker exec graviquest test -f "$PLUGIN"; then
  docker cp "graviquest:$PLUGIN" "$INTEGRATION/previous-pulsar-plugin.rb"
  chmod 0600 "$INTEGRATION/previous-pulsar-plugin.rb"
fi
docker exec -u root graviquest mkdir -p /var/www/discourse/plugins/graviquest-pulsar-moderation
docker cp "$SOURCE/moderation-plugin.rb" "graviquest:$PLUGIN"
docker restart graviquest >/dev/null
READY=false
for attempt in $(seq 1 60); do
  if curl -fsS --max-time 5 https://forum.graviquest.com/srv/status >/dev/null 2>&1; then READY=true; break; fi
  sleep 3
done
test "$READY" = true
rails 'abort "Pulsar plugin not loaded" unless defined?(GraviQuestPulsarModeration)'
echo 'Pulsar native worker plugin loaded.'
