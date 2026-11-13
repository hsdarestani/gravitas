#!/usr/bin/env bash
# Explicit, one-time production publication of approved Science Universe PR #357.
# This is invoked only by the post-deploy GitHub Actions release gate.
set -euo pipefail
umask 077

TARGET_SHA="$1"
BACKEND=/opt/gravitas-backend
FRONT=/var/www/gravitas
STATE=/var/lib/gravitas/science-release-357
SNAPSHOT="$STATE/published-revision-15.json"
MARKER="$STATE/release-accepted"

sudo install -d -m 700 -o gravitas -g gravitas "$STATE"
test "$TARGET_SHA" = "$(sudo cat /etc/gravitas/last-successful-deploy-sha)"
test -x "$BACKEND/.venv/bin/python"
test -f "$FRONT/ops/science_universe_release_357.py"
if sudo test -f "$MARKER"; then
  echo "ALREADY_PUBLISHED: release 357 previously verified."
  exit 0
fi

dj() {
  sudo -u gravitas bash -c '
    set -euo pipefail
    set -a
    . /etc/gravitas/backend.env
    if [ -r /etc/gravitas/openedx.env ]; then . /etc/gravitas/openedx.env; fi
    set +a
    export PYTHONPATH=/opt/gravitas-backend DJANGO_SETTINGS_MODULE=gravitas_backend.settings
    exec /opt/gravitas-backend/.venv/bin/python \
      /var/www/gravitas/ops/science_universe_release_357.py "$@"
  ' bash "$@"
}
admin() {
  sudo -u gravitas bash -c '
    set -euo pipefail
    set -a
    . /etc/gravitas/backend.env
    if [ -r /etc/gravitas/openedx.env ]; then . /etc/gravitas/openedx.env; fi
    set +a
    export PYTHONPATH=/opt/gravitas-backend DJANGO_SETTINGS_MODULE=gravitas_backend.settings
    exec /opt/gravitas-backend/.venv/bin/django-admin "$@"
  ' bash "$@"
}

# A stateful deploy has already captured and actually restore-rehearsed
# the complete native stack before this post-deploy workflow can run.
CHECKPOINT="$(sudo python3 - <<'PY'
import json
from pathlib import Path
base=Path('/var/backups/gravitas-canonical')
complete=[]
for p in base.iterdir():
    if not p.is_dir() or p.is_symlink():
        continue
    try:
        m=json.loads((p/'manifest.json').read_text())
        if m.get('schema')==1 and m.get('state')=='complete':
            complete.append((p.stat().st_mtime, str(p)))
    except (OSError, ValueError, TypeError):
        continue
if complete:
    print(sorted(complete)[-1][1])
PY
)"
test -n "$CHECKPOINT" || {
  echo "::error::No complete native checkpoint to restore-rehearse. Publication refused."
  exit 1
}
# Do not trust a previous rehearsal marker: verify content and rehearse an
# isolated restore NOW against the selected matching production snapshot.
sudo python3 "$FRONT/ops/canonical_checkpoint.py" verify --checkpoint "$CHECKPOINT"
sudo python3 "$FRONT/ops/canonical_checkpoint.py" rehearse --checkpoint "$CHECKPOINT" --apply
sudo test -f "$CHECKPOINT/rehearsal.json"
echo "RESTORABLE_NATIVE_CHECKPOINT_VERIFIED"

# Targeted Lab-only snapshot is stored outside canonical backup pruning.
# Never log or upload this JSON because it may contain unpublished author work.
if ! sudo test -f "$SNAPSHOT"; then
  TMP="$(mktemp)"
  trap 'rm -f "$TMP"' EXIT
  dj capture > "$TMP"
  sudo install -o gravitas -g gravitas -m 600 "$TMP" "$SNAPSHOT"
  rm -f "$TMP"
  trap - EXIT
fi
sudo -u gravitas test -s "$SNAPSHOT"
dj preflight --snapshot "$SNAPSHOT"

DRY_RUN="$(admin upgrade_science_universe_science)"
printf '%s\n' "$DRY_RUN"
grep -q '^DRY RUN: Science v2 fits existing sources' <<<"$DRY_RUN" || {
  echo "::error::Production dry-run did not confirm a safe upgrade."
  exit 1
}

# Only this approval-gated release passes the flag. Regular deploy remains
# unable to publish Science Universe automatically.
admin upgrade_science_universe_science --apply --approved-publication
if ! dj verify --snapshot "$SNAPSHOT"; then
  echo "::error::Revision/source verification failed. Attempting Lab-only rollback."
  dj rollback --snapshot "$SNAPSHOT" || true
  exit 1
fi

EXPECTED="$(sudo -u gravitas python3 -c \
  'import json,sys; print(json.load(open(sys.argv[1]))["version"]+1)' "$SNAPSHOT")"
PUBLIC_OK=false
for attempt in 1 2 3 4 5; do
  API_VERSION="$(curl -fsSL --connect-timeout 7 --max-time 15 \
    https://graviquest.com/api/labs/science-universe/ \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("published_version",""))' 2>/dev/null || true)"
  if [ "$API_VERSION" = "$EXPECTED" ] &&
     curl -fsSL --connect-timeout 7 --max-time 15 \
       https://graviquest.com/lab-run/science-universe/ | grep -q 'focus-pipeline'; then
    PUBLIC_OK=true
    break
  fi
  sleep 4
done
if [ "$PUBLIC_OK" != true ]; then
  echo "::error::Public API or rendered HTML did not serve the approved source. Guarded rollback."
  dj rollback --snapshot "$SNAPSHOT" || true
  exit 1
fi

sudo -u gravitas bash -c \
  'printf "%s\n" "approved-feature=3325e2aa13e04e89080cf4e6fa09cec900c35123" \
    "production-sha=$1" "snapshot=$2" "native-checkpoint=$3" \
    "published-version=$4" > "$5"' \
  bash "$TARGET_SHA" "$SNAPSHOT" "$CHECKPOINT" "$EXPECTED" "$MARKER"
sudo -u gravitas chmod 600 "$MARKER"
echo "SCIENCE_UNIVERSE_RELEASE_VERIFIED published_version=$EXPECTED"
