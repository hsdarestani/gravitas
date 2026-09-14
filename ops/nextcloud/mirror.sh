#!/usr/bin/env bash
set -euo pipefail

BACKEND_PATH="${1:-/opt/gravitas-backend}"
ENV_FILE=/etc/gravitas/backend.env
NC_CONTAINER="${NC_CONTAINER:-gravitas-nextcloud}"
NC_DB_CONTAINER="${NC_DB_CONTAINER:-gravitas-nextcloud-db}"
NC_NETWORK="${NC_NETWORK:-gravitas-nextcloud}"

if [ ! -x "$BACKEND_PATH/.venv/bin/django-admin" ]; then
  echo "Gravitas backend virtualenv is not ready at $BACKEND_PATH" >&2
  exit 1
fi
if [ ! -r "$ENV_FILE" ]; then
  echo "Gravitas backend environment is missing: $ENV_FILE" >&2
  exit 1
fi

# Never let the old two-minute timer race credential repair. A stale identity
# firing one more Basic-auth request while provisioning is resetting accounts
# can immediately rebuild the private-gateway throttle we are trying to clear.
systemctl stop gravitas-nextcloud-mirror.timer >/dev/null 2>&1 || true
systemctl stop gravitas-nextcloud-mirror.service >/dev/null 2>&1 || true

# Nextcloud's brute-force protection records the address that reaches Apache.
# With Docker port publishing that address is not guaranteed to equal the
# gateway of the user-defined Nextcloud network: it can be another Docker
# bridge gateway or a host/private address. Resetting only NC_NETWORK therefore
# left a stale private source in production and the credential repair hit 429
# again after the first recreated accounts.
#
# Build the candidate set from loopback, host addresses, every Docker gateway,
# and — most importantly — the addresses Nextcloud itself has persisted in its
# brute-force table. Filter the set to local/private/link-local addresses before
# calling OCC so public-client protection is never weakened.
internal_bruteforce_addresses() {
  {
    printf '%s\n' 127.0.0.1 ::1
    hostname -I 2>/dev/null | tr ' ' '\n' || true
    docker network ls -q 2>/dev/null | while IFS= read -r network_id; do
      [ -n "$network_id" ] || continue
      docker network inspect "$network_id" \
        --format '{{range .IPAM.Config}}{{if .Gateway}}{{.Gateway}}{{"\n"}}{{end}}{{end}}' \
        2>/dev/null || true
    done
    docker exec "$NC_DB_CONTAINER" psql -U nextcloud -d nextcloud -Atc \
      "SELECT DISTINCT ip FROM oc_bruteforce_attempts WHERE ip IS NOT NULL AND ip <> '';" \
      2>/dev/null || true
  } | python3 -c '
import ipaddress
import sys

seen = set()
for raw in sys.stdin:
    value = raw.strip().strip("[]")
    if not value:
        continue
    # Nextcloud stores normal textual addresses; tolerate an IPv6 zone suffix
    # if an OS ever supplies one in a host-interface candidate.
    value = value.split("%", 1)[0]
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        continue
    if not (address.is_private or address.is_loopback or address.is_link_local):
        continue
    normalized = str(address)
    if normalized in seen:
        continue
    seen.add(normalized)
    print(normalized)
'
}

reset_internal_bruteforce() {
  local ip=""
  local count=0
  while IFS= read -r ip; do
    [ -n "$ip" ] || continue
    docker exec -u www-data "$NC_CONTAINER" php occ security:bruteforce:reset "$ip" >/dev/null 2>&1 || true
    count=$((count + 1))
  done < <(internal_bruteforce_addresses)
  echo "Cleared Nextcloud brute-force state for $count trusted internal address(es)."
}

reset_internal_bruteforce

# Nextcloud 34 independently rate-limits the authenticated Provisioning API
# editUser action to 50 requests per 600 seconds. Gravitas legitimately
# re-asserts one managed password per identity during a production repair, so a
# damaged population plus bounded retries can exhaust that route even when every
# credential is correct and brute-force state is empty. Use Nextcloud's supported
# route-specific override for this scripted action instead of disabling global
# rate limiting or weakening anonymous/public protections. 200/600 is enough for
# several complete Gravitas repair passes while remaining bounded to logged-in
# calls to provisioning_api.users.edituser.
docker exec -u www-data "$NC_CONTAINER" php occ config:system:set \
  ratelimit_overwrite provisioning_api.users.edituser user limit \
  --type=integer --value=200 >/dev/null
docker exec -u www-data "$NC_CONTAINER" php occ config:system:set \
  ratelimit_overwrite provisioning_api.users.edituser user period \
  --type=integer --value=600 >/dev/null

