#!/usr/bin/env bash
# The existing infrastructure operator may run this without moving the QA slot.
set -euo pipefail
umask 077
service=gravitas-workspace-staging
config=/etc/$service
state=/var/lib/$service
backup=/var/backups/$service
db=$service-postgres
cloud=$service-nextcloud
unit=/etc/systemd/system/$service.service
vhost=/etc/nginx/sites-available/$service
worktree=/opt/$service
domain=staging.graviquest.com
operation=${1:-inventory}
case "$operation" in inventory|rehearse) ;; *) exit 2 ;; esac

test "$(id -u)" = 0
test "$(cat "$config/created-by")" = "$service"
test "$(systemctl show "$service" -p FragmentPath --value)" = "$unit"
test "$(readlink "/etc/nginx/sites-enabled/$service")" = "$vhost"
grep -Fq "server_name $domain;" "$vhost"
active_revision() {
  local backend
  backend=$(systemctl show "$service" -p WorkingDirectory --value)
  [[ "$backend" =~ ^/opt/gravitas-workspace-staging/releases/([a-f0-9]{40})/source/backend$ ]]
  printf '%s\n' "${BASH_REMATCH[1]}"
}
health() {
  local host=$1 port=443
  curl --noproxy '*' -fsS --max-time 8 --resolve "$host:$port:127.0.0.1" "https://$host/api/health/" |
    python3 -c 'import json,sys; health=json.load(sys.stdin); assert health["status"] == health["database"] == "ok"'
}
health "$domain"
health graviquest.com
revision=$(active_revision)
printf 'staging_revision=%s\n' "$revision"
date -u '+observed_at=%Y-%m-%dT%H:%M:%SZ'
printf 'logical_cpus=%s\n' "$(nproc)"
awk '{print "load_average_1_5_15="$1 "," $2 "," $3}' /proc/loadavg
awk '/^(MemTotal|MemAvailable|SwapTotal|SwapFree):/ {sub(/:/,"",$1); printf "%s_MiB=%.0f\n",$1,$2/1024}' /proc/meminfo
df -PBM "$state" | awk 'NR==2 {print "disk_total="$2, "disk_available="$4, "disk_used_percent="$5}'
nginx -v 2>&1
docker version --format 'docker_server={{.Server.Version}}'
systemctl list-units --type=service,timer --all --no-pager --no-legend --plain |
  awk '$1 ~ /^(gravitas|graviquest|nginx|postgresql|redis|docker|certbot|discourse|tutor)[.@_-]/ {print "service",$1,$3,$4}'
docker ps --format 'container={{.Names}} image={{.Image}}'
timeout 15 docker stats --no-stream --format 'container={{.Name}} cpu={{.CPUPerc}} memory={{.MemUsage}}' || true
for port in 80 443 5432 6379 8000 8001 8081 15432 18000 18081; do
  ss -ltnH "sport = :$port" | awk -v port="$port" '
    $4 ~ /^(127[.]0[.]0[.]1:|\[::1\]:)/ {loopback++; next}
    {other++}
    END {printf "tcp_%s_loopback=%d other=%d\n",port,loopback,other}'
done
runuser -u postgres -- psql -XqtA -d postgres -c 'SHOW server_version;' 2>/dev/null |
  sed 's/^/production_postgresql=/' || true
docker exec "$db" psql -XqtA -U postgres -d postgres -c 'SHOW server_version;' |
  sed 's/^/staging_postgresql=/'
