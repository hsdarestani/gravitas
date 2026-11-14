#!/usr/bin/env bash
# Run under the production release concurrency lease.
set -euo pipefail
umask 077

MODE="$1"
TARGET_SHA="$2"
BUNDLE="$3"
APPROVED=1c236c89fe5fec8499b8f33a0cf2ba15c2499319
STATE=/var/lib/gravitas/science-release-358
BACKEND=/opt/gravitas-backend
SCRIPT="$BUNDLE/science_universe_release_358.py"
SOURCE="$BUNDLE/source"
if [[ "$MODE" == preflight ]]; then
  test "$TARGET_SHA" = premerge
else
  [[ "$TARGET_SHA" =~ ^[a-f0-9]{40}$ ]]
  test "$TARGET_SHA" = "$(sudo cat /etc/gravitas/last-successful-deploy-sha)"
  for file in index.html app.js styles.css engine.js; do
    cmp "$SOURCE/$file" "$BACKEND/lab-sources/science-universe/$file"
  done
fi
sudo install -d -m 700 -o gravitas -g gravitas "$STATE"
exec 9>"$BUNDLE/release.lock"
flock -n 9

dj() {
  local db="$1" snapshot="$2" action="$3"
  sudo -u gravitas bash -c '
    set -euo pipefail
    set -a
    . /etc/gravitas/backend.env
    set +a
    export DJANGO_DB_NAME="$1" PYTHONPATH=/opt/gravitas-backend DJANGO_SETTINGS_MODULE=gravitas_backend.settings
    exec /opt/gravitas-backend/.venv/bin/python "$2" "$3" --source "$4" --snapshot "$5" --approved-commit "$6"
  ' bash "$db" "$SCRIPT" "$action" "$SOURCE" "$snapshot" "$APPROVED"
}
public_check() {
  python3 "$BUNDLE/verify_science_universe_358.py" "$1" "$2"
}
SNAPSHOT="$STATE/published-revision-16.json"
MARKER="$STATE/release-accepted"
if [[ "$MODE" == rollback ]]; then
  dj gravitas "$SNAPSHOT" rollback
  public_check 16 baseline
  echo "SCIENCE_358_PUBLIC_ROLLBACK_VERIFIED"
  exit
fi
if [[ "$MODE" == publish ]] && sudo test -e "$MARKER"; then
  echo "SCIENCE_358_ALREADY_PUBLISHED: one-time release marker exists."
  exit
fi

# A fresh native PostgreSQL backup avoids stopping unrelated services. Restore
# the whole database under a unique name and compare the restored Lab and all
# its history against the private witness before permitting a public change.
attempt="$(sudo -u gravitas mktemp -d "$STATE/attempt.XXXXXXXX")"
attempt_snapshot="$attempt/revision-16.json"
backed_db="$attempt/gravitas.dump"
staging="gravitas_release358_$(python3 -c 'import secrets; print(secrets.token_hex(8))')"
cleanup() {
  if [[ "${staging_created:-false}" == true ]]; then
    sudo -u postgres dropdb --if-exists "$staging"
  fi
}
trap cleanup EXIT
dj gravitas "$attempt_snapshot" capture | sudo -u gravitas sh -c 'umask 077; cat > "$1"' sh "$attempt_snapshot"
sudo bash -c 'umask 077; exec sudo -u postgres pg_dump -Fc gravitas > "$1"' bash "$backed_db"
sudo sha256sum "$backed_db" | sudo tee "$attempt/gravitas.dump.sha256" >/dev/null
sudo sha256sum --check --status "$attempt/gravitas.dump.sha256"
sudo -u postgres createdb -O gravitas "$staging"
staging_created=true
sudo cat "$backed_db" | sudo -u postgres pg_restore --exit-on-error --single-transaction -d "$staging"
dj "$staging" "$attempt_snapshot" rehearse
cleanup
staging_created=false
dj gravitas "$attempt_snapshot" preflight
public_check 16 baseline
echo "SCIENCE_358_RESTORABLE_BACKUP=$attempt"
if [[ "$MODE" == preflight ]]; then
  echo "SCIENCE_358_PREMERGE_GATE_PASSED"
  exit
fi
test "$MODE" = publish
# The exclusive copy and release marker prevent ambiguous retries after a
# partially completed publication. Each attempt keeps its own native backup.
sudo -u gravitas ln "$attempt_snapshot" "$SNAPSHOT"
dj gravitas "$SNAPSHOT" publish
if verification="$(dj gravitas "$SNAPSHOT" verify)" &&
   [[ "$verification" =~ ^RELEASE_VERIFIED=([0-9]+)$ ]]; then
  expected="${BASH_REMATCH[1]}"
  for attempt_number in 1 2 3; do
    if public_check "$expected" approved; then
      sudo -u gravitas sh -c 'umask 077; printf "%s\n" "$2" "$3" "$4" > "$1.tmp"; mv "$1.tmp" "$1"' sh \
        "$MARKER" "$TARGET_SHA" "$expected" "$attempt"
      echo "SCIENCE_358_PUBLIC_VERIFIED=$expected"
      exit
    fi
    sleep 4
  done
fi
echo "PR #358 publication verification failed; attempting guarded Lab rollback." >&2
dj gravitas "$SNAPSHOT" rollback
public_check 16 baseline
exit 1
