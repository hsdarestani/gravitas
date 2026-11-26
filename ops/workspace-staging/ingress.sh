#!/usr/bin/env bash
set -euo pipefail
umask 077

domain=staging.graviquest.com
expected_ipv4=82.165.94.28
service=gravitas-workspace-staging
revision=8a008862d0ad6f72abd1cba95d368a5b88bc9595
config=/etc/gravitas-workspace-staging
release=/opt/gravitas-workspace-staging/releases/$revision/source
site=/etc/nginx/sites-available/$service
enabled=/etc/nginx/sites-enabled/$service
acme=/var/www/gravitas-workspace-staging-acme
cert=/etc/letsencrypt/live/$domain

test "$(id -u)" -eq 0
test "$(cat "$config/created-by")" = "$service"
test "$(git -C "$release" rev-parse HEAD)" = "$revision"
systemctl is-active --quiet "$service"
curl --noproxy '*' -fsS --max-time 5 -H "Host: $domain" -H 'X-Forwarded-Proto: https' http://127.0.0.1:18000/api/health/ | \
  python3 -c 'import json,sys; d=json.load(sys.stdin); assert (d["status"],d["database"]) == ("ok","ok")'
curl --noproxy '*' -fsS --max-time 5 -H "Host: $domain" http://127.0.0.1:18081/status.php | \
  python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["installed"] and not d["maintenance"]'
exec 9>/run/lock/gravitas-workspace-staging.lock
flock -n 9

if [ -L "$enabled" ]; then
  test "$(readlink "$enabled")" = "$site"
elif [ -e "$enabled" ]; then
  echo 'Conflicting existing staging Nginx symlink' >&2
  exit 1
fi
if [ -e "$site" ]; then
  test ! -L "$site"
  grep -Fxq '# Managed by Workspace V2 staging operations' "$site"
fi
install -d -m 0755 "$acme" "$acme/.well-known" "$acme/.well-known/acme-challenge"

candidate=$(mktemp "$config/nginx.XXXXXX")
backup=$(mktemp "$config/nginx-backup.XXXXXX")
trap 'rm -f "$candidate" "$backup"' EXIT
install_site() {
  if [ -f "$site" ] && cmp -s "$candidate" "$site" && [ -L "$enabled" ]; then
    return 0
  fi
  local previous=0
  local linked=0
  if [ -f "$site" ]; then cp "$site" "$backup"; previous=1; fi
  if [ -L "$enabled" ]; then linked=1; fi
  install -m 0644 "$candidate" "$site"
  if [ "$linked" = 0 ]; then ln -s "$site" "$enabled"; fi
  if ! nginx -t || ! systemctl reload nginx; then
    if [ "$previous" = 1 ]; then install -m 0644 "$backup" "$site"; else rm -f "$site"; fi
    if [ "$linked" = 0 ]; then rm -f "$enabled"; fi
    return 1
  fi
}

