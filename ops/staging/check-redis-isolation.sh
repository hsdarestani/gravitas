#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" -eq 0
test "$(cat /etc/gravitas-workspace-staging/created-by)" = gravitas-workspace-staging
awk '$1 == "MemAvailable:" {exit ($2 < 2560000)}' /proc/meminfo
image=$(docker image inspect redis:7-alpine --format '{{.Id}}')
[[ "$image" =~ ^sha256:[0-9a-f]{64}$ ]]
service=gravitas-stage-redis-rehearsal
if docker container inspect "$service" >/dev/null 2>&1; then exit 1; fi
cid=$(docker run --detach --name "$service" --network none --memory 64m --cpus .15 \
  --pids-limit 32 --read-only --tmpfs /data:rw,size=16m "$image" \
  redis-server --save '' --appendonly no --maxmemory 32mb </dev/null)
trap 'docker rm -f "$cid" >/dev/null' EXIT
for attempt in 1 2 3 4 5; do
  if docker exec "$cid" redis-cli ping | grep -Fxq PONG; then break; fi
  sleep 1
done
test "$(docker inspect "$cid" --format '{{.HostConfig.NetworkMode}}')" = none
test "$(docker exec "$cid" redis-cli SET graviquest-staging:qa:worker ok EX 60)" = OK
test "$(docker exec "$cid" redis-cli GET graviquest-staging:qa:worker)" = ok
ttl=$(docker exec "$cid" redis-cli TTL graviquest-staging:qa:worker)
[[ "$ttl" =~ ^[1-9][0-9]?$ && "$ttl" -le 60 ]]
test -z "$(docker exec "$cid" redis-cli GET graviquest-production:qa:worker)"
echo 'Disposable Redis passed health, expiry and namespaced readback with network disabled.'
systemctl is-active --quiet gravitas-workspace-staging-team-folders.timer
echo 'Live staging Team Folder timer is active.'
