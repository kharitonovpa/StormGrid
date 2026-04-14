#!/usr/bin/env bash
# Run this ON the Russian VPS (ssh root@<IP> first)
# Usage: bash setup-ru-vps.sh <POLISH_SERVER_IP>
set -euo pipefail

POLISH_IP="${1:-64.176.71.39}"

echo "==> [1/5] Installing nginx + certbot..."
apt update && apt upgrade -y
apt install -y nginx
snap install --classic certbot
ln -s /snap/bin/certbot /usr/bin/certbot 2>/dev/null || true

echo "==> [2/5] Configuring firewall..."
ufw allow "Nginx Full"
ufw allow OpenSSH
ufw --force enable

echo "==> [3/5] Creating temp config for SSL certificate..."
mkdir -p /var/www/wheee
cat > /etc/nginx/sites-available/ru.wheee.io <<'NGINX'
server {
    listen 80;
    server_name ru.wheee.io;
    root /var/www/wheee;
    location / { return 200 'ok'; add_header Content-Type text/plain; }
}
NGINX

ln -sf /etc/nginx/sites-available/ru.wheee.io /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> [4/5] Obtaining SSL certificate..."
certbot --nginx -d ru.wheee.io --non-interactive --agree-tos --register-unsafely-without-email

echo "==> [5/5] Writing production nginx config..."
cat > /etc/nginx/sites-available/ru.wheee.io <<NGINX
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name ru.wheee.io;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ru.wheee.io;

    ssl_certificate     /etc/letsencrypt/live/ru.wheee.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ru.wheee.io/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    root /var/www/wheee;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|glb)\$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location /ws {
        proxy_pass http://${POLISH_IP}:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
NGINX

nginx -t && systemctl reload nginx

echo ""
echo "==> All done! Russian VPS is ready."
echo "    Static root: /var/www/wheee/"
echo "    WS proxy:    /ws -> http://${POLISH_IP}:3001"
echo "    Next step:   deploy static files with deploy-ru.sh"
