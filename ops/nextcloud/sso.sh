#!/usr/bin/env bash
set -euo pipefail

MAIN_DOMAIN="${1:-gravitasplus.com}"
CLOUD_DOMAIN="${2:-cloud.gravitasplus.com}"
BACKEND_ENV=/etc/gravitas/backend.env
NC_CONTAINER="${NC_CONTAINER:-gravitas-nextcloud}"
CLIENT_ID=gravitas-nextcloud
ISSUER="https://${MAIN_DOMAIN}/api/oidc"
DISCOVERY="${ISSUER}/.well-known/openid-configuration"
ENV_BACKUP="$(mktemp /tmp/gravitas-backend-env.XXXXXX)"
cp -p "$BACKEND_ENV" "$ENV_BACKUP"

cleanup() {
  rm -f "$ENV_BACKUP"
}
trap cleanup EXIT

occ() {
  docker exec -u www-data "$NC_CONTAINER" php occ "$@"
}

set_env() {
  local key="$1" value="$2"
  touch "$BACKEND_ENV"
  sed -i "/^${key}=/d" "$BACKEND_ENV"
  printf '%s=%s\n' "$key" "$value" >> "$BACKEND_ENV"
}

get_env() {
  local key="$1"
  sed -n "s/^${key}=//p" "$BACKEND_ENV" 2>/dev/null | tail -n1
}

backend_diagnostics() {
  echo '--- gravitas-backend.service status ---' >&2
  systemctl status --no-pager --full gravitas-backend.service >&2 || true
  echo '--- recent gravitas backend journal ---' >&2
  journalctl -u gravitas-backend.service -n 100 --no-pager >&2 || true
}

wait_backend() {
  local attempts="${1:-60}"
  rm -f /tmp/gravitas-oidc-discovery.json /tmp/gravitas-oidc-jwks.json
  for _ in $(seq 1 "$attempts"); do
    if systemctl is-active --quiet gravitas-backend.service \
       && curl -fsS "$DISCOVERY" >/tmp/gravitas-oidc-discovery.json 2>/dev/null \
       && curl -fsS "${ISSUER}/jwks/" >/tmp/gravitas-oidc-jwks.json 2>/dev/null \
       && grep -q '"authorization_endpoint"' /tmp/gravitas-oidc-discovery.json \
       && grep -q '"RS256"' /tmp/gravitas-oidc-jwks.json; then
      return 0
    fi
    sleep 2
  done
  return 1
}

rollback_backend_env() {
  echo 'OIDC backend readiness failed; restoring the previous backend environment.' >&2
  cp -p "$ENV_BACKUP" "$BACKEND_ENV"
  chown root:gravitas "$BACKEND_ENV"
  chmod 640 "$BACKEND_ENV"
  systemctl restart gravitas-backend.service || true
  for _ in $(seq 1 30); do
    if systemctl is-active --quiet gravitas-backend.service \
       && curl -fsS "https://${MAIN_DOMAIN}/api/health/" >/dev/null 2>&1; then
      echo 'Previous Gravitas backend environment restored.' >&2
      return 0
    fi
    sleep 2
  done
  backend_diagnostics
  return 1
}

restart_and_wait_oidc() {
  if ! systemctl restart gravitas-backend.service; then
    backend_diagnostics
    rollback_backend_env || true
    return 1
  fi
  if wait_backend 60; then
    return 0
  fi
  backend_diagnostics
  rollback_backend_env || true
  return 1
}

if ! occ app:list --enabled 2>/dev/null | grep -Eq '^[[:space:]]*-[[:space:]]+user_oidc:'; then
  echo 'user_oidc must be installed before SSO configuration' >&2
  exit 1
fi

CLIENT_SECRET="$(get_env GRAVITAS_OIDC_CLIENT_SECRET || true)"
if [ -z "$CLIENT_SECRET" ]; then
  CLIENT_SECRET="$(openssl rand -hex 32)"
fi

PRIVATE_KEY_B64="$(get_env GRAVITAS_OIDC_PRIVATE_KEY_B64 || true)"
if [ -z "$PRIVATE_KEY_B64" ]; then
  PRIVATE_KEY_B64="$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 2>/dev/null | base64 -w0)"
fi

set_env GRAVITAS_OIDC_ISSUER "$ISSUER"
set_env GRAVITAS_OIDC_CLIENT_ID "$CLIENT_ID"
set_env GRAVITAS_OIDC_CLIENT_SECRET "$CLIENT_SECRET"
set_env GRAVITAS_OIDC_PRIVATE_KEY_B64 "$PRIVATE_KEY_B64"
set_env NEXTCLOUD_PUBLIC_URL "https://${CLOUD_DOMAIN}"
chown root:gravitas "$BACKEND_ENV"
chmod 640 "$BACKEND_ENV"

# The provider discovery/JWKS must be live before Nextcloud validates the config.
restart_and_wait_oidc

# Link OIDC to the already-provisioned local Nextcloud account IDs. Turning off
# unique-uid hashing is deliberate: the signed nextcloud_uid claim is exactly
# gravitas-u-<Django user id>. Account creation stays disabled, so an OIDC token
# can never create an untracked Nextcloud-only user.
occ user_oidc:provider gravitas \
  --clientid="$CLIENT_ID" \
  --clientsecret="$CLIENT_SECRET" \
  --discoveryuri="$DISCOVERY" \
  --scope="openid email profile" \
  --unique-uid=0 \
  --check-bearer=0 \
  --mapping-uid=nextcloud_uid \
  --mapping-display-name=name \
  --mapping-email=email \
  --output=json >/tmp/gravitas-oidc-provider.json

occ config:system:set user_oidc auto_provision --type=boolean --value=true >/dev/null
occ config:system:set user_oidc soft_auto_provision --type=boolean --value=true >/dev/null
occ config:system:set user_oidc disable_account_creation --type=boolean --value=true >/dev/null

PROVIDER_ID="$({ occ user_oidc:providers --output=json || true; } | python3 -c '
import json, sys
for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    try:
        item = json.loads(raw)
    except json.JSONDecodeError:
        continue
    if item.get("identifier") == "gravitas":
        print(item.get("id", ""))
        break
')"

if ! printf '%s' "$PROVIDER_ID" | grep -Eq '^[0-9]+$'; then
  echo 'Could not resolve Nextcloud user_oidc provider id' >&2
  occ user_oidc:providers --output=json >&2 || true
  exit 1
fi

set_env NEXTCLOUD_OIDC_PROVIDER_ID "$PROVIDER_ID"
chown root:gravitas "$BACKEND_ENV"
chmod 640 "$BACKEND_ENV"

# The second restart changes the launch route from "not configured" to the
# concrete provider id. Gunicorn needs a short readiness window here too;
# checking immediately through nginx can otherwise produce a transient 502.
restart_and_wait_oidc

# Final server-side contract checks. The browser flow itself is covered by the
# Gravitas OIDC tests and the production launch route.
curl -fsS "$DISCOVERY" | grep -q '"authorization_endpoint"'
curl -fsS "${ISSUER}/jwks/" | grep -q '"RS256"'
occ user_oidc:provider gravitas --output=json | grep -q 'nextcloud_uid'
printf 'provider_id=%s\nissuer=%s\ncallback=https://%s/apps/user_oidc/code\n' "$PROVIDER_ID" "$ISSUER" "$CLOUD_DOMAIN"
