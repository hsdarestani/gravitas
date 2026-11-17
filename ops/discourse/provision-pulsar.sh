#!/usr/bin/env bash
# Fail-closed, SSH-run Pulsar native worker setup. Never print tokens.
# Dedicated release queue: do not let unrelated workspace deployments cancel this acceptance.
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
# Ruby syntax is already validated by GitHub CI; host Ruby is not installed.
set -a
. /etc/gravitas/backend.env
. /etc/gravitas/forum.env
set +a
export PYTHONPATH=/opt/gravitas-backend DJANGO_SETTINGS_MODULE=gravitas_backend.settings
runuser -u gravitas -- /opt/gravitas-backend/.venv/bin/python -c 'from core.pulsar_runtime import configured; assert configured(), "Pulsar provider unavailable"'
# The deployed backend must support Cloudflare JSON Schema requests. Without
# this check a schema-only code change could silently be absent on the host.
runuser -u gravitas -- /opt/gravitas-backend/.venv/bin/python -c 'import inspect; from core.pulsar_runtime.providers import ManagedCloudflareProvider; assert "response_format" in inspect.signature(ManagedCloudflareProvider.complete).parameters, "Pulsar structured provider not deployed"'
echo 'Existing Pulsar model and structured moderation provider verified.'
if ! docker exec -e RAILS_ENV=production -u discourse -w /var/www/discourse graviquest bundle exec ruby script/discourse backup --s3-uploads >/var/log/graviquest-pulsar-backup.log 2>&1; then
  echo 'Native backup failed; nothing changed.' >&2
  exit 1
fi
echo 'Native backup with uploads passed.'
if [ ! -f "$TOKEN" ]; then openssl rand -hex 32 > "$TOKEN"; fi
chown root:gravitas "$TOKEN"
chmod 0640 "$TOKEN"
# Re-running acceptance on an already provisioned host must not restart
# Gunicorn. A restart briefly severs the site's API and triggers 502 errors
# for other editors. Only a genuinely new token needs one controlled restart.
TOKEN_UPDATE="$(python3 - "$TOKEN" /etc/gravitas/backend.env <<'PY'
import os,pathlib,sys,tempfile
token=pathlib.Path(sys.argv[1]).read_text().strip()
assert len(token)>=48 and token.isascii() and token.isalnum()
p=pathlib.Path(sys.argv[2])
original=p.read_text()
matches=[line.split("=",1)[1] for line in original.splitlines()
         if line.startswith("GRAVITAS_FORUM_MODERATION_TOKEN=")]
if matches==[token]:
 print("unchanged")
else:
 lines=[l for l in original.splitlines()
        if not l.startswith("GRAVITAS_FORUM_MODERATION_TOKEN=")]
 lines.append("GRAVITAS_FORUM_MODERATION_TOKEN="+token)
 fd,tmp=tempfile.mkstemp(prefix=".pulsar-",dir=str(p.parent))
 try:
  with os.fdopen(fd,"w") as f:f.write("\n".join(lines)+"\n")
  os.chown(tmp,p.stat().st_uid,p.stat().st_gid)
  os.chmod(tmp,0o640)
  os.replace(tmp,p)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
 print("changed")
PY
)"
if [ "$TOKEN_UPDATE" = changed ]; then
  systemctl restart gravitas-backend
  echo 'New scoped token enabled on backend after controlled restart.'
else
  test "$TOKEN_UPDATE" = unchanged
  echo 'Existing scoped token matches; API workers kept running.'
fi
curl -fsS --retry 8 --retry-delay 2 --max-time 10 https://graviquest.com/api/health/ >/dev/null
install -m 0644 "$SOURCE/moderation-plugin.rb" "$INTEGRATION/moderation-plugin.rb"
install -m 0644 "$SOURCE/pulsar-acceptance.rb" "$INTEGRATION/pulsar-acceptance.rb"
chown 1000:1000 "$INTEGRATION/moderation-plugin.rb" "$INTEGRATION/pulsar-acceptance.rb"
# The plugin is already loaded from earlier guarded rollout attempts.
# Update the standalone acceptance runner without restarting Discourse when
# its actual plugin bytes are identical to the reviewed source.
SOURCE_PLUGIN_SHA="$(sha256sum "$SOURCE/moderation-plugin.rb" | awk '{print $1}')"
RUNNING_PLUGIN_SHA="$(docker exec -u root graviquest sha256sum "$PLUGIN" 2>/dev/null | awk '{print $1}' || true)"
if [ "$SOURCE_PLUGIN_SHA" != "$RUNNING_PLUGIN_SHA" ]; then
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
  echo 'Changed native plugin installed and Forum healthy.'
else
  echo 'Native plugin matches reviewed source; Discourse kept running.'
