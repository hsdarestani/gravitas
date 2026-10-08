#!/usr/bin/env bash
set -euo pipefail
SOURCE="$(cd "$(dirname "$0")" && pwd)/gravitascanonical"
test -f "$SOURCE/lib/Controller/AclController.php"
set -a
. /etc/gravitas/backend.env
set +a
test -n "$NEXTCLOUD_ADMIN_USER"
docker exec gravitas-nextcloud mkdir -p /var/www/html/custom_apps/gravitascanonical
docker cp "$SOURCE/." gravitas-nextcloud:/var/www/html/custom_apps/gravitascanonical/
docker exec gravitas-nextcloud chown -R www-data:www-data /var/www/html/custom_apps/gravitascanonical
docker exec -u www-data gravitas-nextcloud php -l /var/www/html/custom_apps/gravitascanonical/lib/Controller/AclController.php
docker exec -u www-data gravitas-nextcloud php occ app:enable gravitascanonical
docker exec -u www-data gravitas-nextcloud php occ config:app:set gravitascanonical service_user --value="$NEXTCLOUD_ADMIN_USER" >/dev/null
