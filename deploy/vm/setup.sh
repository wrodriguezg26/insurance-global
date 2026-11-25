#!/usr/bin/env bash
# Instalación de Insurance Global en una VM Ubuntu (22.04 o 24.04). Ejecutar con: sudo bash setup.sh
set -euo pipefail
REPO="https://github.com/wrodriguezg26/insurance-global.git"
DOMINIO="seguros.t-shits.co"

echo "== 1/6 Paquetes del sistema"
apt-get update -y
apt-get install -y nginx git curl unzip ca-certificates certbot python3-certbot-nginx

echo "== 2/6 Node.js 20"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "== 3/6 Usuario de servicio y código"
id insurance >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin insurance
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -f "$SRC/index.html" ] && [ "$SRC" != "/opt/insurance-global" ]; then
  echo "Usando el código de $SRC (copia local, sin GitHub)"
  mkdir -p /opt/insurance-global && cp -a "$SRC"/. /opt/insurance-global/
elif [ -d /opt/insurance-global/.git ]; then git -C /opt/insurance-global pull --ff-only
elif [ ! -f /opt/insurance-global/index.html ]; then git clone "$REPO" /opt/insurance-global; fi
chown -R root:root /opt/insurance-global && chmod -R a+rX /opt/insurance-global
mkdir -p /var/www/insurance-global
cp /opt/insurance-global/index.html /var/www/insurance-global/index.html
rm -rf /var/www/insurance-global/img && cp -r /opt/insurance-global/img /var/www/insurance-global/
(cd /opt/insurance-global/api && npm install --omit=dev --no-audit --no-fund)

echo "== 4/6 Variables de entorno"
if [ ! -f /etc/insurance-global.env ]; then
  cp /opt/insurance-global/deploy/vm/insurance-global.env.example /etc/insurance-global.env
  echo ">> Edita /etc/insurance-global.env y pon la contraseña del buzón (sudo nano /etc/insurance-global.env)"
fi
chown root:root /etc/insurance-global.env && chmod 600 /etc/insurance-global.env

echo "== 5/6 Servicio de la API"
cp /opt/insurance-global/deploy/vm/insurance-global-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now insurance-global-api
sleep 1; systemctl --no-pager status insurance-global-api | head -5

echo "== 6/6 Nginx"
cp /opt/insurance-global/deploy/vm/nginx-insurance-global.conf /etc/nginx/sites-available/insurance-global
ln -sf /etc/nginx/sites-available/insurance-global /etc/nginx/sites-enabled/insurance-global
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo
echo "Listo en HTTP. Siguientes pasos:"
echo "  1) En GoDaddy: registro A 'seguros' -> IP pública de esta VM (y borrar el CNAME)."
echo "  2) Cuando el DNS apunte aquí: sudo certbot --nginx -d $DOMINIO --redirect -m TU_CORREO --agree-tos"
echo "  3) Probar: curl -s https://$DOMINIO/api/v1/health"
