#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-gravitasplus.com}"
TARGET=/etc/nginx/sites-available/gravitas
GUARD=/usr/local/sbin/gravitas-nextcloud-nginx-route

cat > "$GUARD" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
TARGET=/etc/nginx/sites-available/gravitas
[ -f "$TARGET" ] || exit 0

python3 - <<'PY'
from pathlib import Path
import re

p = Path('/etc/nginx/sites-available/gravitas')
s = p.read_text()
old = s
s = re.sub(r'\n\s*# BEGIN GRAVITAS NEXTCLOUD.*?# END GRAVITAS NEXTCLOUD\s*\n', '\n', s, flags=re.S)
m = re.search(r'(?m)^(?P<indent>\s*)location / \{', s)
if not m:
    raise SystemExit('Could not find Gravitas frontend location in nginx config')
i = m.group('indent')
block = f'''{i}# BEGIN GRAVITAS NEXTCLOUD
{i}location = /nextcloud {{ return 301 /nextcloud/; }}
{i}location = /.well-known/carddav {{ return 301 /nextcloud/remote.php/dav; }}
{i}location = /.well-known/caldav {{ return 301 /nextcloud/remote.php/dav; }}
{i}location ^~ /nextcloud/ {{
{i}    proxy_pass http://127.0.0.1:8081/;
{i}    proxy_http_version 1.1;
{i}    proxy_set_header Host $host;
{i}    proxy_set_header X-Real-IP $remote_addr;
{i}    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
{i}    proxy_set_header X-Forwarded-Proto $scheme;
{i}    proxy_set_header X-Forwarded-Host $host;
{i}    proxy_set_header X-Forwarded-Prefix /nextcloud;
{i}    proxy_request_buffering off;
{i}    proxy_buffering off;
{i}    client_max_body_size 2G;
{i}    proxy_connect_timeout 60s;
{i}    proxy_send_timeout 3600s;
{i}    proxy_read_timeout 3600s;
{i}}}
{i}# END GRAVITAS NEXTCLOUD
'''
updated = s[:m.start()] + block + s[m.start():]
if updated != old:
    p.write_text(updated)
PY

nginx -t >/dev/null
systemctl reload nginx
SCRIPT
chmod 750 "$GUARD"

cat > /etc/systemd/system/gravitas-nextcloud-nginx-guard.service <<EOF
[Unit]
Description=Restore Gravitas Nextcloud reverse-proxy route after Nginx config changes
After=nginx.service

[Service]
Type=oneshot
ExecStart=$GUARD
EOF

cat > /etc/systemd/system/gravitas-nextcloud-nginx-guard.path <<EOF
[Unit]
Description=Watch Gravitas Nginx configuration for Nextcloud route regressions

[Path]
PathChanged=$TARGET
Unit=gravitas-nextcloud-nginx-guard.service

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now gravitas-nextcloud-nginx-guard.path
"$GUARD"

curl -fsS "https://$DOMAIN/nextcloud/status.php" | grep -q '"installed":true'
echo 'Nextcloud Nginx route guard installed and verified.'
