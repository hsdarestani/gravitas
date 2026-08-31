#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-gravitasplus.com}"
MODE="${2:-repair}"
ENV_FILE=/etc/gravitas/nextcloud.env
CREDS=/etc/gravitas/nextcloud-admin-credentials
BACKUP_DIR=/var/backups/gravitas-nextcloud
PUBLIC_URL_FILE=/etc/gravitas/nextcloud-public-url
LEGACY_PUBLIC_URL="https://$DOMAIN/nextcloud"
PUBLIC_URL="$LEGACY_PUBLIC_URL"

if [ -s "$PUBLIC_URL_FILE" ]; then
  PUBLIC_URL="$(tr -d '\r\n' < "$PUBLIC_URL_FILE")"
fi
PUBLIC_URL="${PUBLIC_URL%/}"
CANONICAL_CLOUD=0
case "$PUBLIC_URL" in
  https://cloud.*) CANONICAL_CLOUD=1 ;;
  *) PUBLIC_URL="$LEGACY_PUBLIC_URL" ;;
esac

mkdir -p /opt/gravitas-nextcloud /etc/gravitas "$BACKUP_DIR"

if [ "$MODE" = install ] || ! command -v docker >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y docker.io ca-certificates curl openssl python3
fi
systemctl enable --now docker

if [ ! -f "$ENV_FILE" ]; then
  DB_PASS="$(openssl rand -hex 24)"
  ADMIN_PASS="$(openssl rand -hex 18)"
  cat > "$ENV_FILE" <<EOF
NC_DB_PASSWORD=$DB_PASS
NC_ADMIN_USER=gravitascloud
NC_ADMIN_PASSWORD=$ADMIN_PASS
EOF
  chmod 600 "$ENV_FILE"
  printf 'url=https://%s/nextcloud/\nusername=gravitascloud\npassword=%s\n' "$DOMAIN" "$ADMIN_PASS" > "$CREDS"
  chmod 600 "$CREDS"
fi
# shellcheck disable=SC1090
. "$ENV_FILE"

# Give the Django service only the service credentials it needs. The values
# remain in the root-owned environment file and are never shipped to browsers.
touch /etc/gravitas/backend.env
sed -i '/^NEXTCLOUD_INTERNAL_URL=/d;/^NEXTCLOUD_ADMIN_USER=/d;/^NEXTCLOUD_ADMIN_PASSWORD=/d' /etc/gravitas/backend.env
printf 'NEXTCLOUD_INTERNAL_URL=http://127.0.0.1:8081\nNEXTCLOUD_ADMIN_USER=%s\nNEXTCLOUD_ADMIN_PASSWORD=%s\n' \
  "$NC_ADMIN_USER" "$NC_ADMIN_PASSWORD" >> /etc/gravitas/backend.env
chown root:gravitas /etc/gravitas/backend.env
chmod 640 /etc/gravitas/backend.env

docker network inspect gravitas-nextcloud >/dev/null 2>&1 || docker network create gravitas-nextcloud >/dev/null
docker volume inspect gravitas_nextcloud_db >/dev/null 2>&1 || docker volume create gravitas_nextcloud_db >/dev/null
docker volume inspect gravitas_nextcloud_html >/dev/null 2>&1 || docker volume create gravitas_nextcloud_html >/dev/null

if [ "$MODE" = install ]; then
  docker pull postgres:16-alpine
  docker pull redis:7-alpine
  docker pull nextcloud:stable-apache
fi

ensure_container() {
  local name="$1"
  shift
  if docker container inspect "$name" >/dev/null 2>&1; then
    docker start "$name" >/dev/null 2>&1 || true
  else
    docker run -d --name "$name" --restart unless-stopped "$@" >/dev/null
  fi
}

ensure_container gravitas-nextcloud-db \
  --network gravitas-nextcloud \
  -e POSTGRES_DB=nextcloud \
  -e POSTGRES_USER=nextcloud \
  -e POSTGRES_PASSWORD="$NC_DB_PASSWORD" \
  -v gravitas_nextcloud_db:/var/lib/postgresql/data \
  postgres:16-alpine

