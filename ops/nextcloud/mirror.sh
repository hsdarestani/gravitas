#!/usr/bin/env bash
set -euo pipefail

BACKEND_PATH="${1:-/opt/gravitas-backend}"
ENV_FILE=/etc/gravitas/backend.env

if [ ! -x "$BACKEND_PATH/.venv/bin/django-admin" ]; then
  echo "Gravitas backend virtualenv is not ready at $BACKEND_PATH" >&2
  exit 1
fi
if [ ! -r "$ENV_FILE" ]; then
  echo "Gravitas backend environment is missing: $ENV_FILE" >&2
  exit 1
fi

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

# Reconcile once now as part of deploy. A transient app/API failure must not
# make infrastructure provisioning destructive; the timer will retry in two
# minutes and its unit status remains available for diagnostics.
systemctl start gravitas-nextcloud-mirror.service || true
systemctl is-enabled gravitas-nextcloud-mirror.timer >/dev/null
systemctl is-active gravitas-nextcloud-mirror.timer >/dev/null

echo "Gravitas Nextcloud mirror timer installed (2 minute cadence)."