fi
rails 'abort "Pulsar plugin not loaded" unless defined?(GraviQuestPulsarModeration)'
echo 'Pulsar native worker plugin loaded.'

# Three-way decision policy: ordinary science is allowed at an 85-point
# model routing threshold; explicit harmful content needs 98 and literal proof.
# The Pulsar backend accepts bounded JSON/Python-style object literals but
# validates the same exact four fields; do not bypass observe/apply QA.
# A native scheduled job may finish an approval just after the synchronous
# QA runner starts; the disposable-item verification now polls the audit and
# approval state with a strict 45-second deadline.
# Moderation ambiguity stays in manual review. Never suspend by AI alone.
# SSO-created service moderator is not a Django user, cannot be used to log in,
# and can act only through the native plugin. Pilot is a disposable normal user.
# A failed previous rollout leaves only recorded disposable QA identities.
# Reusing the same test account can trigger Discourse duplicate-topic and
# new-user rate limits (HTTP 422). Remove only that exact SSO pilot identity
# and its recorded test content before creating a fresh scoped fixture.
# This never selects actual community users by pattern or email guess.
if [ -f "$STATE" ]; then
  rails /shared/graviquest-integration/pulsar-acceptance.rb cleanup
  test ! -e "$STATE"
  echo 'Stale, exact-ID disposable acceptance account safely cleaned.'
fi
rails /shared/graviquest-integration/pulsar-acceptance.rb bootstrap
python3 - "$STATE" "$TOKEN" "$CONFIG" <<'PY'
import datetime,json,os,sys
state=json.load(open(sys.argv[1]))
assert state["managed_by"]=="gq-pulsar-acceptance-v1"
token=open(sys.argv[2]).read().strip()
cfg={"mode":"observe","token":token,"actor":state["actor"],
 "starts_at":(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=10)).isoformat(),
 "categories":["introductions"],"pilot_author_ids":[state["pilot_id"]],"production_members":False}
with open(sys.argv[3],"w") as f:json.dump(cfg,f)
os.chown(sys.argv[3],1000,1000)
os.chmod(sys.argv[3],0o600)
PY
rails 'c=GraviQuestPulsarModeration.config;abort "Pilot configuration not accepted" unless c && c[0]["mode"] == "observe" && c[2].include?("introductions")'
rails /shared/graviquest-integration/pulsar-acceptance.rb create_observe
rails /shared/graviquest-integration/pulsar-acceptance.rb verify_observe
echo 'Live observe-mode AI decision and native review note passed.'
python3 - "$CONFIG" <<'PY'
import json,sys
p=sys.argv[1];d=json.load(open(p));d["mode"]="apply"
with open(p,"w") as f:json.dump(d,f)
PY
rails /shared/graviquest-integration/pulsar-acceptance.rb create_apply
rails /shared/graviquest-integration/pulsar-acceptance.rb verify_apply
echo 'Live apply-mode approval of disposable pilot post passed.'
rails /shared/graviquest-integration/pulsar-acceptance.rb cleanup
test ! -e "$STATE"

# Only once both real provider tests pass, enable the scoped public rollout.
# Spam, flags, restricted or suspended authors, private rooms and uncertainty
# stay in native human review. No AI-triggered account bans are implemented.
python3 - "$CONFIG" <<'PY'
import json,sys
p=sys.argv[1];d=json.load(open(p))
assert d["mode"]=="apply" and d["pilot_author_ids"]
d["categories"]=["open-question","ai-in-research","discovery","computable-universe",
 "corrections","propose-a-topic","lab-results","introductions"]
d["production_members"]=True
# Do not process historical pending comments from before this policy release.
import datetime
d["starts_at"]=datetime.datetime.now(datetime.timezone.utc).isoformat()
with open(p,"w") as f:json.dump(d,f)
PY
rails 'c=GraviQuestPulsarModeration.config;abort "Public apply rollout was rejected" unless c && c[0]["production_members"] == true && c[0]["mode"] == "apply"'
curl -fsS --max-time 10 https://forum.graviquest.com/srv/status >/dev/null
curl -fsS --max-time 10 https://graviquest.com/api/forum/feed/ >/dev/null
python3 - "$INTEGRATION/pulsar-production-activation.json" "$EXPECTED" <<'PY'
import datetime,json,os,sys
data={"release":sys.argv[2],"mode":"apply","public_members":True,
 "native_plugin_loaded":True,"observe_pilot":"passed","apply_pilot":"passed",
 "qa_cleanup":"passed","recorded_at":datetime.datetime.now(datetime.timezone.utc).isoformat()}
with open(sys.argv[1],"w") as f:json.dump(data,f)
os.chown(sys.argv[1],1000,1000)
os.chmod(sys.argv[1],0o600)
PY
trap - ERR
echo 'PULSAR_PRODUCTION_ACTIVE: live apply mode for eligible public comments; pilot tests passed.'
