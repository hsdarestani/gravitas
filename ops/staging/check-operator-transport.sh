#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" -eq 0
service=gravitas-workspace-staging
test "$(cat "/etc/$service/created-by")" = "$service"
operator=/var/lib/gravitas-staging-operator/.ssh/authorized_keys
test -d "${operator%/*}"
test ! -e "$operator"
test ! -e "/etc/$service/qa-release"
umask 077
temp=$(mktemp -d "${operator%/*}/.rehearsal-XXXXXX")
admitted=0
cleanup() {
  if [ "$admitted" -eq 1 ] && [ "$operator" -ef "$temp/authorized_keys" ]; then rm -f -- "$operator"; fi
  rm -rf -- "$temp"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
ssh-keygen -q -t ed25519 -N '' -f "$temp/key"
printf 'from="127.0.0.1",restrict,command="/usr/local/lib/gravitas-staging/ssh-command" %s\n' \
  "$(cat "$temp/key.pub")" > "$temp/authorized_keys"
ln -T "$temp/authorized_keys" "$operator"
admitted=1
chmod 0644 "$operator"
printf '127.0.0.1 %s\n' "$(cat /etc/ssh/ssh_host_ed25519_key.pub)" > "$temp/known_hosts"
opts=(-n -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes
      -o "UserKnownHostsFile=$temp/known_hosts" -i "$temp/key")
target=gq-stage-deploy@127.0.0.1
working=$(systemctl show "$service" -p WorkingDirectory --value)
[[ "$working" =~ ^/opt/gravitas-workspace-staging/releases/([a-f0-9]{40})/source/backend$ ]]
revision=${BASH_REMATCH[1]}
ssh "${opts[@]}" "$target" "inspect $revision $revision 1 release-qa" | grep -Fx "staging_live_revision=$revision"
if ssh "${opts[@]}" "$target" 'id' >/dev/null 2>&1; then
  echo 'Staging operator allowed an unrelated command' >&2
  exit 1
fi
stale=0000000000000000000000000000000000000000
if ssh "${opts[@]}" "$target" "inspect $revision $stale 1 release-qa" >/dev/null 2>&1; then
  echo 'Staging operator accepted a stale current revision' >&2
  exit 1
fi
test "$working" = "$(systemctl show "$service" -p WorkingDirectory --value)"
test "$operator" -ef "$temp/authorized_keys"
rm -f -- "$operator"
admitted=0
if ssh "${opts[@]}" "$target" "inspect $revision $revision 1 release-qa" >/dev/null 2>&1; then
  echo 'Revoked rehearsal key still authenticated' >&2
  exit 1
fi
echo 'SSH transport, forced command, stale revision refusal and immediate key revocation verified.'
