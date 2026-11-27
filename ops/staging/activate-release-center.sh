#!/usr/bin/env bash
# One approved rollout through the existing staging operations connection.
set -euo pipefail
umask 077

service=gravitas-workspace-staging
operator=gq-stage-deploy
account=gq-workspace-stage
config=/etc/$service
base=/opt/$service
state=/var/lib/$service
pg_container=$service-postgres
pg_database=gravitas_workspace_staging
vhost=/etc/nginx/sites-available/$service
held=c98c7ac358ae2869aa739751ab894f055cc56efa
candidate=6337c23256f70480595e33fd4b3bc4d896243374
reference=qa/release-center-with-workspace-v2
source_dir=$base/releases/$candidate/source
unit=/etc/systemd/system/$service.service
operator_home=/var/lib/gravitas-staging-operator
authorized=$operator_home/.ssh/authorized_keys
enrollment=$config/operator-enrollment
[[ "$STAGING_RUN_ID" =~ ^[0-9]{1,20}$ ]]
[[ "$STAGE_OWNER_EMAIL_B64" =~ ^[A-Za-z0-9+/=]+$ ]]
test "$(id -u)" = 0
test "$(cat "$config/created-by")" = "$service"
test "$(systemctl show "$service" -p FragmentPath --value)" = "$unit"
test "$(readlink "/etc/nginx/sites-enabled/$service")" = "$vhost"
test "$(systemctl show "$service" -p WorkingDirectory --value)" = "$base/releases/$held/source/backend"
grep -Fxq "    root $base/releases/$held/source;" "$vhost"
grep -Fq 'server_name staging.graviquest.com;' "$vhost"
grep -Fxq 'WORKSPACE_STUDIO_ENABLED=1' "$config/application.env"
grep -Fxq 'DJANGO_SETTINGS_MODULE=gravitas_backend.workspace_staging_settings' "$config/application.env"
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql"}}{{.Source}}{{end}}{{end}}' "$pg_container")" = "$state/postgres"
test "$(docker inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostIp}}:{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$pg_container")" = '127.0.0.1:15432'
awk '$1 == "MemAvailable:" {exit ($2 < 1280000)}' /proc/meminfo
test "$(df -Pk "$state" | awk 'NR==2 {print $4}')" -ge 5242880

health() {
  curl --noproxy '*' -fsS --max-time 8 --resolve "$1:443:127.0.0.1" "https://$1/api/health/" |
    python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["status"] == d["database"] == "ok"'
}
health graviquest.com
health staging.graviquest.com

exec 8>/run/lock/gravitas-workspace-staging-activation.lock
flock -n 8
exec 9>/run/lock/gravitas-workspace-staging.lock
flock -n 9
test ! -e "$config/qa-release"

