#!/usr/bin/env bash
set -euo pipefail
umask 077

revision=8a008862d0ad6f72abd1cba95d368a5b88bc9595
service=gravitas-workspace-staging
identity=gq-workspace-stage
state=/var/lib/gravitas-workspace-staging
base=/opt/gravitas-workspace-staging
release=$base/releases/$revision
config=/etc/gravitas-workspace-staging
unit=/etc/systemd/system/$service.service
domain=staging.graviquest.com

test "$(id -u)" -eq 0
exec 9>/run/lock/gravitas-workspace-staging.lock
flock -n 9
awk '$1 == "MemAvailable:" {exit ($2 < 4194304)}' /proc/meminfo
test "$(nproc)" -ge 4
test "$(df -Pk /var/lib | awk 'NR==2 {print $4}')" -ge 20971520
test "$(df -Pk /opt | awk 'NR==2 {print $4}')" -ge 5242880
docker compose version >/dev/null
for existing in nginx gravitas-backend postgresql; do
  systemctl is-active --quiet "$existing"
done
if [ ! -f "$config/created-by" ]; then
  for path in "$state" "$base" "$config" "$unit"; do
    if [ -e "$path" ]; then
      printf 'Existing path requires review: %s\n' "$path" >&2
      exit 1
    fi
  done
  for port in 15432 18000 18081; do
    test -z "$(ss -ltnH "sport = :$port")"
  done
  for container in "$service-nextcloud" "$service-postgres"; do
    if docker container inspect "$container" >/dev/null 2>&1; then
      printf 'Existing container requires review: %s\n' "$container" >&2
      exit 1
    fi
  done
  if docker network inspect "${service}_isolated" >/dev/null 2>&1; then
    echo 'Existing container network requires review' >&2
    exit 1
  fi
  if getent passwd "$identity" >/dev/null; then
    echo 'Existing Unix user requires review' >&2
    exit 1
  fi
  install -d -m 0700 "$config"
  printf '%s\n' "$service" > "$config/created-by"
fi
test "$(cat "$config/created-by")" = "$service"

if ! getent passwd "$identity" >/dev/null; then
  useradd --system --user-group --home-dir "$state" --shell /usr/sbin/nologin "$identity"
fi
install -d -m 0755 "$base" "$base/releases" "$release"
install -d -m 0750 -o root -g "$identity" "$state"
install -d -m 0755 "$config/postgres-init"
if [ ! -d "$state/postgres" ]; then install -d -m 0700 "$state/postgres"; fi
if [ ! -d "$state/nextcloud" ]; then install -d -m 0755 "$state/nextcloud"; fi
for path in core-uploads topic-media lms-media; do
  install -d -m 0700 -o "$identity" -g "$identity" "$state/$path"
done

if [ ! -f "$config/application.env" ]; then
  db_admin_password=$(openssl rand -hex 32)
  db_app_password=$(openssl rand -hex 32)
  db_cloud_password=$(openssl rand -hex 32)
  nc_admin_password=$(openssl rand -hex 32)
  oidc_secret=$(openssl rand -hex 32)
  django_secret=$(openssl rand -hex 48)
  oidc_key=$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null | base64 -w0)

  cat > "$config/postgres.env" <<ENV
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$db_admin_password
POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256
ENV
  cat > "$config/postgres-init/10-workspace.sql" <<SQL
CREATE ROLE gravitas_workspace_staging LOGIN PASSWORD '$db_app_password';
CREATE ROLE workspace_staging_nextcloud LOGIN PASSWORD '$db_cloud_password';
CREATE DATABASE gravitas_workspace_staging OWNER gravitas_workspace_staging;
CREATE DATABASE workspace_staging_nextcloud OWNER workspace_staging_nextcloud;
REVOKE CONNECT ON DATABASE gravitas_workspace_staging FROM PUBLIC;
REVOKE CONNECT ON DATABASE workspace_staging_nextcloud FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
SQL
  chown root:root "$config/postgres-init/10-workspace.sql"
  chmod 0644 "$config/postgres-init/10-workspace.sql"
  cat > "$config/nextcloud.env" <<ENV
