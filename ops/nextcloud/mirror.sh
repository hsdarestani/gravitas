#!/usr/bin/env bash
set -euo pipefail

BACKEND_PATH="${1:-/opt/gravitas-backend}"
ENV_FILE=/etc/gravitas/backend.env
NC_CONTAINER="${NC_CONTAINER:-gravitas-nextcloud}"
NC_NETWORK="${NC_NETWORK:-gravitas-nextcloud}"

if [ ! -x "$BACKEND_PATH/.venv/bin/django-admin" ]; then
  echo "Gravitas backend virtualenv is not ready at $BACKEND_PATH" >&2
  exit 1
fi
if [ ! -r "$ENV_FILE" ]; then
  echo "Gravitas backend environment is missing: $ENV_FILE" >&2
  exit 1
fi

# Nextcloud's brute-force protection keys failed Basic-auth attempts by the
# address it sees. All trusted server-to-server traffic reaches the container
# through the private Docker gateway. A historical credential mismatch can
# therefore throttle the otherwise-correct service account forever after the
# password has been repaired. Reset only the private internal addresses during
# provisioning; public client addresses and global protection stay untouched.
reset_internal_bruteforce() {
  local gateway=""
  gateway="$(docker network inspect "$NC_NETWORK" --format '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)"
  for ip in 127.0.0.1 ::1 "$gateway"; do
    [ -n "$ip" ] || continue
    docker exec -u www-data "$NC_CONTAINER" php occ security:bruteforce:reset "$ip" >/dev/null 2>&1 || true
  done
}

reset_internal_bruteforce

cat > /etc/systemd/system/gravitas-nextcloud-mirror.service <<EOF
[Unit]
Description=Reconcile Gravitas with native Nextcloud Notes and Deck
After=network-online.target gravitas-backend.service docker.service
Wants=network-online.target
Requires=gravitas-backend.service docker.service

[Service]
Type=oneshot
User=gravitas
Group=gravitas
WorkingDirectory=$BACKEND_PATH
EnvironmentFile=$ENV_FILE
Environment=DJANGO_SETTINGS_MODULE=gravitas_backend.settings
Environment=PYTHONPATH=$BACKEND_PATH
ExecStart=$BACKEND_PATH/.venv/bin/django-admin reconcile_nextcloud_native
Nice=5
EOF

cat > /etc/systemd/system/gravitas-nextcloud-mirror.timer <<'EOF'
[Unit]
Description=Keep Gravitas and native Nextcloud apps mirrored

[Timer]
OnBootSec=45s
OnUnitActiveSec=2min
AccuracySec=15s
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now gravitas-nextcloud-mirror.timer
systemctl reset-failed gravitas-nextcloud-mirror.service >/dev/null 2>&1 || true

# Reconcile once now as part of deploy. Keep infrastructure provisioning
# recoverable, but make a failure immediately diagnosable in the Actions log;
# the dedicated verification step later in the workflow remains the hard gate.
if ! systemctl start gravitas-nextcloud-mirror.service; then
  echo "Initial Gravitas ↔ Nextcloud reconciliation failed; timer will retry." >&2
  systemctl --no-pager --full status gravitas-nextcloud-mirror.service >&2 || true
  journalctl -u gravitas-nextcloud-mirror.service -n 80 --no-pager >&2 || true
fi
systemctl is-enabled gravitas-nextcloud-mirror.timer >/dev/null
systemctl is-active gravitas-nextcloud-mirror.timer >/dev/null

echo "Gravitas Nextcloud mirror timer installed (2 minute cadence)."
