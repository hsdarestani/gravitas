#!/usr/bin/env bash
# Add read-only route configuration for the active staging release during Workspace QA.
set -euo pipefail
umask 077
service=gravitas-workspace-staging
domain=staging.graviquest.com
config=/etc/$service
site=/etc/nginx/sites-available/$service
unit=/etc/systemd/system/$service.service
origin=127.0.0.1
tools=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
expected=${1:?The QA revision must be named explicitly}

test "$(id -u)" = 0
test "$(cat "$config/created-by")" = "$service"
test "$(systemctl show "$service" -p FragmentPath --value)" = "$unit"
test "$(readlink "/etc/nginx/sites-enabled/$service")" = "$site"
grep -Fxq '# Managed by Workspace V2 staging operations' "$site"
grep -Fq "server_name $domain;" "$site"

exec 9>/run/lock/gravitas-workspace-staging.lock
flock -n 9
backend=$(systemctl show "$service" -p WorkingDirectory --value)
[[ "$backend" =~ ^/opt/gravitas-workspace-staging/releases/([a-f0-9]{40})/source/backend$ ]]
revision=${BASH_REMATCH[1]}
test "$revision" = "$expected"
root=${backend%/backend}
test "$(git -C "$root" rev-parse HEAD)" = "$revision"

request() { curl --noproxy '*' --silent --show-error --max-time 12 --resolve "$1:443:$origin" "https://$1$2" "${@:3}"; }
health() {
  request "$1" /api/health/ --fail | python3 -c 'import json,sys; v=json.load(sys.stdin); assert v["status"] == v["database"] == "ok"'
}
health "$domain"
health graviquest.com
previous=$(mktemp -d "$config/public-ingress-backup.XXXXXX")
cp -- "$site" "$previous/nginx.conf"
status=0
cleanup() {
  status=$?
  if [ "$status" != 0 ]; then
    install -o root -g root -m 0644 "$previous/nginx.conf" "$site"
    nginx -t && systemctl reload nginx
  fi
  exit "$status"
}
trap cleanup EXIT
python3 "$tools/public_pages.py" "$root"
find "$root/.staging-public" -maxdepth 1 -type f -name '*.html' -exec chmod 0644 {} +
chmod 0755 "$root/.staging-public"
chmod 0644 "$root/.staging-public/robots.txt"
python3 "$tools/site_config.py" "$previous/nginx.conf" "$previous/expanded" "$root" "$root" --keep-workspace-routes
install -o root -g root -m 0644 "$previous/expanded" "$site"
nginx -t
systemctl reload nginx
for attempt in {1..12}; do
  if request "$domain" /site --fail --output /dev/null 2>/dev/null; then break; fi
  sleep 1
done

for path in /site /lab /education /topics /topic-answer-that-looked-right /prelaunch-feedback /forum; do
  request "$domain" "$path" --fail --dump-header "$previous/response.headers" > "$previous/page.html"
  grep -Eiq '^x-robots-tag:.*noindex' "$previous/response.headers"
  grep -q 'aria-label="Environment"' "$previous/page.html"
done
request "$domain" /robots.txt --fail | grep -Fxq 'Disallow: /'
for path in /workspace-v2 /workspace/core/team /login /nextcloud/status.php; do
  request "$domain" "$path" --fail --output /dev/null
done
test "$(request "$domain" / -o /dev/null -w '%{http_code}')" = 302
test "$(request "$domain" /api/workspace-v2/state/ -o /dev/null -w '%{http_code}')" = 401
test "$(request "$domain" /api/lms/courses/1/checkout/ -o /dev/null -w '%{http_code}')" = 503
test "$backend" = "$(systemctl show "$service" -p WorkingDirectory --value)"
health "$domain"
health graviquest.com
rm -f -- "$previous/response.headers" "$previous/page.html"
printf 'Public staging routes verified. Workspace QA still serves %s. Previous staging vhost retained at %s.\n' "$revision" "$previous/nginx.conf"
