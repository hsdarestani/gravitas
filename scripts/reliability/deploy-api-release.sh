#!/usr/bin/env bash
# Run on the production host. Keep public traffic off a reloading gthread pool.
set -Eeuo pipefail
STAGE="$1"; BACKEND_PATH="$2"; REVISION="$3"; DOMAIN="$4"
BACKUP="/var/backups/gravitas-code/$REVISION"
DRAIN="/opt/gravitas-api-drain-$REVISION"
NGINX=/etc/nginx/sites-available/gravitas
UNIT=gravitas-backend-drain.service
# A prior interrupted release needs operator recovery; never kill its live pool.
if sudo systemctl is-active --quiet "$UNIT"; then
  echo 'A previous standby is active; recovery is required before another release.' >&2
  exit 1
fi
sudo grep -q '127.0.0.1:8000' "$NGINX"
if sudo grep -q '127.0.0.1:8001' "$NGINX"; then
  echo 'Nginx still references the standby; recovery is required.' >&2
  exit 1
fi
sudo install -d -m 700 "$BACKUP"
sudo tar --exclude='./.venv' --exclude='./staticfiles' --exclude='*.sqlite3*' \
  -cpf "$BACKUP/backend.tar" -C "$BACKEND_PATH" .
sudo chmod 600 "$BACKUP/backend.tar"
sudo tar -tf "$BACKUP/backend.tar" >/dev/null
sudo cp -p "$NGINX" "$BACKUP/nginx.conf"


restore_code() {
  sudo install -d -m 700 "$BACKUP/restore" || return 1
  sudo tar -xpf "$BACKUP/backend.tar" -C "$BACKUP/restore" || return 1
  sudo rsync -a --delete --checksum --exclude '.venv/' --exclude 'staticfiles/' \
    --exclude '*.sqlite3*' "$BACKUP/restore/" "$BACKEND_PATH/" || return 1
  sudo chown -R gravitas:gravitas "$BACKEND_PATH" || return 1
}

