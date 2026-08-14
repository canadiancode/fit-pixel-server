#!/usr/bin/env bash
# One-time droplet bootstrap for Fit Pixel API (run as root on Ubuntu).
# Prerequisites:
#   - DNS: api.aurashields.com A → this server's public IP
#   - If the GitHub repo is private: configure a read-only deploy key and use the SSH clone URL below
set -euo pipefail

APP_DIR="/var/www/fit-pixel-server"
REPO_URL="${REPO_URL:-https://github.com/canadiancode/fit-pixel-server.git}"
DOMAIN="api.aurashields.com"
NODE_MAJOR=20

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx git curl ufw ca-certificates gnupg

# Node.js 20 (NodeSource)
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//;s/\..*//')" -lt "$NODE_MAJOR" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

npm install -g pm2

# Firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

mkdir -p /var/www
if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch origin main
  git -C "$APP_DIR" reset --hard origin/main
fi

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  cat >> .env <<'EOF'

# Production defaults (edit secrets as needed; never commit this file)
NODE_ENV=production
PORT=3001
# Empty = no browser CORS (native Expo / curl still work). Never * + credentials.
CORS_ORIGINS=
EOF
  echo "Created $APP_DIR/.env — review and fill secrets before relying on food/auth features."
fi

npm ci
npm run build

pm2 start ecosystem.config.cjs || pm2 reload fit-pixel-api --update-env
pm2 save
pm2 startup systemd -u root --hp /root | tail -n 1 | bash || true

NGINX_AVAILABLE="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
CERT_LIVE="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

if [[ -f "$CERT_LIVE" ]]; then
  cp "$APP_DIR/deploy/nginx-api.aurashields.com.conf" "$NGINX_AVAILABLE"
else
  # HTTP-only until Certbot issues certs; then copy the committed 80/443 config.
  cat > "$NGINX_AVAILABLE" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX
fi
ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo
echo "DNS must resolve ${DOMAIN} to this host before Certbot."
echo "When ready, run:"
echo "  certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos --redirect -m YOUR_EMAIL@example.com"
echo "  cp $APP_DIR/deploy/nginx-api.aurashields.com.conf $NGINX_AVAILABLE"
echo "  nginx -t && systemctl reload nginx"
echo
echo "Then verify:"
echo "  curl -fsS -o /dev/null -w '%{http_code}\\n' http://${DOMAIN}/health   # expect 301"
echo "  curl -fsS https://${DOMAIN}/health"
echo
echo "Bootstrap complete. App dir: ${APP_DIR}"