backup_root=/var/backups/$service
install -d -m 0700 -o root -g root "$backup_root"
checkpoint=$(mktemp -d "$backup_root/activation-$STAGING_RUN_ID.XXXXXX")
transport=$(mktemp -d "$config/activation.XXXXXX")
token_created=0
env_updated=0
activated=0
cleanup() {
  local status=$?
  trap - EXIT
  if [ "$token_created" = 1 ] && [ "$(cat "$config/qa-release" 2>/dev/null || true)" = "$held" ]; then
    rm -f -- "$config/qa-release"
  fi
  if [ -f "$transport/temporary-entry" ] && [ -f "$authorized" ]; then
    grep -Fxv -f "$transport/temporary-entry" "$authorized" > "$transport/pruned" || test "$?" = 1
    if [ -s "$transport/pruned" ]; then
      install -m 0644 -o root -g root "$transport/pruned" "$authorized"
    else
      rm -f -- "$authorized"
    fi
  fi
  if [ "$env_updated" = 1 ] && [ "$activated" = 0 ] &&
     [ "$(systemctl show "$service" -p WorkingDirectory --value)" = "$base/releases/$held/source/backend" ]; then
    cp -p -- "$checkpoint/application.env" "$config/application.env"
  fi
  rm -rf -- "$transport"
  if health graviquest.com; then
    printf 'production_health=ok\n'
  else
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

runtime=$(sed -n 's|^ExecStart=\(/opt/gravitas-workspace-staging/releases/[0-9a-f]\{40\}/venv\)/bin/gunicorn --bind 127\.0\.0\.1:18000 .*|\1|p' "$unit")
[[ "$runtime" =~ ^/opt/gravitas-workspace-staging/releases/[0-9a-f]{40}/venv$ ]]
test -x "$runtime/bin/python"
install -d -m 0755 "$source_dir"
git -C "$source_dir" init -q
git -C "$source_dir" fetch --quiet --depth=1 --no-tags https://github.com/hsdarestani/gravitas.git "$candidate"
git -C "$source_dir" checkout --detach -q FETCH_HEAD
test "$(git -C "$source_dir" rev-parse HEAD)" = "$candidate"
if git -C "$source_dir" ls-tree -r HEAD | awk '$1 == 120000 || $1 == 160000 { invalid = 1 } END {exit !invalid}'; then
  echo 'Unexpected symlink or submodule in staging candidate' >&2
  exit 1
fi
cmp "$base/releases/$held/source/backend/requirements.txt" "$source_dir/backend/requirements.txt"
chmod -R a+rX "$source_dir"

test "$(docker exec "$pg_container" psql -XqtA -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname='$pg_database' AND r.rolname=d.datname AND NOT r.rolsuper")" = 1
docker exec "$pg_container" nice -n 15 pg_dump --lock-wait-timeout=5000 -U postgres -Fc "$pg_database" > "$checkpoint/app.dump"
docker exec -i "$pg_container" pg_restore --list < "$checkpoint/app.dump" > "$checkpoint/app.contents"
test -s "$checkpoint/app.contents"
cp -p -- "$unit" "$checkpoint/staging.service"
cp -p -- "$vhost" "$checkpoint/staging.nginx"
install -m 0600 "$config/application.env" "$checkpoint/application.env"
printf '%s\n' "$held" > "$checkpoint/previous-revision"
(cd "$checkpoint" && sha256sum app.dump > SHA256SUMS && sha256sum --quiet -c SHA256SUMS)
echo 'Staging PostgreSQL and application configuration checkpoint verified.'

printf 'STAGE_OWNER_EMAIL_B64=%s\n' "$STAGE_OWNER_EMAIL_B64" > "$transport/owner.env"
unset STAGE_OWNER_EMAIL_B64
run_stage() {
  systemd-run --quiet --wait --pipe --collect --unit "$service-activation-$1" \
    -p "User=$account" -p "EnvironmentFile=$config/application.env" -p "EnvironmentFile=$transport/owner.env" \
    -p "WorkingDirectory=$source_dir/backend" -p MemoryMax=512M -p CPUQuota=75% "${@:2}"
}
run_stage target /usr/bin/env "PYTHONPATH=$source_dir/backend" "$runtime/bin/python" "$source_dir/ops/staging/check_target.py"
run_stage plan "$runtime/bin/python" - <<'PY'
import django

django.setup()

from django.db import connection
from django.db.migrations.executor import MigrationExecutor

executor = MigrationExecutor(connection)
allowed = {('core', '0114_release_center'), ('core', '0129_merge_20261127_1321')}
plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
assert all(not backwards and (migration.app_label, migration.name) in allowed for migration, backwards in plan), 'Unexpected migration plan'
print('Staging migration plan:', ', '.join(m.name for m, _ in plan) or 'already applied')
PY
run_stage migrate "$runtime/bin/python" -m django migrate --noinput
run_stage role "$runtime/bin/python" - <<'PY'
import base64
import os

import django

django.setup()

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.db import transaction
from core.platform_runtime_v3 import core_role

