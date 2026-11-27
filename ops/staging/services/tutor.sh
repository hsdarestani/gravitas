#!/usr/bin/env bash
# Render independent Tutor state on the dedicated integration host.
set -euo pipefail
umask 077
mode=${1:-}
case "$mode" in config|launch) ;; *) echo 'Usage: tutor.sh config|launch' >&2; exit 2 ;; esac
test "$(id -u)" = 0
test "$(cat /etc/graviquest-staging-services)" = 'dedicated-staging-services'
awk '$1 == "MemTotal:" {exit ($2 < 24*1024*1024)}' /proc/meminfo
for production in gravitas-backend.service gravitas-backend-staging.service gravitas-workspace-staging.service; do
  test "$(systemctl show -p LoadState --value "$production")" = not-found
done
root=/var/lib/graviquest-staging/tutor
venv=/opt/graviquest-staging/tutor-22.0.2
install -d -m 0700 "$root" "$venv"
python3 -m venv "$venv"
"$venv/bin/pip" --disable-pip-version-check install -q tutor==22.0.2 tutor-indigo==22.0.0 tutor-mfe==22.1.0

tutor() {
  env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$root" TUTOR_ROOT="$root" "$venv/bin/tutor" "$@" </dev/null
}
tutor config save \
  --set LMS_HOST=learn-staging.graviquest.com \
  --set CMS_HOST=studio-staging.graviquest.com \
  --set MFE_HOST=apps.learn-staging.graviquest.com \
  --set 'PLATFORM_NAME=GraviQuest Staging' --set CONTACT_EMAIL=learn-admin@example.test \
  --set ENABLE_HTTPS=true --set ENABLE_WEB_PROXY=false \
  --set CADDY_HTTP_PORT=127.0.0.1:8182 --set LOCAL_PROJECT_NAME=graviquest_stage_openedx \
  --set OPENEDX_COMMON_VERSION=release/verawood.1 \
  --set RUN_SMTP=false --set SMTP_HOST=mailpit-staging --set SMTP_PORT=1025
tutor plugins enable indigo mfe
tutor config save
if [ "$mode" = launch ]; then
  tutor local launch
fi
