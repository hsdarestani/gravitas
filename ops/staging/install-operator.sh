#!/usr/bin/env bash
# Enable the restricted staging operator. Supply its public key separately.
set -euo pipefail
test "$(id -u)" = 0
test "$(cat /etc/gravitas-workspace-staging/created-by)" = gravitas-workspace-staging
test "$(systemctl show gravitas-workspace-staging -p FragmentPath --value)" = /etc/systemd/system/gravitas-workspace-staging.service
test -x /usr/sbin/visudo
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
destination=/usr/local/lib/gravitas-staging
identity=gq-stage-deploy
home_dir=/var/lib/gravitas-staging-operator
sudo_rule=/etc/sudoers.d/gq-stage-deploy
umask 077
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT

if [ "$#" -gt 0 ]; then
  test "$#" = 1
  public_key=$(cat -- "$1")
  [[ "$public_key" != *$'\n'* && "$public_key" != *$'\r'* ]]
  [[ "$public_key" =~ ^ssh-ed25519[[:blank:]][A-Za-z0-9+/=]+([[:blank:]][[:print:]]*)?$ ]]
  ssh-keygen -l -f "$1" >/dev/null
  printf 'restrict,command="%s/ssh-command" %s\n' "$destination" "$public_key" > "$temp/authorized_keys"
fi

printf '%s ALL=(root) NOPASSWD: %s/release.sh\n' "$identity" "$destination" > "$temp/sudoers"
/usr/sbin/visudo -cf "$temp/sudoers" >/dev/null

if ! getent passwd "$identity" >/dev/null; then
  useradd --system --user-group --home-dir "$home_dir" --no-create-home --shell /bin/sh "$identity"
fi
test "$(getent passwd "$identity" | cut -d: -f6-7)" = "$home_dir:/bin/sh"
passwd -l "$identity" >/dev/null
test "$(id -Gn "$identity")" = "$identity"
install -d -m 0755 -o root -g root "$destination" "$home_dir" "$home_dir/.ssh"
install -m 0755 -o root -g root "$source_dir/release.sh" "$source_dir/ssh-command" "$destination/"
install -m 0644 -o root -g root "$source_dir/"{check_target,public_pages,site_config}.py "$destination/"
install -m 0440 -o root -g root "$temp/sudoers" "$sudo_rule"
if [ -s "$temp/authorized_keys" ]; then
  install -m 0644 -o root -g root "$temp/authorized_keys" "$home_dir/.ssh/authorized_keys"
fi
if [ -s "$home_dir/.ssh/authorized_keys" ]; then
  echo 'Staging operator installed with restricted public-key authentication.'
else
  echo 'Staging operator installed; no SSH key is authorized yet.'
fi
