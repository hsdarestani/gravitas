#!/usr/bin/env bash
# Public activation is separate from internal staging. It stops before changing
# nginx or restarting Django when DNS or the installed feature release is absent.
set -Eeuo pipefail
test "$(id -u)" = 0
exec 9>/run/graviquest-discourse-install.lock
flock -n 9
getent ahostsv4 forum.graviquest.com >/dev/null || {
  echo 'BLOCKED: create forum.graviquest.com DNS pointing to the GraviQuest web server.' >&2; exit 78;
}
test -f /etc/gravitas/forum.json
test -f /opt/gravitas-backend/core/forum.py || {
  echo 'BLOCKED: deploy the reviewed GraviQuest forum feature release before activation.' >&2; exit 78;
}
test "$(docker inspect -f '{{.State.Running}}' graviquest)" = true
docker exec -u discourse -w /var/www/discourse graviquest bundle exec rails runner \
  'abort "BLOCKED: configure and verify native secure S3 uploads before enabling public research discussions." unless SiteSetting.enable_s3_uploads && SiteSetting.secure_uploads'
docker exec -u discourse -w /var/www/discourse graviquest bundle exec rails runner \
  'r=JSON.parse(File.read("/shared/graviquest-integration/acceptance-results.json")); abort "BLOCKED: native private-file, restart and cleanup acceptance must pass first." unless r["private_uploads_verified"] && r["restart_persistence_verified"] && r["acceptance_cleanup_complete"]'
curl -fsS --max-time 8 -H 'Host: forum.graviquest.com' -H 'X-Forwarded-Proto: https' http://127.0.0.1:18880/srv/status >/dev/null
set -a; . /etc/gravitas/backend.env; set +a
export PYTHONPATH=/opt/gravitas-backend DJANGO_SETTINGS_MODULE=gravitas_backend.settings
PYTHON=/opt/gravitas-backend/.venv/bin/python
runuser -u gravitas -- "$PYTHON" -m django showmigrations core | grep -q '\[X\] 0092_discourse_content_links'
VHOST=/etc/nginx/sites-available/graviquest-forum
if [ -f "$VHOST" ]; then grep -q '^# Managed GraviQuest Discourse$' "$VHOST"; fi
install -d -m 755 /var/www/gravitas-forum-acme/.well-known/acme-challenge
if [ ! -f /etc/letsencrypt/live/forum.graviquest.com/fullchain.pem ]; then
  cat > "$VHOST" <<'NGINX'
# Managed GraviQuest Discourse
server {
    listen 80;
    server_name forum.graviquest.com;
    location /.well-known/acme-challenge/ { root /var/www/gravitas-forum-acme; }
    location / { return 503; }
}
NGINX
  ln -sfn "$VHOST" /etc/nginx/sites-enabled/graviquest-forum
  nginx -t
  systemctl reload nginx
  # Reuse the existing Let's Encrypt account; never accept new terms silently.
  certbot certonly --webroot -w /var/www/gravitas-forum-acme -d forum.graviquest.com --non-interactive --keep-until-expiring
