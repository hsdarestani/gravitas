#!/usr/bin/env bash
set -euo pipefail

MAIN_DOMAIN="${1:-gravitasplus.com}"
CLOUD_DOMAIN="${2:-cloud.gravitasplus.com}"
PUBLIC_URL_FILE=/etc/gravitas/nextcloud-public-url
CREDS=/etc/gravitas/nextcloud-admin-credentials
SITE=/etc/nginx/sites-available/gravitas-nextcloud-cloud

# Start with an HTTP-only vhost so Certbot can complete the ACME challenge.
# If DNS is not ready, the migration is deliberately skipped and the existing
# /nextcloud route stays live. The next workflow run will retry automatically.
cat > "$SITE" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $CLOUD_DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:8081/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_request_buffering off;
        proxy_buffering off;
        client_max_body_size 2G;
        proxy_connect_timeout 60s;
        proxy_send_timeout 3600s;
        proxy_read_timeout 3600s;
    }
}
NGINX
ln -sfn "$SITE" /etc/nginx/sites-enabled/gravitas-nextcloud-cloud
nginx -t
systemctl reload nginx

CERT_DIR="/etc/letsencrypt/live/$CLOUD_DOMAIN"
if [ ! -f "$CERT_DIR/fullchain.pem" ] || [ ! -f "$CERT_DIR/privkey.pem" ]; then
    if ! certbot --nginx -d "$CLOUD_DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
        echo "Nextcloud subdomain DNS/certificate is not ready; keeping https://$MAIN_DOMAIN/nextcloud/ active."
        rm -f /etc/nginx/sites-enabled/gravitas-nextcloud-cloud
        nginx -t
        systemctl reload nginx
        exit 0
    fi
fi

# Certbot may have edited the temporary vhost. Replace it with the canonical,
# deterministic proxy so future deploys are independent of Certbot formatting.
cat > "$SITE" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $CLOUD_DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $CLOUD_DOMAIN;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location = /.well-known/carddav { return 301 /remote.php/dav; }
    location = /.well-known/caldav { return 301 /remote.php/dav; }

    location / {
        proxy_pass http://127.0.0.1:8081/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_request_buffering off;
        proxy_buffering off;
        client_max_body_size 2G;
        proxy_connect_timeout 60s;
        proxy_send_timeout 3600s;
        proxy_read_timeout 3600s;
    }

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
}
NGINX
ln -sfn "$SITE" /etc/nginx/sites-enabled/gravitas-nextcloud-cloud
nginx -t
systemctl reload nginx

occ() {
    docker exec -u www-data gravitas-nextcloud php occ "$@"
}

occ config:system:set trusted_domains 1 --value="$CLOUD_DOMAIN" >/dev/null
occ config:system:set overwritehost --value="$CLOUD_DOMAIN" >/dev/null
occ config:system:set overwriteprotocol --value=https >/dev/null
occ config:system:delete overwritewebroot >/dev/null 2>&1 || true
occ config:system:set overwrite.cli.url --value="https://$CLOUD_DOMAIN" >/dev/null

printf 'https://%s\n' "$CLOUD_DOMAIN" > "$PUBLIC_URL_FILE"
chmod 644 "$PUBLIC_URL_FILE"

# Django uses this for native Nextcloud/Assistant links while WebDAV keeps using
# the private 127.0.0.1:8081 endpoint.
touch /etc/gravitas/backend.env
sed -i '/^NEXTCLOUD_PUBLIC_URL=/d' /etc/gravitas/backend.env
printf 'NEXTCLOUD_PUBLIC_URL=https://%s\n' "$CLOUD_DOMAIN" >> /etc/gravitas/backend.env
chown root:gravitas /etc/gravitas/backend.env
chmod 640 /etc/gravitas/backend.env

if [ -f "$CREDS" ]; then
    sed -i "s#^url=.*#url=https://$CLOUD_DOMAIN/#" "$CREDS"
fi

# Switch legacy routes only after the new hostname has a valid certificate and
# Nextcloud itself knows its canonical host.
if [ -x /usr/local/sbin/gravitas-nextcloud-nginx-route ]; then
    /usr/local/sbin/gravitas-nextcloud-nginx-route
fi
systemctl try-restart gravitas-backend.service || true

curl -fsS --retry 10 --retry-delay 2 "https://$CLOUD_DOMAIN/status.php" | grep -q '"installed":true'
curl -fsSI "https://$MAIN_DOMAIN/nextcloud/" | grep -Eq '^HTTP/.* 30[12378]'
echo "Nextcloud canonical URL: https://$CLOUD_DOMAIN/"