email = base64.b64decode(os.environ['STAGE_OWNER_EMAIL_B64'], validate=True).decode()
owner = get_user_model().objects.get(email__iexact=email, is_active=True)
assert core_role(owner) in ('owner', 'admin'), 'Named staging account needs existing Core owner access'
with transaction.atomic():
    for label, action in (
        ('Staging Release Authors', 'author'),
        ('Staging Release Reviewers', 'review'),
        ('Staging Release Rehearsal Managers', 'rehearse'),
    ):
        permission = Permission.objects.get(content_type__app_label='core', content_type__model='releasechange',
                                            codename=f'{action}_release_change')
        group, created = Group.objects.get_or_create(name=label)
        if not created and set(group.permissions.values_list('pk', flat=True)) != {permission.pk}:
            raise SystemExit('Existing release role differs from the approved scope')
        group.permissions.add(permission)
        owner.groups.add(group)
print('Existing staging Core owner can access the release tools through scoped permission groups.')
PY

# Refresh only the stage operator and add a short-lived loopback entry.
bash "$source_dir/ops/staging/install-operator.sh"
test "$(getent passwd "$operator" | cut -d: -f6)" = "$operator_home"
ssh-keygen -q -t ed25519 -N '' -f "$transport/key"
printf 'from="127.0.0.1",restrict,command="/usr/local/lib/gravitas-staging/ssh-command" %s\n' \
  "$(cat "$transport/key.pub")" > "$transport/temporary-entry"
if [ -f "$authorized" ]; then cat "$authorized" > "$transport/authorized"; fi
cat "$transport/temporary-entry" >> "$transport/authorized"
install -m 0644 -o root -g root "$transport/authorized" "$authorized"
printf '127.0.0.1 %s\n' "$(cat /etc/ssh/ssh_host_ed25519_key.pub)" > "$transport/known_hosts"
opts=(-n -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes
      -o "UserKnownHostsFile=$transport/known_hosts" -i "$transport/key")

awk '$0 !~ /^GQ_STAGING_RELEASE_CENTER_ENABLED=/' "$config/application.env" > "$transport/app.env"
printf '%s\n' 'GQ_STAGING_RELEASE_CENTER_ENABLED=1' >> "$transport/app.env"
cp --attributes-only --preserve=mode,ownership "$config/application.env" "$transport/app.env"
mv -- "$transport/app.env" "$config/application.env"
env_updated=1
printf '%s\n' "$held" | install -o root -g root -m 0600 /dev/stdin "$config/qa-release"
token_created=1
flock -u 9
ssh "${opts[@]}" "$operator@127.0.0.1" "deploy $candidate $held $STAGING_RUN_ID $reference"
activated=1
test "$(systemctl show "$service" -p WorkingDirectory --value)" = "$source_dir/backend"
ssh "${opts[@]}" "$operator@127.0.0.1" "inspect $candidate $candidate $STAGING_RUN_ID $reference"
if ssh "${opts[@]}" "$operator@127.0.0.1" "inspect $candidate $held $STAGING_RUN_ID $reference" >/dev/null 2>&1; then
  echo 'Staging operator accepted a stale revision' >&2
  exit 1
fi
health staging.graviquest.com

# Hold the new GitHub Actions key in root-only staging storage for the
# administrator to import directly into workspace-staging over authenticated SSH.
install -d -m 0700 -o root -g root "$enrollment"
if [ ! -e "$enrollment/actions_ed25519" ]; then
  ssh-keygen -q -t ed25519 -C 'graviquest-workspace-staging-actions' -N '' -f "$enrollment/actions_ed25519"
fi
test "$(stat -c '%u:%a' "$enrollment/actions_ed25519")" = '0:600'
pub=$(ssh-keygen -y -f "$enrollment/actions_ed25519")
entry="restrict,command=\"/usr/local/lib/gravitas-staging/ssh-command\" $pub"
if ! grep -Fxq "$entry" "$authorized"; then printf '%s\n' "$entry" >> "$authorized"; fi
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub | awk '{print "ssh_host_fingerprint=" $2}'
echo 'Dedicated staging SSH identity generated and its restricted public key enrolled.'
