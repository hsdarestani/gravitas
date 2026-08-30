#!/usr/bin/env bash
set -euo pipefail

NC_CONTAINER="${NC_CONTAINER:-gravitas-nextcloud}"

occ() {
  docker exec -u www-data "$NC_CONTAINER" php occ "$@"
}

enabled() {
  occ app:list --enabled 2>/dev/null | grep -Eq "^[[:space:]]*-[[:space:]]+$1:"
}

ensure_app() {
  local app="$1"
  local required="${2:-optional}"
  if enabled "$app"; then
    echo "Nextcloud app already enabled: $app"
    return 0
  fi
  if occ app:enable "$app" >/dev/null 2>&1; then
    echo "Enabled installed Nextcloud app: $app"
    return 0
  fi
  if occ app:install "$app" >/dev/null 2>&1; then
    occ app:enable "$app" >/dev/null 2>&1 || true
    if enabled "$app"; then
      echo "Installed and enabled Nextcloud app: $app"
      return 0
    fi
  fi
  if [ "$required" = required ]; then
    echo "Required Nextcloud app could not be enabled: $app" >&2
    exit 1
  fi
  echo "WARNING: optional Nextcloud app unavailable for this server version: $app" >&2
}

# Project Team Folders + Advanced Permissions are the storage/ACL contract
# between Gravitas and native Nextcloud clients. Deployment must fail rather
# than silently falling back to per-user storage when this app is unavailable.
ensure_app groupfolders required

# First-party / established collaboration surface exposed from Research V4.
# Optional installation is deliberate: one incompatible community app must not
# take the secure project file layer offline during a Nextcloud major upgrade.
for app in calendar contacts tasks deck notes collectives tables forms spreed; do
  ensure_app "$app" optional
done

# Pre-install the official external OpenID Connect user backend. Gravitas can
# configure it once the OIDC provider/client registration is present; keeping
# installation separate from configuration makes provisioning idempotent.
ensure_app user_oidc optional

# Make background-app changes visible immediately and leave the instance in a
# clean operational state.
occ maintenance:repair --include-expensive >/dev/null || true
occ background:cron >/dev/null || true

echo "Enabled Gravitas Nextcloud apps:"
occ app:list --enabled | sed -n '/Enabled:/,/Disabled:/p'

enabled groupfolders