fi
test -f /etc/nginx/snippets/graviquest-storage.conf || install -m 644 /dev/null /etc/nginx/snippets/graviquest-storage.conf
cat > "$VHOST" <<'NGINX'
# Managed GraviQuest Discourse
server {
    listen 80;
    server_name forum.graviquest.com;
    location /.well-known/acme-challenge/ { root /var/www/gravitas-forum-acme; }
    location / { return 301 https://forum.graviquest.com$request_uri; }
}
server {
    listen 443 ssl;
    server_name forum.graviquest.com;
    ssl_certificate /etc/letsencrypt/live/forum.graviquest.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/forum.graviquest.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    client_max_body_size 16m;
    include /etc/nginx/snippets/graviquest-storage.conf;
    location / {
        proxy_pass http://127.0.0.1:18880;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 90s;
    }
}
NGINX
ln -sfn "$VHOST" /etc/nginx/sites-enabled/graviquest-forum
nginx -t
systemctl reload nginx
python3 - <<'PY'
import json, os
from pathlib import Path
env = json.loads(Path('/etc/gravitas/forum.json').read_text())
key = Path('/var/discourse/shared/graviquest/graviquest-integration/logout-api-key').read_text().strip()
values = {'GRAVITAS_FORUM_URL':'https://forum.graviquest.com',
          'GRAVITAS_DISCOURSE_CONNECT_SECRET':env['GRAVITAS_DISCOURSE_CONNECT_SECRET'],
          'GRAVITAS_DISCOURSE_API_KEY':key,'GRAVITAS_DISCOURSE_API_USERNAME':'system'}
target = Path('/etc/gravitas/forum.env')
target.write_text(''.join(k+'='+v+'\n' for k,v in values.items()))
os.chmod(target, 0o640)
PY
chown root:gravitas /etc/gravitas/forum.env
set -a; . /etc/gravitas/forum.env; set +a
install -d -m 750 -o root -g gravitas /var/lib/graviquest-forum
install -m 640 -o root -g gravitas /var/discourse/shared/graviquest/graviquest-integration/links.json /var/lib/graviquest-forum/links.json
runuser -u gravitas -- "$PYTHON" -m django forum_content_manifest --import-links /var/lib/graviquest-forum/links.json
install -d /etc/systemd/system/gravitas-backend.service.d
cat > /etc/systemd/system/gravitas-backend.service.d/forum.conf <<'UNIT'
[Service]
EnvironmentFile=/etc/gravitas/forum.env
UNIT
cat > /etc/systemd/system/graviquest-forum-logouts.service <<'UNIT'
[Unit]
Description=Retry GraviQuest forum session revocations
After=network-online.target
[Service]
Type=oneshot
User=gravitas
Group=gravitas
WorkingDirectory=/opt/gravitas-backend
Environment=DJANGO_SETTINGS_MODULE=gravitas_backend.settings
Environment=PYTHONPATH=/opt/gravitas-backend
EnvironmentFile=/etc/gravitas/backend.env
EnvironmentFile=/etc/gravitas/forum.env
ExecStart=/opt/gravitas-backend/.venv/bin/python -m django process_forum_logouts
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
UNIT
cat > /etc/systemd/system/graviquest-forum-logouts.timer <<'UNIT'
[Unit]
Description=Retry forum sign-out every minute
[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
Persistent=true
[Install]
WantedBy=timers.target
UNIT
cat > /usr/local/sbin/graviquest-forum-health <<'HEALTH'
#!/usr/bin/env bash
set -euo pipefail
test "$(docker inspect -f '{{.State.Running}}' graviquest)" = true
curl -fsS --max-time 15 https://forum.graviquest.com/srv/status >/dev/null
curl -fsS --max-time 15 https://graviquest.com/api/forum/feed/ >/dev/null
find /var/discourse/shared/graviquest/backups/default -name '*.tar.gz' -mmin -2880 -print -quit | grep -q .
HEALTH
chmod 750 /usr/local/sbin/graviquest-forum-health
cat > /etc/systemd/system/graviquest-forum-health.service <<'UNIT'
[Unit]
Description=Check forum HTTP and recent backup
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/graviquest-forum-health
UNIT
cat > /etc/systemd/system/graviquest-forum-health.timer <<'UNIT'
[Unit]
Description=Monitor GraviQuest forum health
[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
# The new EnvironmentFile requires a process restart. It happens only after all
# public prerequisites pass, under the existing production concurrency lock.
systemctl restart gravitas-backend
systemctl enable --now graviquest-forum-logouts.timer graviquest-forum-health.timer
curl -fsS --max-time 15 https://forum.graviquest.com/latest.json >/dev/null
curl -fsS --max-time 15 https://graviquest.com/api/forum/feed/ >/dev/null
echo 'Public Forum activation checks passed. Browser SSO and delivered email still need live acceptance.'