POSTGRES_HOST=postgres-staging:5432
POSTGRES_DB=workspace_staging_nextcloud
POSTGRES_USER=workspace_staging_nextcloud
POSTGRES_PASSWORD=$db_cloud_password
NEXTCLOUD_ADMIN_USER=workspace-staging-admin
NEXTCLOUD_ADMIN_PASSWORD=$nc_admin_password
NEXTCLOUD_TRUSTED_DOMAINS=$domain 127.0.0.1
OVERWRITEHOST=$domain
OVERWRITEPROTOCOL=https
OVERWRITEWEBROOT=/nextcloud
OVERWRITECLIURL=https://$domain/nextcloud
PHP_MEMORY_LIMIT=256M
PHP_UPLOAD_LIMIT=64M
ENV
  cat > "$config/application.env.new" <<ENV
DJANGO_SETTINGS_MODULE=gravitas_backend.workspace_staging_settings
WORKSPACE_STUDIO_ENABLED=1
GQ_STAGING_DB_HOST=127.0.0.1
GQ_STAGING_DB_PORT=15432
GQ_STAGING_DB_PASSWORD=$db_app_password
GQ_STAGING_SECRET_KEY=$django_secret
GQ_STAGING_NEXTCLOUD_INTERNAL_URL=http://127.0.0.1:18081
GQ_STAGING_NEXTCLOUD_PUBLIC_URL=https://$domain/nextcloud
GQ_STAGING_NEXTCLOUD_ADMIN_USER=workspace-staging-admin
GQ_STAGING_NEXTCLOUD_ADMIN_PASSWORD=$nc_admin_password
GQ_STAGING_NEXTCLOUD_OIDC_PROVIDER_ID=1
GQ_STAGING_OIDC_CLIENT_SECRET=$oidc_secret
GQ_STAGING_OIDC_PRIVATE_KEY_B64=$oidc_key
ENV
  mv "$config/application.env.new" "$config/application.env"
fi

if [ ! -d "$release/source/.git" ]; then
  git init -q "$release/source"
fi
if [ "$(git -C "$release/source" rev-parse -q --verify HEAD || true)" != "$revision" ]; then
  git -C "$release/source" fetch --no-tags --depth=1 https://github.com/hsdarestani/gravitas.git "$revision"
  git -C "$release/source" checkout --detach -q FETCH_HEAD
fi
test "$(git -C "$release/source" rev-parse HEAD)" = "$revision"
if [ ! -f "$release/.requirements-installed" ]; then
  python3 -m venv "$release/venv"
  "$release/venv/bin/pip" install --disable-pip-version-check -q -r "$release/source/backend/requirements.txt"
  touch "$release/.requirements-installed"
fi
chmod -R a+rX "$release"
install -d -m 0755 -o "$identity" -g "$identity" "$release/source/backend/staticfiles"

cat > "$config/compose.yml" <<YAML
services:
  postgres-staging:
    image: postgres:18-bookworm
    container_name: $service-postgres
    restart: unless-stopped
    mem_limit: 384m
    cpus: 0.75
    pids_limit: 96
    logging:
      options: {max-size: "10m", max-file: "2"}
    env_file: $config/postgres.env
    command: ["postgres", "-c", "max_connections=35", "-c", "shared_buffers=64MB", "-c", "work_mem=2MB"]
    volumes:
      - $state/postgres:/var/lib/postgresql
      - $config/postgres-init:/docker-entrypoint-initdb.d:ro
    ports: ["127.0.0.1:15432:5432"]
    networks: [isolated]
  nextcloud-staging:
    image: nextcloud:stable-apache
    container_name: $service-nextcloud
    restart: unless-stopped
    mem_limit: 768m
    cpus: 0.75
    pids_limit: 128
    logging:
      options: {max-size: "10m", max-file: "2"}
    env_file: $config/nextcloud.env
    volumes:
      - $state/nextcloud:/var/www/html
    ports: ["127.0.0.1:18081:80"]
    networks: [isolated]