docker exec -u www-data "$NC_CONTAINER" php occ config:system:get \
  ratelimit_overwrite provisioning_api.users.edituser user limit | grep -qx '200'
docker exec -u www-data "$NC_CONTAINER" php occ config:system:get \
  ratelimit_overwrite provisioning_api.users.edituser user period | grep -qx '600'
echo "Configured bounded Nextcloud editUser rate limit for Gravitas repair automation (200/600s)."

cat > /etc/systemd/system/gravitas-nextcloud-credential-repair.service <<EOF
[Unit]
Description=Repair Gravitas-managed Nextcloud identity credentials
After=network-online.target gravitas-backend.service docker.service
Wants=network-online.target
Requires=gravitas-backend.service docker.service

[Service]
Type=oneshot
User=gravitas
Group=gravitas
WorkingDirectory=$BACKEND_PATH
EnvironmentFile=$ENV_FILE
Environment=DJANGO_SETTINGS_MODULE=gravitas_backend.settings
Environment=PYTHONPATH=$BACKEND_PATH
ExecStart=$BACKEND_PATH/.venv/bin/django-admin repair_nextcloud_identity_credentials
Nice=5
EOF

cat > /etc/systemd/system/gravitas-nextcloud-mirror.service <<EOF
[Unit]
Description=Reconcile Gravitas with native Nextcloud Notes and Deck
After=network-online.target gravitas-backend.service docker.service
Wants=network-online.target
Requires=gravitas-backend.service docker.service

[Service]
Type=oneshot
User=gravitas
Group=gravitas
WorkingDirectory=$BACKEND_PATH
EnvironmentFile=$ENV_FILE
Environment=DJANGO_SETTINGS_MODULE=gravitas_backend.settings
Environment=PYTHONPATH=$BACKEND_PATH
ExecStart=$BACKEND_PATH/.venv/bin/django-admin reconcile_nextcloud_native
Nice=5
EOF

cat > /etc/systemd/system/gravitas-nextcloud-mirror.timer <<'EOF'
[Unit]
Description=Keep Gravitas and native Nextcloud apps mirrored

[Timer]
OnBootSec=45s
OnUnitActiveSec=2min
AccuracySec=15s
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload

# Legacy identities may contain a valid decryptable secret that no longer
# matches the password in Nextcloud. Re-assert every managed identity while the
# timer is stopped, before any per-user Notes/DAV authentication is attempted.
# A second bounded attempt is useful when the first pass repairs/recreates
# enough identities to expose a pre-existing throttle entry that was not visible
# before the pass started. Each pass is idempotent and we clear only trusted
# internal addresses between attempts.
repair_ok=0
for attempt in 1 2 3; do
  systemctl reset-failed gravitas-nextcloud-credential-repair.service >/dev/null 2>&1 || true
  reset_internal_bruteforce
  if systemctl start gravitas-nextcloud-credential-repair.service; then
    repair_ok=1
    break
  fi
  echo "Gravitas Nextcloud credential repair attempt $attempt failed; clearing trusted internal throttle state before retry." >&2
  reset_internal_bruteforce
  sleep "$attempt"
done

if [ "$repair_ok" -ne 1 ]; then
  echo "Gravitas Nextcloud identity credential repair failed after bounded recovery attempts." >&2
  systemctl --no-pager --full status gravitas-nextcloud-credential-repair.service >&2 || true
  journalctl -u gravitas-nextcloud-credential-repair.service -n 120 --no-pager >&2 || true
  exit 1
fi

# The credential repair used only managed credentials, but clear internal
# brute-force state once more so historical attempts cannot affect the first
# repaired per-user request.
reset_internal_bruteforce

systemctl enable --now gravitas-nextcloud-mirror.timer
systemctl reset-failed gravitas-nextcloud-mirror.service >/dev/null 2>&1 || true

# Reconcile once now as part of deploy. Keep infrastructure provisioning
# recoverable, but make a failure immediately diagnosable in the Actions log;
# the dedicated verification step later in the workflow remains the hard gate.
if ! systemctl start gravitas-nextcloud-mirror.service; then
  echo "Initial Gravitas ↔ Nextcloud reconciliation failed; timer will retry." >&2
  systemctl --no-pager --full status gravitas-nextcloud-mirror.service >&2 || true
  journalctl -u gravitas-nextcloud-mirror.service -n 80 --no-pager >&2 || true
fi
systemctl is-enabled gravitas-nextcloud-mirror.timer >/dev/null
systemctl is-active gravitas-nextcloud-mirror.timer >/dev/null

echo "Gravitas Nextcloud mirror timer installed (2 minute cadence)."
