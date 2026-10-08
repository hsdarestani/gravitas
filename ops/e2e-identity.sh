#!/usr/bin/env bash
# Sourced only by the named production E2E jobs. Credentials stay on stdin.
set -euo pipefail
prepare_e2e_identity() {
  local email="$1" password="$2" login="${E2E_SSH_USER:-deploy}"
  local key="$RUNNER_TEMP/e2e-identity-key" known="$RUNNER_TEMP/e2e-known-hosts"
  printf '%s\n' "$E2E_SSH_KEY" > "$key"
  chmod 600 "$key"
  ssh-keyscan -p "${E2E_SSH_PORT:-22}" -H "$E2E_SSH_HOST" > "$known" 2>/dev/null
  local opts=(-i "$key" -p "${E2E_SSH_PORT:-22}" -o BatchMode=yes -o ConnectTimeout=10 -o UserKnownHostsFile="$known")
  if ! ssh "${opts[@]}" "$login@$E2E_SSH_HOST" true 2>/dev/null; then
    login=root
    ssh "${opts[@]}" "$login@$E2E_SSH_HOST" true
  fi
  python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$email" "$password" |
    ssh "${opts[@]}" "$login@$E2E_SSH_HOST" "sudo -u gravitas bash -c 'set -a; . /etc/gravitas/backend.env; set +a; export PYTHONPATH=/opt/gravitas-backend; exec /opt/gravitas-backend/.venv/bin/python /var/www/gravitas/ops/provision_e2e_identity.py'" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["verification_url"])'
}

# The server command independently enforces this exact disposable identity/name.
grant_e2e_core_access() {
  local email="$1" login="${E2E_SSH_USER:-deploy}"
  [[ "$email" =~ ^operating-e2e-[0-9]+-[0-9]+@example\.com$ ]] || return 1
  local opts=(-i "$RUNNER_TEMP/e2e-identity-key" -p "${E2E_SSH_PORT:-22}" -o BatchMode=yes -o ConnectTimeout=10 -o UserKnownHostsFile="$RUNNER_TEMP/e2e-known-hosts")
  if ! ssh "${opts[@]}" "$login@$E2E_SSH_HOST" true 2>/dev/null; then login=root; fi
  ssh "${opts[@]}" "$login@$E2E_SSH_HOST" "sudo -u gravitas bash -c 'set -a; . /etc/gravitas/backend.env; set +a; export PYTHONPATH=/opt/gravitas-backend; exec /opt/gravitas-backend/.venv/bin/django-admin grant_production_e2e_core_access \"\$1\"' _ '$email'"
}
