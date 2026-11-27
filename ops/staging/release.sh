#!/usr/bin/env bash
set -euo pipefail
umask 077

mode=${1:?Expected inspect, deploy or rollback}
case "$mode" in inspect|deploy|rollback) ;; *) exit 2 ;; esac
revision=${2:?Expected an immutable Git revision}
expected=${3:?Expected the current staging revision}
run_id=${4:?Expected a staging Actions run}
reference=${5:?Expected a sanitized revision reference}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
[[ "$expected" =~ ^[0-9a-f]{40}$ ]]
[[ "$run_id" =~ ^[0-9]{1,20}$ ]]
[[ "$reference" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$ ]]
domain=staging.graviquest.com
service=gravitas-workspace-staging
worker=$service-team-folders
base=/opt/gravitas-workspace-staging
config=/etc/gravitas-workspace-staging
identity=gq-workspace-stage
unit=/etc/systemd/system/$service.service
site=/etc/nginx/sites-available/$service
release=$base/releases/$revision

test "$(id -u)" -eq 0
test "$(cat "$config/created-by")" = "$service"
test "$(systemctl show "$service" -p FragmentPath --value)" = "$unit"
test "$(readlink "/etc/nginx/sites-enabled/$service")" = "$site"
grep -Fxq '# Managed by Workspace V2 staging operations' "$site"
grep -Fq 'server_name staging.graviquest.com;' "$site"
grep -Fxq 'DJANGO_SETTINGS_MODULE=gravitas_backend.workspace_staging_settings' "$config/application.env"
grep -Fxq 'WORKSPACE_STUDIO_ENABLED=1' "$config/application.env"
exec 9>/run/lock/gravitas-workspace-staging.lock
flock -n 9

