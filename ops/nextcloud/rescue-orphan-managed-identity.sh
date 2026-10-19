#!/usr/bin/env bash
# Recover one explicitly named missing Gravitas-managed Nextcloud account whose
# creation is blocked by orphaned files. Never delete the original data.
set -euo pipefail
umask 077

USER_ID="${1:-}"
if [[ ! "$USER_ID" =~ ^gravitas-u-[0-9]+$ ]] || [[ "$(id -u)" -ne 0 ]]; then
  echo "Requires root and an explicit managed Nextcloud account" >&2
  exit 2
fi
NC_CONTAINER="${NC_CONTAINER:-gravitas-nextcloud}"
NC_DB_CONTAINER="${NC_DB_CONTAINER:-gravitas-nextcloud-db}"
exec 9>/run/gravitas-nextcloud-identity.lock
flock -w 120 9
occ() { docker exec -u www-data "$NC_CONTAINER" php occ "$@"; }

if occ user:info "$USER_ID" >/dev/null 2>&1; then
  echo "Native identity exists; no orphan recovery needed for $USER_ID"
  exit 0
fi
if [[ "$(occ config:system:get datadirectory)" != "/var/www/html/data" ]]; then
  echo "Unexpected Nextcloud data directory; refusing recovery" >&2
  exit 1
fi
MOUNT="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/www/html"}}{{.Source}}{{end}}{{end}}' "$NC_CONTAINER")"
if [[ ! -d "$MOUNT/data" || -L "$MOUNT/data" || ! -e "$MOUNT/config/config.php" ]]; then
  echo "Unverified persistent Nextcloud volume" >&2
  exit 1
fi
HOME_DIR="$MOUNT/data/$USER_ID"
if [[ ! -d "$HOME_DIR" || -L "$HOME_DIR" ]]; then
  echo "No orphan directory; normal user provisioning can recover this account"
  exit 0
fi
if [[ ! -d "$HOME_DIR/files" || -L "$HOME_DIR/files" ]]; then
  echo "Unexpected orphan layout, manual investigation required" >&2
  exit 1
fi
if occ encryption:status 2>/dev/null | grep -Eiq 'Enabled:[[:space:]]*(yes|true)'; then
  echo "Server-side encryption enabled; refusing generic file restoration" >&2
  exit 1
fi

# Fail closed unless enough free space exists for backup plus restored copy;
# the quarantined original remains available after successful recovery.
KB="$(du -sk -- "$HOME_DIR" | awk '{print $1}')"
FREE_KB="$(df -Pk -- "$MOUNT" | awk 'NR==2{print $4}')"
if [[ ! "$KB" =~ ^[0-9]+$ || ! "$FREE_KB" =~ ^[0-9]+$ ]] || (( FREE_KB < KB * 3 + 262144 )); then
  echo "Insufficient free space for safe backup/restoration" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
BACKUP_ROOT=/var/backups/gravitas-nextcloud/orphan-identity
mkdir -p -m 700 "$BACKUP_ROOT"
FILES_BACKUP="$BACKUP_ROOT/$USER_ID-$STAMP.tar.gz"
DB_BACKUP="$BACKUP_ROOT/$USER_ID-$STAMP.db.dump"
RECOVERY_ROOT="$MOUNT/.gravitas-orphan-rescues"
mkdir -p -m 700 "$RECOVERY_ROOT"
QUARANTINE="$RECOVERY_ROOT/$USER_ID-$STAMP"

# Back up Nextcloud PostgreSQL and the entire original native home BEFORE moving.
docker exec "$NC_DB_CONTAINER" pg_dump -U nextcloud -Fc nextcloud > "$DB_BACKUP.tmp"
mv -- "$DB_BACKUP.tmp" "$DB_BACKUP"
tar -C "$MOUNT/data" -czf "$FILES_BACKUP.tmp" -- "$USER_ID"
tar -tzf "$FILES_BACKUP.tmp" >/dev/null
mv -- "$FILES_BACKUP.tmp" "$FILES_BACKUP"
echo "Verified independent DB and file backups before native account recreation."

# Atomic same-volume rename, not a deletion. Never replace any new home.
mv -- "$HOME_DIR" "$QUARANTINE"
if occ user:info "$USER_ID" >/dev/null 2>&1; then
  echo "Account reappeared during recovery; old data retained in $QUARANTINE" >&2
  exit 1
fi

TEMP_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
if ! docker exec -u www-data -e OC_PASS="$TEMP_PASSWORD" "$NC_CONTAINER" \
     php occ user:add --password-from-env "$USER_ID" >/dev/null; then
  if [[ ! -e "$HOME_DIR" ]]; then mv -- "$QUARANTINE" "$HOME_DIR"; fi
  echo "Native user creation failed; source files and backups preserved" >&2
  exit 1
fi
unset TEMP_PASSWORD
if ! occ user:info "$USER_ID" >/dev/null 2>&1; then
  echo "Recreated user not confirmed, source preserved for manual review" >&2
  exit 1
fi

# No overwrite: any files initialized by Nextcloud always win. Original is
# retained in quarantine + backup, so recovery can be audited or reversed.
mkdir -p "$HOME_DIR"
cp -a -n -- "$QUARANTINE/." "$HOME_DIR/"
chown -R 33:33 "$HOME_DIR"
occ files:scan "$USER_ID" >/dev/null
echo "Recovered $USER_ID without deleting old files; full backups retained."
