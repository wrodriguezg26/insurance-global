#!/usr/bin/env bash
# Publicar la última versión del repositorio. Ejecutar con: sudo bash /opt/insurance-global/deploy/vm/update.sh
set -euo pipefail
if [ -d /opt/insurance-global/.git ]; then git -C /opt/insurance-global pull --ff-only; else echo "Sin Git: copia los archivos nuevos a /opt/insurance-global antes de ejecutar esto"; fi
cp /opt/insurance-global/index.html /var/www/insurance-global/index.html
(cd /opt/insurance-global/api && npm install --omit=dev --no-audit --no-fund)
systemctl restart insurance-global-api
nginx -t && systemctl reload nginx
echo "Actualizado."