networks:
  isolated:
    driver: bridge
YAML
compose=(docker compose --project-name "$service" --file "$config/compose.yml")
"${compose[@]}" up -d postgres-staging

wait_port() {
  local attempt
  for attempt in $(seq 1 45); do
    if "$@"; then
      return 0
    fi
    sleep 2
  done
  return 1
}
wait_port pg_isready -q -h 127.0.0.1 -p 15432

db_proof=$(docker exec "$service-postgres" psql -XqAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
SELECT CASE WHEN
  has_database_privilege('gravitas_workspace_staging', 'gravitas_workspace_staging', 'CONNECT')
  AND NOT has_database_privilege('gravitas_workspace_staging', 'workspace_staging_nextcloud', 'CONNECT')
  AND has_database_privilege('workspace_staging_nextcloud', 'workspace_staging_nextcloud', 'CONNECT')
  AND NOT has_database_privilege('workspace_staging_nextcloud', 'gravitas_workspace_staging', 'CONNECT')
  AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname IN ('gravitas_workspace_staging','workspace_staging_nextcloud') AND rolsuper)
  THEN 'staging_db_roles_isolated' ELSE 'staging_db_roles_invalid' END;")
test "$db_proof" = staging_db_roles_isolated
printf '%s\n' "$db_proof"

systemd-run --quiet --wait --pipe --collect --unit "$service-prepare" \
  -p "User=$identity" -p "EnvironmentFile=$config/application.env" -p "WorkingDirectory=$release/source/backend" \
  -p MemoryMax=640M -p CPUQuota=75% /bin/bash -eu -c '
    python=$1
    "$python" -m django check
    "$python" -m django migrate --plan >/dev/null
    "$python" -m django migrate --noinput -v 0
    "$python" -m django collectstatic --noinput -v 0
  ' staging "$release/venv/bin/python"

cat > "$unit" <<UNIT
[Unit]
Description=GraviQuest Workspace V2 isolated staging
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=$identity
Group=$identity
WorkingDirectory=$release/source/backend
EnvironmentFile=$config/application.env
ExecStart=$release/venv/bin/gunicorn --bind 127.0.0.1:18000 --workers 2 --threads 2 --timeout 60 gravitas_backend.wsgi:application
Restart=on-failure
RestartSec=5
MemoryMax=640M
CPUQuota=75%
TasksMax=64
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$state/core-uploads $state/topic-media $state/lms-media

[Install]
WantedBy=multi-user.target
UNIT
chmod 0644 "$unit"
systemctl daemon-reload
systemctl enable --now "$service"

health() {
  curl --noproxy '*' -fsS --max-time 3 -H "Host: $domain" -H 'X-Forwarded-Proto: https' \
    'http://127.0.0.1:18000/api/health/' 2>/dev/null | \
    python3 -c 'import json,sys; r=json.load(sys.stdin); assert (r["status"],r["database"]) == ("ok","ok")' 2>/dev/null
}
wait_port health
printf 'workspace_staging_health=ok deployed_revision=%s\n' "$revision"

"${compose[@]}" up -d nextcloud-staging
cloud_status() {
  curl --noproxy '*' -fsS --max-time 3 -H "Host: $domain" 'http://127.0.0.1:18081/status.php' 2>/dev/null | \
    python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["installed"] and not r["maintenance"] and not r["needsDbUpgrade"]' 2>/dev/null
}
wait_port cloud_status
occ() {
  docker exec -u www-data "$service-nextcloud" php occ "$@"
}
occ config:app:set files default_quota --value=512\ MB >/dev/null
printf 'nextcloud_staging_health=ok\n'
for existing in nginx postgresql gravitas-backend gravitas-backend-staging "$service"; do
  printf '%s %s\n' "$existing" "$(systemctl is-active "$existing")"
done
