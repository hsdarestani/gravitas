#!/usr/bin/env bash
set -euo pipefail
umask 077

revision=${1:?Expected an immutable Workspace revision}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
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

public() {
  curl --noproxy '*' -fsS --max-time 8 --resolve "$domain:443:127.0.0.1" "https://$domain$1"
}
verify_health() {
  public /api/health/ | python3 -c 'import sys,json; d=json.load(sys.stdin); assert (d["status"],d["database"]) == ("ok","ok")'
}

if [ "$previous" = "$release/source" ] && systemctl is-active --quiet "$worker.timer"; then
  verify_health
  echo "workspace_staging_release=$revision already_active"
  exit 0
fi

install -d -m 0755 "$release"
if [ ! -d "$release/source/.git" ]; then
  git init -q "$release/source"
fi
if [ "$(git -C "$release/source" rev-parse -q --verify HEAD || true)" != "$revision" ]; then
  git -C "$release/source" fetch --no-tags --depth=1 https://github.com/hsdarestani/gravitas.git "$revision"
  git -C "$release/source" checkout --detach -q FETCH_HEAD
fi
test "$(git -C "$release/source" rev-parse HEAD)" = "$revision"
cmp "$previous/backend/requirements.txt" "$release/source/backend/requirements.txt"
chmod -R a+rX "$release"
install -d -m 0755 -o "$identity" -g "$identity" "$release/source/backend/staticfiles"

systemd-run --quiet --wait --pipe --collect --unit "$service-release-prepare" \
  -p "User=$identity" -p "EnvironmentFile=$config/application.env" -p "WorkingDirectory=$release/source/backend" \
  -p MemoryMax=512M -p CPUQuota=75% /bin/bash -eu -c '
    "$1" -m django check
    "$1" -m django migrate --noinput -v 0
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
sed "s|^    root $previous;$|    root $release/source;|" "$backup/site" > "$backup/new-site"
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
ExecStart=$runtime/bin/python -m django provision_studio_team_folder
ExecStart=$runtime/bin/python -m django process_canonical_task_sync --limit 2
TimeoutStartSec=5min
MemoryMax=384M
CPUQuota=50%
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
UNIT
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
  if verify_health >/dev/null 2>&1 && public /assets/workspace-v2/studio-api.js | cmp -s - "$release/source/assets/workspace-v2/studio-api.js"; then
    break
  fi
  sleep 1
done
verify_health
public /assets/workspace-v2/studio-api.js | cmp -s - "$release/source/assets/workspace-v2/studio-api.js"
systemctl enable --now "$worker.timer"
systemctl is-active --quiet "$worker.timer"
echo "workspace_staging_release=$revision studio_team_folder_timer=active"
