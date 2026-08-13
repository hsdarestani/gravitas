#!/usr/bin/env bash
set -euo pipefail

PUBKEY="${1:?public key required}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

if ! id deploy >/dev/null 2>&1; then
  $SUDO useradd --create-home --shell /bin/bash deploy
fi

$SUDO install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
printf '%s\n' "$PUBKEY" | $SUDO tee /home/deploy/.ssh/authorized_keys >/dev/null
$SUDO chown deploy:deploy /home/deploy/.ssh/authorized_keys
$SUDO chmod 600 /home/deploy/.ssh/authorized_keys

printf '%s\n' 'deploy ALL=(ALL) NOPASSWD: ALL' | $SUDO tee /etc/sudoers.d/90-gravitas-deploy >/dev/null
$SUDO chmod 440 /etc/sudoers.d/90-gravitas-deploy
$SUDO visudo -cf /etc/sudoers.d/90-gravitas-deploy

echo 'deploy-user-ready'