previous=$(sed -n 's|^WorkingDirectory=\(/opt/gravitas-workspace-staging/releases/[0-9a-f]\{40\}/source\)/backend$|\1|p' "$unit")
[[ "$previous" =~ ^/opt/gravitas-workspace-staging/releases/[0-9a-f]{40}/source$ ]]
runtime=$(sed -n 's|^ExecStart=\(/opt/gravitas-workspace-staging/releases/[0-9a-f]\{40\}/venv\)/bin/gunicorn --bind 127\.0\.0\.1:18000 .*|\1|p' "$unit")
[[ "$runtime" =~ ^/opt/gravitas-workspace-staging/releases/[0-9a-f]{40}/venv$ ]]
grep -Fxq "    root $previous;" "$site"
previous_revision=${previous%/source}
previous_revision=${previous_revision##*/}
test "$previous_revision" = "$expected"

public() {
  curl --noproxy '*' -fsS --max-time 8 --resolve "$domain:443:127.0.0.1" "https://$domain$1"
}
verify_health() {
  public /api/health/ | python3 -c 'import sys,json; d=json.load(sys.stdin); assert (d["status"],d["database"]) == ("ok","ok")'
  public /nextcloud/status.php | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["installed"] and not d["maintenance"]'
}

if [ "$mode" = inspect ]; then
  test "$revision" = "$previous_revision"
  verify_health
  printf 'staging_live_revision=%s\n' "$previous_revision"
  exit 0
fi

# An administrator grants a single release window for the live revision. The
# Actions identity cannot write this file or release an active QA session.
test -f "$config/qa-release"
test "$(stat -c '%u:%a' "$config/qa-release")" = '0:600'
test "$(cat "$config/qa-release")" = "$previous_revision"
if [ "$mode" = rollback ]; then
  test -f "$config/deployments/$revision.json"
  test -f "$release/source/backend/gravitas_backend/staging_metadata.py"
fi
verify_health

install -d -m 0755 "$release"
if [ ! -d "$release/source/.git" ]; then
  git init -q "$release/source"
fi
if [ "$(git -C "$release/source" rev-parse -q --verify HEAD || true)" != "$revision" ]; then
  git -C "$release/source" fetch --no-tags --depth=1 https://github.com/hsdarestani/gravitas.git "$revision"
  git -C "$release/source" checkout --detach -q FETCH_HEAD
fi
test "$(git -C "$release/source" rev-parse HEAD)" = "$revision"
if git -C "$release/source" ls-tree -r HEAD | awk '$1 == 120000 || $1 == 160000 { invalid = 1 } END {exit !invalid}'; then
  echo "staging release contains symlinks or submodules" >&2
  exit 1
fi
cmp "$previous/backend/requirements.txt" "$release/source/backend/requirements.txt"
test -f "$release/source/backend/gravitas_backend/workspace_staging_settings.py"
python3 /usr/local/lib/gravitas-staging/public_pages.py "$release/source"
chmod -R a+rX "$release"
install -d -m 0755 -o "$identity" -g "$identity" "$release/source/backend/staticfiles"

systemd-run --quiet --wait --pipe --collect --unit "$service-release-prepare" \
  -p "User=$identity" -p "EnvironmentFile=$config/application.env" -p "WorkingDirectory=$release/source/backend" \
  -p MemoryMax=512M -p CPUQuota=75% /bin/bash -eu -c '
    "$1" -m django check
    PYTHONPATH="$PWD" "$1" /usr/local/lib/gravitas-staging/check_target.py
    # The shared QA database is never migrated by a generic code switch.
    # An additive migration gets a separate approved staging change with a
    # stage-only backup and a backward-compatibility check.
    "$1" -m django migrate --check
    "$1" -m django collectstatic --noinput -v 0
  ' staging "$runtime/bin/python"

backup=$(mktemp -d "$config/release-backup.XXXXXX")
cp "$unit" "$backup/unit"
cp "$site" "$backup/site"
for suffix in service timer; do
  path="/etc/systemd/system/$worker.$suffix"
  if [ -f "$path" ]; then cp "$path" "$backup/worker.$suffix"; fi
done
old_timer_active=0
if systemctl is-active --quiet "$worker.timer"; then old_timer_active=1; fi
trap 'status=$?; if [ "$status" -ne 0 ]; then
  systemctl stop "$worker.timer" "$worker.service" 2>/dev/null || true
  install -m 0644 "$backup/unit" "$unit"
  install -m 0644 "$backup/site" "$site"
  for suffix in service timer; do
    path="/etc/systemd/system/$worker.$suffix"
    if [ -f "$backup/worker.$suffix" ]; then
      install -m 0644 "$backup/worker.$suffix" "$path"
    else
      if [ "$suffix" = timer ]; then systemctl disable "$worker.timer" 2>/dev/null || true; fi
      rm -f "$path"
    fi
  done
  systemctl daemon-reload
  systemctl restart "$service"
  if [ "$old_timer_active" = 1 ]; then systemctl start "$worker.timer"; fi
  nginx -t && systemctl reload nginx
fi; rm -rf "$backup"; exit "$status"' EXIT

if [ "$old_timer_active" = 1 ]; then systemctl stop "$worker.timer" "$worker.service"; fi
sed "s|^WorkingDirectory=$previous/backend$|WorkingDirectory=$release/source/backend|" "$backup/unit" > "$backup/new-unit"
install -m 0644 "$backup/new-unit" "$unit"
python3 /usr/local/lib/gravitas-staging/site_config.py "$backup/site" "$backup/new-site" "$previous" "$release/source"
install -m 0644 "$backup/new-site" "$site"
nginx -t

cat > "$backup/worker-new.service" <<UNIT
[Unit]
Description=Provision Workspace Studio staging Nextcloud Team Folders
After=$service.service

[Service]
Type=oneshot
User=$identity
Group=$identity
WorkingDirectory=$release/source/backend
EnvironmentFile=$config/application.env
ExecStart=$runtime/bin/python -m django process_canonical_task_sync --limit 2
TimeoutStartSec=5min
MemoryMax=384M
CPUQuota=50%
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
UNIT
if [ -f "$release/source/backend/core/management/commands/provision_studio_team_folder.py" ]; then
  sed -i "/^ExecStart=/i ExecStart=$runtime/bin/python -m django provision_studio_team_folder" "$backup/worker-new.service"
fi
cat > "$backup/worker-new.timer" <<UNIT
[Unit]
Description=Process the Studio staging Nextcloud queue

[Timer]
OnActiveSec=12s
OnUnitInactiveSec=12s
AccuracySec=1s

[Install]
WantedBy=timers.target
UNIT
install -m 0644 "$backup/worker-new.service" "/etc/systemd/system/$worker.service"
install -m 0644 "$backup/worker-new.timer" "/etc/systemd/system/$worker.timer"
systemctl daemon-reload
systemctl restart "$service"
systemctl reload nginx
for attempt in {1..20}; do
  if verify_health >/dev/null 2>&1 && public /site | cmp -s - "$release/source/.staging-public/index.html"; then
    break
  fi
  sleep 1
done
verify_health
public /site | cmp -s - "$release/source/.staging-public/index.html"
systemctl enable --now "$worker.timer"
systemctl is-active --quiet "$worker.timer"
install -d -m 0750 -o root -g "$identity" "$config/deployments"
python3 - "$config" "$revision" "$reference" "$run_id" "$mode" <<'PY'
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

config, revision, ref, run_id, operation = sys.argv[1:]
root = Path(config)
data = dict(revision=revision, ref=ref, run_id=run_id, operation=operation, status='healthy',
            deployed_at=datetime.now(timezone.utc).isoformat())
payload = json.dumps(data) + '\n'
(root / 'deployments' / f'{revision}.json').write_text(payload)
(root / 'deployments' / f'run-{run_id}.json').write_text(payload)
pending = Path('/var/lib/gravitas-workspace-staging/release.json.new')
pending.write_text(payload)
pending.chmod(0o644)
pending.replace(pending.with_name('release.json'))
PY
rm -f "$config/qa-release"
echo "staging_live_revision=$revision"