for target in 'staging.graviquest.com/nextcloud/status.php' 'graviquest.com/nextcloud/status.php'; do
  host=${target%%/*}
  if data=$(curl --noproxy '*' -fsS --max-time 7 --resolve "$host:443:127.0.0.1" "https://$target"); then
    python3 -c 'import json,sys; d=json.load(sys.stdin); print(sys.argv[1], "nextcloud=" + str(d.get("versionstring")), "maintenance=" + str(d.get("maintenance")))' "$host" <<< "$data"
  fi
done
systemctl show "$service" -p MemoryCurrent -p MemoryMax -p CPUQuotaPerSecUSec
if [ "$operation" = inventory ]; then exit; fi

# Fail before writing if the live staging release changes or the resources are busy.
exec 9>/run/lock/gravitas-workspace-staging.lock
flock -n 9
test "$revision" = "$(active_revision)"
awk '$1 == "MemAvailable:" {exit ($2 < 2560000)}' /proc/meminfo
awk '{exit ($1 >= 2.5)}' /proc/loadavg
test "$(df -Pk "$state" | awk 'NR==2 {print $4}')" -ge 20971520
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql"}}{{.Source}}{{end}}{{end}}' "$db")" = "$state/postgres"
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/www/html"}}{{.Source}}{{end}}{{end}}' "$cloud")" = "$state/nextcloud"
test ! -L "$state/nextcloud"
test "$(docker inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostIp}}:{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$db")" = '127.0.0.1:15432'
proof=$(docker exec "$db" psql -XqtA -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
  SELECT count(*) FROM pg_database d JOIN pg_roles r ON d.datdba=r.oid
  WHERE (d.datname,d.datname=r.rolname,r.rolsuper) IN
      (('gravitas_workspace_staging',true,false),('workspace_staging_nextcloud',true,false));")
test "$proof" = 2
nextcloud_data=$(du -s -B1 "$state/nextcloud/data" | cut -f1)
test "$nextcloud_data" -le 536870912

install -d -m 0700 -o root -g root "$backup"
test "$(stat -c '%u:%a' "$backup")" = '0:700'
pending=$(mktemp -d "$backup/.rehearsal-XXXXXX")
restore=$service-restore-$(date +%s)
started=0
cleanup() {
  local status=$?
  if [ "$started" = 1 ]; then docker rm -f "$restore" >/dev/null 2>&1 || true; fi
  if [ -d "$pending" ]; then rm -rf -- "$pending"; fi
  exit "$status"
}
trap cleanup EXIT
from_wal() {
  docker exec "$db" psql -XqtA -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'SELECT pg_current_wal_insert_lsn()'
}
start_lsn=$(from_wal)
for database in gravitas_workspace_staging workspace_staging_nextcloud; do
  docker exec "$db" nice -n 15 pg_dump --lock-wait-timeout=4000 -U postgres -Fc "$database" > "$pending/$database.dump"
  docker exec -i "$db" pg_restore --list < "$pending/$database.dump" > "$pending/$database.contents"
done
ionice -c 3 nice -n 15 tar -czf "$pending/nextcloud-files.tar.gz" --one-file-system   --exclude='./data/nextcloud.log*' --exclude='./data/audit.log*' --exclude='./data/updater.log*'   -C "$state/nextcloud" ./data ./config
test "$start_lsn" = "$(from_wal)" || { echo 'Active staging writes overlapped the snapshot. Retry when QA is idle.' >&2; exit 1; }
tar -tzf "$pending/nextcloud-files.tar.gz" > "$pending/nextcloud-files.contents"
test -s "$pending/nextcloud-files.contents"
install -m 0600 "$unit" "$pending/staging.service"
install -m 0600 "$vhost" "$pending/nginx.conf"
for suffix in service timer; do
  install -m 0600 "/etc/systemd/system/$service-team-folders.$suffix" "$pending/team-folders.$suffix"
done
printf '%s\n' "$revision" > "$pending/revision"

# Same image as live staging. No published ports, network, external credentials,
# production mounts or persistent files. Restore solely into this container.
image=$(docker inspect --format '{{.Image}}' "$db")
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]]
install -d -m 0700 "$pending/restore"
docker run --detach --name "$restore" --network none --memory 288m --cpus 0.4 --pids-limit 48   --tmpfs /run/postgresql:rw,nosuid,size=16m   --mount "type=bind,source=$pending/restore,target=/scratch"   --env PGDATA=/scratch/pg --env POSTGRES_HOST_AUTH_METHOD=trust "$image"   postgres -c listen_addresses= -c shared_buffers=24MB -c max_connections=8 >/dev/null
started=1
for try in {1..40}; do
  if docker exec "$restore" pg_isready -q -U postgres -d postgres &&
    test "$(docker inspect -f '{{.State.Running}}' "$restore")" = true &&
    docker exec "$restore" psql -XqtA -U postgres -d postgres -c 'SELECT 1' | grep -Fxq 1; then break; fi
  sleep 1
done
for database in gravitas_workspace_staging workspace_staging_nextcloud; do
  docker exec "$restore" createdb -U postgres "$database"
  docker exec -i "$restore" pg_restore -U postgres --exit-on-error --no-owner --no-acl -d "$database" < "$pending/$database.dump"
done
docker exec "$restore" psql -XqtA -U postgres -d gravitas_workspace_staging -c   "SELECT (to_regclass('django_migrations') IS NOT NULL) AND (to_regclass('auth_user') IS NOT NULL)" | grep -Fxq t
docker exec "$restore" psql -XqtA -U postgres -d workspace_staging_nextcloud -c   "SELECT (to_regclass('oc_filecache') IS NOT NULL) AND (to_regclass('oc_appconfig') IS NOT NULL)" | grep -Fxq t
docker rm -f "$restore" >/dev/null
started=0
rm -rf -- "$pending/restore"
test "$revision" = "$(active_revision)"
health "$domain"
health graviquest.com
mv "$pending" "$backup/$(date -u '+%Y%m%dT%H%M%S')-$revision"
echo 'Staging PostgreSQL and Nextcloud catalog restored in an isolated disposable container.'
echo 'Staging files archive and host recovery checkpoint verified. Both HTTPS health endpoints passed and QA revision remained active.'