ensure_container gravitas-nextcloud-redis \
  --network gravitas-nextcloud \
  redis:7-alpine redis-server --appendonly yes

ensure_container gravitas-nextcloud \
  --network gravitas-nextcloud \
  -p 127.0.0.1:8081:80 \
  -e POSTGRES_HOST=gravitas-nextcloud-db \
  -e POSTGRES_DB=nextcloud \
  -e POSTGRES_USER=nextcloud \
  -e POSTGRES_PASSWORD="$NC_DB_PASSWORD" \
  -e REDIS_HOST=gravitas-nextcloud-redis \
  -e NEXTCLOUD_ADMIN_USER="$NC_ADMIN_USER" \
  -e NEXTCLOUD_ADMIN_PASSWORD="$NC_ADMIN_PASSWORD" \
  -e NEXTCLOUD_TRUSTED_DOMAINS="$DOMAIN" \
  -e TRUSTED_PROXIES=172.16.0.0/12 \
  -e OVERWRITEHOST="$DOMAIN" \
  -e OVERWRITEPROTOCOL=https \
  -e OVERWRITEWEBROOT=/nextcloud \
  -e OVERWRITECLIURL="https://$DOMAIN/nextcloud" \
  -v gravitas_nextcloud_html:/var/www/html \
  nextcloud:stable-apache

# The legacy /nextcloud reverse proxy is only an install/bootstrap concern.
# Once subdomain.sh has moved the instance to cloud.<domain>, repair must not
# race the persistent route guard by rewriting the main vhost back to legacy.
if [ "$CANONICAL_CLOUD" -eq 0 ]; then
python3 - <<'PY'
from pathlib import Path
import re
p = Path('/etc/nginx/sites-available/gravitas')
if not p.exists():
    raise SystemExit('Gravitas nginx config is missing')
s = p.read_text()
s = re.sub(r'\n\s*# BEGIN GRAVITAS NEXTCLOUD.*?# END GRAVITAS NEXTCLOUD\s*\n', '\n', s, flags=re.S)
m = re.search(r'(?m)^(?P<indent>\s*)location / \{', s)
if not m:
    raise SystemExit('Could not find Gravitas frontend location in nginx config')
i = m.group('indent')
block = f'''{i}# BEGIN GRAVITAS NEXTCLOUD
{i}location = /nextcloud {{ return 301 /nextcloud/; }}
{i}location = /.well-known/carddav {{ return 301 /nextcloud/remote.php/dav; }}
{i}location = /.well-known/caldav {{ return 301 /nextcloud/remote.php/dav; }}
{i}location ^~ /nextcloud/ {{
{i}    proxy_pass http://127.0.0.1:8081/;
{i}    proxy_http_version 1.1;
{i}    proxy_set_header Host $host;
{i}    proxy_set_header X-Real-IP $remote_addr;
{i}    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
{i}    proxy_set_header X-Forwarded-Proto $scheme;
{i}    proxy_set_header X-Forwarded-Host $host;
{i}    proxy_set_header X-Forwarded-Prefix /nextcloud;
{i}    proxy_request_buffering off;
{i}    proxy_buffering off;
{i}    client_max_body_size 2G;
{i}    proxy_connect_timeout 60s;
{i}    proxy_send_timeout 3600s;
{i}    proxy_read_timeout 3600s;
{i}}}
{i}# END GRAVITAS NEXTCLOUD
'''
s = s[:m.start()] + block + s[m.start():]
p.write_text(s)
PY
fi

nginx -t
systemctl reload nginx

for _ in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:8081/status.php >/tmp/nextcloud-status.json 2>/dev/null; then
    break
  fi
  sleep 3
done
curl -fsS http://127.0.0.1:8081/status.php >/tmp/nextcloud-status.json

for _ in $(seq 1 60); do
  if docker exec -u www-data gravitas-nextcloud php occ status >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

