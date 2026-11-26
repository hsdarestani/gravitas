#!/usr/bin/env bash
set -euo pipefail

revision=8a008862d0ad6f72abd1cba95d368a5b88bc9595
service=gravitas-workspace-staging
config=/etc/gravitas-workspace-staging
release=/opt/gravitas-workspace-staging/releases/$revision/source
container=$service-nextcloud
domain=staging.graviquest.com
test "$(id -u)" -eq 0
test "$(cat "$config/created-by")" = "$service"
test "$(git -C "$release" rev-parse HEAD)" = "$revision"
test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container")" = "$service"
exec 9>/run/lock/gravitas-workspace-staging.lock
flock -n 9

occ() {
  docker exec -u www-data "$container" php occ "$@"
}

for app in groupfolders notes deck user_oidc; do
  if ! occ app:list --enabled | grep -E "^[[:space:]]*-[[:space:]]+$app:" >/dev/null; then
    if ! occ app:enable "$app" >/dev/null 2>&1; then
      occ app:install "$app" >/dev/null
    fi
  fi
  occ app:list --enabled | grep -E "^[[:space:]]*-[[:space:]]+$app:"
done

major=$(curl --noproxy '*' -fsS --max-time 5 -H "Host: $domain" http://127.0.0.1:18081/status.php |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["version"].split(".")[0])')
test "$major" = 34
bridge="$release/ops/nextcloud/gravitascanonical"
test -f "$bridge/appinfo/info.xml"
docker exec "$container" mkdir -p /var/www/html/custom_apps/gravitascanonical
docker cp "$bridge/." "$container:/var/www/html/custom_apps/gravitascanonical/"
docker exec "$container" chown -R www-data:www-data /var/www/html/custom_apps/gravitascanonical
docker exec -u www-data "$container" php -l /var/www/html/custom_apps/gravitascanonical/lib/Controller/AclController.php
occ app:enable gravitascanonical
occ config:app:set gravitascanonical service_user --value=workspace-staging-admin >/dev/null
echo 'stage_project_files_acl_bridge=ready'

gateway=$(docker network inspect --format '{{(index .IPAM.Config 0).Gateway}}' "${service}_isolated")
python3 -c 'import ipaddress,sys; assert ipaddress.ip_address(sys.argv[1]).is_private' "$gateway"
occ config:system:set trusted_proxies 0 --value="$gateway" >/dev/null
