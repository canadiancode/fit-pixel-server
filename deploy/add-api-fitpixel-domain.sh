#!/usr/bin/env bash
# Adds api.fitpixel.app to the existing droplet next to api.aurashields.com
# (run once as root). Leaves the aurashields site untouched so app builds that
# still call it keep working.
# Prerequisite: DNS api.fitpixel.app A → this droplet, DNS only (grey cloud).
set -euo pipefail

DOMAIN="api.fitpixel.app"
SITE="/etc/nginx/sites-available/${DOMAIN}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  # HTTP-only block; Certbot adds the 443 listener and the HTTP → HTTPS redirect.
  cat > "$SITE" <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name api.fitpixel.app;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX
  ln -sf "$SITE" "/etc/nginx/sites-enabled/${DOMAIN}"
  nginx -t
  systemctl reload nginx

  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect -m hello@fitpixel.app
fi

nginx -t
systemctl reload nginx
curl -fsS "https://${DOMAIN}/health"
echo
echo "${DOMAIN} is live."