wait_health() {
  local port="$1"
  for attempt in $(seq 1 60); do
    if curl -fsS --max-time 3 -H 'X-Forwarded-Proto: https' \
      "http://127.0.0.1:$port/api/health/" 2>/dev/null | grep -q '"status": "ok"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

route() {
  local config="$1" master old_workers workers remaining
  master="$(sudo systemctl show -p MainPID --value nginx)"
  old_workers="$(pgrep -P "$master" -f 'nginx: worker process' || true)"
  sudo cp "$config" "$NGINX" || return 1
  sudo nginx -t || return 1
  sudo systemctl reload nginx || return 1
  # Old Nginx workers finish their in-flight requests before their upstream dies.
  for attempt in $(seq 1 90); do
    workers="$(pgrep -P "$master" -f 'nginx: worker process' || true)"
    remaining="$(comm -12 <(printf '%s\n' "$old_workers" | sort) <(printf '%s\n' "$workers" | sort))"
    [ -n "$remaining" ] || return 0
    sleep 1
  done
  echo 'Nginx requests have not drained; both upstreams retained.' >&2
  return 1
}

mutated=false
monitor_pid=''
finish_monitor() {
  if [ -n "$monitor_pid" ]; then
    kill "$monitor_pid" 2>/dev/null || true
    wait "$monitor_pid" 2>/dev/null || true
    monitor_pid=''
  fi
}

verify_public_probes() {
  local samples failures
  samples="$(wc -l < "$PROBES")"
  failures="$(grep -c '^failed' "$PROBES" || true)"
  echo "Public health samples=$samples failures=$failures"
  sort "$PROBES" | uniq -c
  if [ "$samples" -eq 0 ] || [ "$failures" -ne 0 ]; then
    return 1
  fi
}
rollback() {
  trap - ERR
  set +e
  echo 'API release failed; restoring code while the standby serves current data.' >&2
  if [ "$mutated" = true ]; then
    if wait_health 8001 && route "$BACKUP/nginx-standby.conf"; then
      restore_code || { finish_monitor; exit 1; }
      sudo systemctl reload gravitas-backend.service
    else
      echo 'Cannot safely drain the public upstream; code and both pools retained.' >&2
      finish_monitor
      exit 1
    fi
  fi
  if wait_health 8000 && route "$BACKUP/nginx.conf"; then
    sudo systemctl stop "$UNIT"
    sudo rm -rf "$DRAIN"
    echo 'Previous API restored; public upstream drained safely.' >&2
  else
    echo 'Recovery incomplete: standby and both code trees retained for recovery.' >&2
  fi
  finish_monitor
  exit 1
}
trap rollback ERR

sudo install -d -o gravitas -g gravitas "$DRAIN"
sudo tar -xpf "$BACKUP/backend.tar" -C "$DRAIN"
sudo ln -s "$BACKEND_PATH/.venv" "$DRAIN/.venv"
if sudo test -d "$BACKEND_PATH/staticfiles"; then
  sudo ln -s "$BACKEND_PATH/staticfiles" "$DRAIN/staticfiles"
fi
sudo chown -R gravitas:gravitas "$DRAIN"
sudo tee "/run/systemd/system/$UNIT" >/dev/null <<EOF
[Unit]
Description=Gravitas temporary drain pool ($REVISION)
After=network.target postgresql.service
[Service]
Type=simple
User=gravitas
Group=gravitas
WorkingDirectory=$DRAIN
EnvironmentFile=/etc/gravitas/backend.env
EnvironmentFile=-/etc/gravitas/openedx.env
Environment=DJANGO_SETTINGS_MODULE=gravitas_backend.settings
ExecStart=$BACKEND_PATH/.venv/bin/gunicorn --worker-class gthread --workers 3 --threads 4 --timeout 60 --graceful-timeout 60 --keep-alive 5 --bind 127.0.0.1:8001 django.core.wsgi:get_wsgi_application()
KillMode=mixed
TimeoutStopSec=75
EOF
sudo systemctl daemon-reload
sudo systemctl reset-failed "$UNIT" 2>/dev/null || true
sudo systemctl start "$UNIT"
wait_health 8001
curl -fsS --max-time 5 -H "Host: $DOMAIN" -H 'X-Forwarded-Proto: https' \
  http://127.0.0.1:8001/api/health/ | grep -q '"status": "ok"'
# Sample the real public TLS/Nginx path continuously, including both switches.
PROBES="$(mktemp)"
(
  body="$(mktemp)"
  trap 'rm -f "$body"' EXIT
  while true; do
    if status="$(curl -sS --noproxy '*' --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" \
      -o "$body" -w '%{http_code}' "https://$DOMAIN/api/health/" 2>/dev/null)" \
      && [ "$status" = 200 ] && grep -q '"status": "ok"' "$body"; then
      echo ok >> "$PROBES"
    else
      echo "failed_http_${status:-000}" >> "$PROBES"
    fi
    sleep 0.2
  done
) &
monitor_pid=$!
sudo sed 's/127\.0\.0\.1:8000/127.0.0.1:8001/g' "$BACKUP/nginx.conf" \
  | sudo tee "$BACKUP/nginx-standby.conf" >/dev/null
route "$BACKUP/nginx-standby.conf"
mutated=true
sudo rsync -a --delete --checksum --delay-updates --exclude '.venv/' --exclude 'staticfiles/' \
  --exclude '*.sqlite3*' "$STAGE/" "$BACKEND_PATH/"
sudo chown -R gravitas:gravitas "$BACKEND_PATH"
MASTER_PID="$(sudo systemctl show -p MainPID --value gravitas-backend.service)"
OLD_WORKERS="$(pgrep -P "$MASTER_PID" || true)"
sudo systemctl reload gravitas-backend.service
ready=false
for attempt in $(seq 1 60); do
  WORKERS="$(pgrep -P "$MASTER_PID" || true)"
  OLD_REMAINING="$(comm -12 <(printf '%s\n' "$OLD_WORKERS" | sort) <(printf '%s\n' "$WORKERS" | sort))"
  WORKER_COUNT="$(printf '%s\n' "$WORKERS" | sed '/^$/d' | wc -l)"
  if [ -z "$OLD_REMAINING" ] && [ "$WORKER_COUNT" -ge 3 ]; then
    wait_health 8000
    ready=true
    break
  fi
  sleep 1
done
test "$ready" = true
for sample in 1 2 3; do
  sudo systemctl is-active --quiet gravitas-backend.service
  wait_health 8000
  sleep 1
done
route "$BACKUP/nginx.conf"
# Confirm the final public path before stopping the standby.
curl -fsS --noproxy '*' --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" \
  "https://$DOMAIN/api/health/" | grep -q '"status": "ok"'
finish_monitor
verify_public_probes
sudo systemctl stop "$UNIT"
trap - ERR
sudo rm -f "/run/systemd/system/$UNIT"
sudo systemctl daemon-reload
sudo rm -rf "$DRAIN"
rm -rf "$STAGE"
rm "$PROBES"
echo 'API release verified; both Nginx transitions drained without a public health failure.'
