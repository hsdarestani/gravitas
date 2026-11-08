#!/usr/bin/env bash
# Restore the official backup into a new disposable database in the isolated
# Forum container. Never run restore against its production database. Keep all
# SQL output private: a backup can contain credentials and private discussions.
set -Eeuo pipefail
test "$(id -u)" = 0
umask 077
LOG=/var/log/graviquest-restore-acceptance.log
install -m 600 /dev/null "$LOG"
RESTORE_DB="gq_restore_acceptance_$(python3 -c 'import secrets;print(secrets.token_hex(8))')"
[[ "$RESTORE_DB" =~ ^gq_restore_acceptance_[a-f0-9]{16}$ ]]
cleanup() {
  docker exec -u postgres graviquest dropdb --if-exists "$RESTORE_DB" >>"$LOG" 2>&1 || true
}
trap cleanup EXIT
if ! docker exec -e RAILS_ENV=production -u discourse -w /var/www/discourse graviquest bundle exec ruby script/discourse backup --s3-uploads >>"$LOG" 2>&1; then
  echo 'Native backup failed; diagnostic remains in its root-only recovery log.' >&2; exit 1
fi
ARCHIVE="$(python3 - <<'PY'
from pathlib import Path
files=list(Path('/var/discourse/shared/graviquest/backups/default').glob('*.tar.gz'))
assert files, 'No native backup exists'
print(max(files,key=lambda path:path.stat().st_mtime))
PY
)"
readarray -t CONTENTS < <(tar -tzf "$ARCHIVE")
SQL=''
for name in "${CONTENTS[@]}"; do
  if [ "$name" = dump.sql.gz ]; then SQL="$name"; fi
done
test -n "$SQL"
docker exec -u postgres graviquest createdb -O discourse "$RESTORE_DB" >>"$LOG" 2>&1
if ! { tar -xOzf "$ARCHIVE" "$SQL" | gzip -dc | docker exec -i -u postgres graviquest psql -v ON_ERROR_STOP=1 -d "$RESTORE_DB"; } >>"$LOG" 2>&1; then
  echo 'Isolated backup restore failed; production database was not a restore target.' >&2; exit 1
fi
docker exec -u postgres graviquest psql -v ON_ERROR_STOP=1 -d "$RESTORE_DB" -c "DO \$\$ BEGIN IF NOT EXISTS(SELECT 1 FROM themes WHERE name='GraviQuest Community') OR NOT EXISTS(SELECT 1 FROM topics WHERE deleted_at IS NULL) OR NOT EXISTS(SELECT 1 FROM users WHERE id=-1) THEN RAISE EXCEPTION 'Missing restored forum data'; END IF; END \$\$;" >>"$LOG" 2>&1
ORIGINAL=''; EXPECTED=''
for name in "${CONTENTS[@]}"; do
  if [[ "$name" =~ ^uploads/.*/?original/.*/[a-f0-9]{40}\.[[:alnum:]]+$ ]]; then
    UPLOAD_HASH="$(basename "$name")"; UPLOAD_HASH="${UPLOAD_HASH%%.*}"
    [[ "$UPLOAD_HASH" =~ ^[a-f0-9]{40}$ ]]
    EXPECTED="$(docker exec -u postgres graviquest psql -At -d "$RESTORE_DB" -c "SELECT COALESCE(NULLIF(original_sha1,''),sha1) FROM uploads WHERE sha1='$UPLOAD_HASH' AND (url LIKE '//%' OR url LIKE 'https://%') LIMIT 1;")"
    if [ -n "$EXPECTED" ]; then ORIGINAL="$name"; break; fi
  fi
done
test -n "$ORIGINAL" && test -n "$EXPECTED"
ACTUAL="$(tar -xOzf "$ARCHIVE" "$ORIGINAL" | sha1sum | cut -d' ' -f1)"
test -n "$EXPECTED" && test "$EXPECTED" = "$ACTUAL"
docker exec -u postgres graviquest dropdb "$RESTORE_DB" >>"$LOG" 2>&1
trap - EXIT
echo 'Native backup restored into a disposable database; brand, discussions and original attachment bytes verified. Temporary database removed.'