cat > "$candidate" <<'NGINX'
# Managed by Workspace V2 staging operations
server {
    listen 80;
    listen [::]:80;
    server_name staging.graviquest.com;
    root /var/www/gravitas-workspace-staging-acme;
    location ^~ /.well-known/acme-challenge/ { try_files $uri =404; }
    location / { return 308 https://staging.graviquest.com$request_uri; }
}
NGINX
if [ ! -f "$cert/fullchain.pem" ] || [ ! -f "$cert/privkey.pem" ]; then
  install_site
  echo 'staging_acme_route=ready'
  ip=$(getent ahostsv4 "$domain" | awk '{print $1}' | sort -u || true)
  if [ "$ip" != "$expected_ipv4" ]; then
    echo 'workspace_staging_tls=pending_authoritative_staging_dns'
    exit 0
  fi
  certbot certonly --webroot -w "$acme" --non-interactive --keep-until-expiring --cert-name "$domain" -d "$domain"
fi

cat >> "$candidate" <<'NGINX'
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name staging.graviquest.com;
    ssl_certificate /etc/letsencrypt/live/staging.graviquest.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/staging.graviquest.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    root /opt/gravitas-workspace-staging/releases/8a008862d0ad6f72abd1cba95d368a5b88bc9595/source;
    add_header X-Robots-Tag "noindex, nofollow" always;
    client_max_body_size 64m;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;

    location = / { return 302 /workspace-v2; }
    location = /login { try_files /account.html =404; }
    location = /account.html { try_files $uri =404; }
    location = /workspace.webmanifest { try_files $uri =404; }
    location = /workspace-sw.js { try_files $uri =404; }
    location = /workspace { try_files /workspace.html =404; }
    location /workspace/ { try_files /workspace.html =404; }
    location = /workspace-v2 { proxy_pass http://127.0.0.1:18000; }
    location = /workspace-v2/ { proxy_pass http://127.0.0.1:18000; }
    location = /api/auth/signup/ { return 403; }
    location /api/ { proxy_pass http://127.0.0.1:18000; }
    location /django-static/ { proxy_pass http://127.0.0.1:18000; }
    location /assets/ { try_files $uri =404; }

    location = /nextcloud { return 308 /nextcloud/; }
    location = /.well-known/carddav { return 301 /nextcloud/remote.php/dav; }
    location = /.well-known/caldav { return 301 /nextcloud/remote.php/dav; }
    location /nextcloud/ {
        proxy_pass http://127.0.0.1:18081/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Prefix /nextcloud;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_request_buffering off;
        proxy_read_timeout 120s;
    }
    location ~ (^|/)\. { return 404; }
    location / { return 404; }
}
NGINX
install_site
check() {
  curl --noproxy '*' -fsS --max-time 8 --resolve "$domain:443:127.0.0.1" "https://$domain$1"
}
check /api/health/ | python3 -c 'import json,sys; d=json.load(sys.stdin); assert (d["status"],d["database"]) == ("ok","ok")'
check /nextcloud/status.php | python3 -c 'import json,sys; assert json.load(sys.stdin)["installed"]'
check /login >/dev/null
check /workspace >/dev/null
echo 'workspace_staging_https=ok'

occ() {
  docker exec -u www-data "$service-nextcloud" php occ "$@"
}
discovery="https://$domain/api/oidc/.well-known/openid-configuration"
check /api/oidc/.well-known/openid-configuration | python3 -c 'import json,sys; assert json.load(sys.stdin)["issuer"] == "https://staging.graviquest.com/api/oidc"'
if ! occ app:list --enabled | grep -q 'user_oidc:'; then occ app:install user_oidc >/dev/null; fi
secret=$(sed -n 's/^GQ_STAGING_OIDC_CLIENT_SECRET=//p' "$config/application.env")
test -n "$secret"
provider=$(occ user_oidc:provider gravitas-staging \
  --clientid=gravitas-nextcloud-staging --clientsecret="$secret" --discoveryuri="$discovery" \
  --scope='openid email profile' --unique-uid=0 --check-bearer=0 \
  --mapping-uid=nextcloud_uid --mapping-display-name=name --mapping-email=email --output=json 2>/dev/null)
provider_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<< "$provider")
[[ "$provider_id" =~ ^[1-9][0-9]*$ ]]
occ config:system:set user_oidc auto_provision --type=boolean --value=true >/dev/null
occ config:system:set user_oidc soft_auto_provision --type=boolean --value=true >/dev/null
occ config:system:set user_oidc disable_account_creation --type=boolean --value=true >/dev/null
if ! grep -Fxq "GQ_STAGING_NEXTCLOUD_OIDC_PROVIDER_ID=$provider_id" "$config/application.env"; then
  sed -i "s/^GQ_STAGING_NEXTCLOUD_OIDC_PROVIDER_ID=.*/GQ_STAGING_NEXTCLOUD_OIDC_PROVIDER_ID=$provider_id/" "$config/application.env"
  systemctl restart "$service"
fi
printf 'workspace_staging_nextcloud_oidc=provider_configured\n'