docker exec -u www-data gravitas-nextcloud php occ status >/dev/null
if [ "$CANONICAL_CLOUD" -eq 1 ]; then
  CLOUD_HOST="${PUBLIC_URL#https://}"
  docker exec -u www-data gravitas-nextcloud php occ config:system:set overwrite.cli.url --value="$PUBLIC_URL" >/dev/null
  docker exec -u www-data gravitas-nextcloud php occ config:system:set overwritehost --value="$CLOUD_HOST" >/dev/null
  docker exec -u www-data gravitas-nextcloud php occ config:system:delete overwritewebroot >/dev/null 2>&1 || true
else
  docker exec -u www-data gravitas-nextcloud php occ config:system:set overwrite.cli.url --value="$LEGACY_PUBLIC_URL" >/dev/null
  docker exec -u www-data gravitas-nextcloud php occ config:system:set overwritehost --value="$DOMAIN" >/dev/null
  docker exec -u www-data gravitas-nextcloud php occ config:system:set overwritewebroot --value=/nextcloud >/dev/null
fi
docker exec -u www-data gravitas-nextcloud php occ config:system:set overwriteprotocol --value=https >/dev/null
docker exec -u www-data gravitas-nextcloud php occ config:system:set default_phone_region --value=DE >/dev/null
docker exec -u www-data gravitas-nextcloud php occ background:cron >/dev/null
docker exec -u www-data gravitas-nextcloud php occ config:system:set maintenance_window_start --type=integer --value=1 >/dev/null || true

cat > /etc/systemd/system/gravitas-nextcloud-cron.service <<'EOF'
[Unit]
Description=Nextcloud background jobs for Gravitas
Requires=docker.service
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/docker exec -u www-data gravitas-nextcloud php -f /var/www/html/cron.php
EOF
cat > /etc/systemd/system/gravitas-nextcloud-cron.timer <<'EOF'
[Unit]
Description=Run Gravitas Nextcloud background jobs every 5 minutes
[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
Persistent=true
[Install]
WantedBy=timers.target
EOF

cat > /usr/local/sbin/gravitas-nextcloud-backup <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DIR=/var/backups/gravitas-nextcloud
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DIR"
docker exec -u www-data gravitas-nextcloud php occ maintenance:mode --on >/dev/null || true
trap 'docker exec -u www-data gravitas-nextcloud php occ maintenance:mode --off >/dev/null 2>&1 || true' EXIT
docker exec gravitas-nextcloud-db pg_dump -U nextcloud -Fc nextcloud > "$DIR/db-$STAMP.dump"
docker run --rm -v gravitas_nextcloud_html:/source:ro -v "$DIR":/backup alpine:3.20 \
  sh -c "tar -czf /backup/html-$STAMP.tar.gz -C /source config custom_apps data 2>/dev/null || tar -czf /backup/html-$STAMP.tar.gz -C /source config data"
find "$DIR" -type f -mtime +7 -delete
EOF
chmod 750 /usr/local/sbin/gravitas-nextcloud-backup
cat > /etc/systemd/system/gravitas-nextcloud-backup.service <<'EOF'
[Unit]
Description=Backup Gravitas Nextcloud
Requires=docker.service
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/gravitas-nextcloud-backup
EOF
cat > /etc/systemd/system/gravitas-nextcloud-backup.timer <<'EOF'
[Unit]
Description=Daily Gravitas Nextcloud backup
[Timer]
OnCalendar=*-*-* 04:15:00
Persistent=true
RandomizedDelaySec=15m
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now gravitas-nextcloud-cron.timer gravitas-nextcloud-backup.timer

# Follow redirects only in legacy mode; in canonical mode the health endpoint is
# checked directly so a redirect cannot masquerade as a healthy JSON response.
curl -fsS "$PUBLIC_URL/status.php" | grep -q '"installed":true'
docker exec -u www-data gravitas-nextcloud php occ status
systemctl try-restart gravitas-backend.service || true
