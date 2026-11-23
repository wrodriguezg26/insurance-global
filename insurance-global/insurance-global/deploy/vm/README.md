# Publicar Insurance Global en una VM de Azure (VM "pivote")

El sitio funciona igual que en Static Web Apps. Lo único que cambia es dónde se publica:

- **Nginx** entrega `index.html` y maneja HTTPS (certificado gratuito de Let's Encrypt).
- **Node.js** (`server.js`) atiende `/api/v1/*` con el mismo código de la API de Azure (login + Azure SQL). Requiere `npm install --omit=dev` en `api` (lo hacen `setup.sh` y `update.sh`) y las variables `SQL_CONNECTION_STRING` y `AUTH_SECRET` en `/etc/insurance-global.env`. Agrega la IP pública de la VM al firewall del servidor SQL.
- Los datos siguen guardándose en el navegador de cada usuario. No hay base de datos.

```
Internet ──443──▶ Nginx ──▶ /var/www/insurance-global/index.html
                    └── /api/* ──▶ 127.0.0.1:3000 (server.js) ──▶ SMTP GoDaddy :465
```

## 1. Preparar la VM en el portal de Azure

1. **IP pública estática.** Ve a la VM → Redes → la IP pública → Configuración → Asignación **Estática** → Guardar.
2. **Reglas de entrada** en el grupo de seguridad de red:

   | Puerto | Origen | Para qué |
   |---|---|---|
   | 22 | **Solo tu IP** | SSH |
   | 80 | Cualquiera | HTTP y validación de Let's Encrypt |
   | 443 | Cualquiera | HTTPS |

   Cierra cualquier otro puerto que quedara abierto de las migraciones.
3. **Limpieza.** La VM pivote se usó para migrar a OCI. Borra de la VM las llaves y archivos de configuración de OCI y Azure que ya no uses (por ejemplo `~/.oci`, `~/.azure` y los archivos `.pem`).

## 2. Instalar (Ubuntu 22.04 o 24.04)

```bash
ssh usuario@IP_DE_LA_VM
git clone https://github.com/wrodriguezg26/insurance-global.git /tmp/ig
sudo bash /tmp/ig/deploy/vm/setup.sh
sudo nano /etc/insurance-global.env        # poner la contraseña del buzón en SMTP_PASS
sudo systemctl restart insurance-global-api
```

Para comprobarlo antes de cambiar el DNS:

- En tu navegador, `http://IP_DE_LA_VM` debe mostrar el sitio.
- En la VM, `curl -s http://127.0.0.1/api/v1/health` debe responder `{"ok":true,"store":"sql"}`.

## 3. Cambiar el DNS en GoDaddy

1. **Borra** el CNAME `seguros` que apunta a `azurestaticapps.net`. Un nombre no puede tener CNAME y registro A a la vez.
2. **Agrega** un registro A: nombre `seguros`, valor la IP pública de la VM, TTL 1/2 hora.
3. En Azure Static Web Apps → Dominios personalizados, quita `seguros.t-shits.co`. También puedes borrar la Static Web App si ya no la usarás.

## 4. HTTPS

Cuando `http://seguros.t-shits.co` ya abra el sitio desde la VM (puede tardar unos minutos), ejecuta:

```bash
sudo certbot --nginx -d seguros.t-shits.co --redirect -m administrador@t-shits.co --agree-tos -n
```

Certbot agrega el puerto 443, redirige HTTP a HTTPS y renueva el certificado solo.

## 5. Publicar cambios

Sube los cambios a GitHub y luego ejecuta en la VM:

```bash
sudo bash /opt/insurance-global/deploy/vm/update.sh
```

## Archivos

| Archivo | En la VM |
|---|---|
| `server.js` | `/opt/insurance-global/deploy/vm/server.js` (servicio `insurance-global-api`) |
| `insurance-global-api.service` | `/etc/systemd/system/` (usuario sin privilegios `insurance`, sistema de archivos protegido) |
| `nginx-insurance-global.conf` | `/etc/nginx/sites-available/insurance-global` |
| `insurance-global.env.example` | Copiar a `/etc/insurance-global.env` (permisos 600). **Nunca a GitHub** |
| `setup.sh` / `update.sh` | Instalación y actualización |

## Comandos útiles

```bash
sudo systemctl status insurance-global-api      # estado de la API
sudo journalctl -u insurance-global-api -n 50   # registros de la API (envíos y errores)
sudo nginx -t && sudo systemctl reload nginx    # validar y recargar Nginx
sudo certbot renew --dry-run                     # probar la renovación del certificado
```

## Seguridad: qué cambia frente a Static Web Apps

Ahora la seguridad del servidor queda a tu cargo:

- Instala las actualizaciones de Ubuntu: `sudo apt update && sudo apt upgrade` o `unattended-upgrades`.
- Deja SSH solo con llave y solo desde tu IP.
- No subas `/etc/insurance-global.env` a GitHub.
- Nginx bloquea los archivos ocultos (`.git`, `.env`) y envía la IP real a la API para el límite de 8 envíos cada 10 minutos.
