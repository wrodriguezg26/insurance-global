# Insurance Global: simulador de aseguradora en Azure Static Web Apps

Sitio académico de una compañía de seguros **ficticia**. Vende seguros de autos, hogar, vida, salud, viajes, mascotas y empresas por dos canales: la web y las oficinas. Todas las ventas cierran en un mismo **servidor central** ubicado en la sede principal.

El sitio tiene dos partes:

- **Frontend** estático (`index.html`) publicado en Azure Static Web Apps.
- **Servidor central**: una API propia en Azure Functions (`/api/v1/*`) conectada a **Azure SQL Database** (oferta gratuita). Allí se guardan usuarios, transacciones, pólizas, beneficios, siniestros, PQR, correos y la auditoría. El navegador ya no guarda datos del negocio.

El acceso requiere **usuario y contraseña** guardados en SQL, con tres roles:

| Rol | Cómo se crea | Qué puede hacer |
|---|---|---|
| **Administrador** | El primero, con `#/instalar` y la clave `SETUP_KEY`; los demás, desde la consola | Consola del servidor central (`#/central`): transacciones, revisiones, desbloqueos, siniestros, PQR, beneficios, correos, auditoría y usuarios |
| **Asesor** | El administrador lo crea con una contraseña temporal | Portal de asesores (`#/oficina`) solo de su oficina: registrar ventas y dar el aprobado |
| **Cliente** | Se registra solo en `#/registro` | Comprar en línea, ver sus pólizas, revocar, activar beneficios y reportar siniestros |

La verificación pública de pólizas, el certificado público enmascarado y las PQR siguen abiertos sin iniciar sesión.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | El sitio completo: tienda, portal de asesores, consola del servidor central, verificación, siniestros, PQR, canales y documentos legales |
| `staticwebapp.config.json` | Configuración de Azure: rutas, CSP, HSTS y demás encabezados de seguridad |
| `api/v1/` | La API del servidor central (una función con enrutador interno) |
| `api/shared/` | Lógica de negocio (`service.js`), sesiones y contraseñas (`auth.js`), catálogo y tarifas (`catalog.js`), correo (`mail.js`) y acceso a datos (`store-sql.js`) |
| `db/schema.sql` | Crea las tablas en Azure SQL (se ejecuta una vez en el editor de consultas) |

## Flujo de negocio

### Venta web
1. El cliente cotiza y elige un plan (Esencial, Plus o Total).
2. Llena sus datos, acepta las condiciones de forma expresa y paga con PSE o tarjeta.
3. El servidor central ejecuta 5 pasos:
   - recepción;
   - identidad y SARLAFT;
   - suscripción y tarifa;
   - autorización del pago;
   - emisión.
4. Si todo está bien, emite la póliza (`IG-AUT-2026-000001`) y un **número de aprobación** (`APR-AAAAMMDD-NNNNNN`).

### Venta en oficina
1. El asesor entra al **Portal de asesores**, registra la venta y el pago en oficina (efectivo, datáfono o enlace PSE).
2. El asesor envía la venta al servidor central, que hace las mismas validaciones y devuelve el número de aprobación.
3. El asesor **da el aprobado**: escribe el número de aprobación y el valor cobrado. Si los dos coinciden, el servidor central emite la póliza.
4. Si el asesor se equivoca 3 veces, la venta se **bloquea**. Solo el servidor central puede desbloquearla, y al hacerlo emite un número nuevo.

### Certificado en PDF, enlace y correo
- **PDF:** el certificado se genera en el navegador del dueño de la póliza (o del asesor) con los datos que entrega la API.
- **Enlace público** `https://seguros.t-shits.co/#/certificado/<póliza>/<aprobación>`: al abrirlo, el servidor central confirma en línea que la póliza y el número de aprobación existen y muestra el certificado con los datos personales enmascarados. No se puede falsificar.
- **Correo:** el navegador envía el PDF a `/api/v1/mail/policy`; el servidor lo manda por SMTP **solo al correo registrado del tomador** (el destinatario sale de la base de datos). Cada envío queda en la tabla `ig_outbox` y en *Servidor central → Correos*.
- Los correos `@ejemplo.com` se simulan. Con `MAIL_DRYRUN=1` ningún correo sale de verdad.

### Servidor central
Todas las reglas se aplican en la API, no en el navegador: precio recalculado en el servidor, números de aprobación aleatorios con `crypto`, consecutivos en SQL, 3 intentos de aprobado y bloqueo, revisión SARLAFT y de suscripción. La auditoría (`ig_audit`) es una cadena de huellas HMAC-SHA256 con clave secreta: si alguien altera un registro en la base de datos, el botón **Verificar integridad** lo detecta.

## Cómo responde a los deseos de la junta directiva

| Deseo | Qué tiene el sitio |
|---|---|
| **Confianza de los usuarios** | Verificación pública de pólizas (número de póliza + número de aprobación). Doble confirmación del asesor en oficina. Datos enmascarados en las consolas. No se guarda el número completo de la tarjeta. Aceptaciones expresas. Política de datos (Ley 1581) y derechos del consumidor financiero (Ley 1328). |
| **Reputación** | Historial con huella de integridad. Revocación en línea con devolución automática (art. 1071 C. de Co.). PQR con radicado y fecha máxima de respuesta. Defensor del Consumidor Financiero. Consejos contra fraude. Siniestros con radicado y plazo de pago (art. 1080). |
| **Creación de canales** | Web 24/7, 5 oficinas, línea telefónica, WhatsApp, asistente virtual, red de aliados y una API para aliados en diseño. Todos llegan al mismo servidor central. La consola mide las ventas por canal. |

## Datos de prueba

| Caso | Cómo provocarlo |
|---|---|
| Revisión SARLAFT | Documento que termine en `0000` |
| Suscripción manual | Vida con suma > $800 M o edad > 65; autos > $300 M; hogar > $2.000 M; empresas > $3.000 M |
| Pago rechazado | Tarjeta `4000 0000 0000 0002` |
| Pago aprobado | Tarjeta `4111 1111 1111 1111`, cualquier fecha futura y CVV de 3 dígitos |
| Datos de ejemplo | En `#/central` (como administrador), botón **Generar ejemplos** |

## Publicar en Azure (Static Web Apps + Azure SQL Database gratis)

### 1. Crear la base de datos gratuita
1. En el portal de Azure: **Crear un recurso → Azure SQL → SQL Database**.
2. Busca el aviso **"¿Quiere probar Azure SQL Database gratis?" → Aplicar oferta**. Te da 100.000 segundos de vCore y 32 GB al mes.
3. Datos: base `insurance-global`; servidor nuevo (por ejemplo `ig-sql-<tus iniciales>`) en una región cercana; **Autenticación de SQL** con un usuario administrador y una contraseña fuerte (guárdala tú, no la compartas).
4. En *Comportamiento cuando se alcanza el límite gratuito*, elige **Pausar automáticamente la base de datos hasta el próximo mes** (así nunca cobra).
5. **Redes:** conectividad *Punto de conexión público*, y activa **Permitir que los servicios y recursos de Azure accedan a este servidor**. Agrega también tu IP actual para usar el editor de consultas.
6. Crear.

### 2. Crear las tablas
1. Abre la base de datos → **Editor de consultas (versión preliminar)** e inicia sesión con el usuario SQL.
2. Pega el contenido de `db/schema.sql` y ejecuta. Al final lista las 9 tablas `ig_*`.
3. Recomendado: crea un usuario solo para la app (bloque comentado al final del script) con permisos de lectura y escritura.

### 3. Variables de entorno de la Static Web App
En la Static Web App → **Configuración → Variables de entorno → Producción**, agrega (además de las de correo que ya tienes):

| Nombre | Valor |
|---|---|
| `SQL_CONNECTION_STRING` | La cadena ADO.NET de la base (base de datos → *Cadenas de conexión*), con la contraseña puesta. Ej.: `Server=tcp:ig-sql-xx.database.windows.net,1433;Initial Catalog=insurance-global;User ID=ig_app;Password=...;Encrypt=True;Connection Timeout=60;` |
| `AUTH_SECRET` | Una cadena aleatoria de 32+ caracteres (firma las sesiones y la auditoría). No la cambies después: cerraría todas las sesiones y la verificación de la auditoría fallaría. |
| `SETUP_KEY` | Una clave temporal de 16+ caracteres para crear el primer administrador. Bórrala después. |

Para generar valores aleatorios en PowerShell: `[Convert]::ToBase64String((1..36|%{Get-Random -Max 256}))`.

### 4. Publicar
Sube los cambios a GitHub (`git add -A`, `git commit`, `git push`). El flujo de GitHub Actions instala la dependencia `mssql` de `api/package.json` y publica. Con `swa deploy` manual, ejecuta antes `npm install --omit=dev` dentro de `api`.

### 5. Crear el primer administrador
1. Abre `https://seguros.t-shits.co/api/v1/health`. Debe responder `{"ok":true,"store":"sql"}` (la primera vez puede tardar ~1 minuto mientras la base despierta).
2. Abre `https://seguros.t-shits.co/#/instalar`, escribe la `SETUP_KEY`, tu nombre, correo y contraseña.
3. Borra la variable `SETUP_KEY` en Azure.
4. Ingresa en `#/ingresar`, ve a *Servidor central → Usuarios* y crea los asesores.

### Notas
- La base gratuita se **pausa** cuando no se usa. La primera petición después de una pausa tarda hasta un minuto; el sitio muestra "Activando la base de datos…" y reintenta solo.
- Si la suscripción es de prueba (30 días), al terminar hay que pasarla a *pago por uso* para conservar la oferta gratuita.

## API `/api/v1`

| Ruta | Quién |
|---|---|
| `auth/register`, `auth/login`, `auth/logout`, `auth/me`, `auth/password`, `setup` | Público / sesión |
| `public/verify`, `pqr` | Público |
| `tx/web`, `my/policies`, `policy/:no`, `policy/:no/revoke`, `benefits/activate`, `claims`, `mail/*` | Cliente dueño |
| `office/tx`, `tx/:id/close` | Asesor (su oficina) o administrador |
| `admin/*` | Administrador |

Seguridad: contraseñas con scrypt; sesión firmada (HMAC-SHA256) en cookie `HttpOnly; Secure; SameSite=Strict` de 8 horas; bloqueo 15 minutos tras 5 intentos; encabezado `X-IG` obligatorio en POST (anti-CSRF); control de acceso por rol y por dueño en cada consulta (sin IDOR); consultas parametrizadas (sin inyección SQL); límites por IP; CSP y HSTS.

## Beneficios por seguro

Cada seguro incluye beneficios sin costo mientras la póliza esté vigente: cursos online con certificación, coworking, asesoría legal y otros según el producto (página `#/beneficios`). Se activan desde el certificado de la póliza: los de tipo código se activan al instante, el coworking se reserva por ciudad, fecha y jornada, y las asesorías se radican con un número. Todo queda registrado en *Servidor central → Beneficios* y en el historial de la póliza, y el cliente recibe un correo de confirmación con el comprobante en PDF adjunto (también descargable desde el certificado) (función `/api/v1/mail/benefit`; la copia `MAIL_BCC` le llega a la compañía para atender las solicitudes).

## Imágenes para correos

La carpeta `img/beneficios/` tiene los íconos PNG de cada beneficio que usan las campañas de correo (phpList). Se sirven en `https://seguros.t-shits.co/img/beneficios/<beneficio>.png`.

## Repositorio en GitHub y publicación automática

El repositorio trae el flujo `.github/workflows/azure-static-web-apps.yml`. Cada vez que se sube un cambio a la rama `main`, GitHub publica el sitio y la función en Azure.

1. En GitHub, ve al repositorio y abre **Settings → Secrets and variables → Actions → New repository secret**.
2. Crea el secreto:
   - **Name:** `AZURE_STATIC_WEB_APPS_API_TOKEN`
   - **Value:** el token de implementación de la Static Web App, que está en Azure en *Información general → Administrar token de implementación*.
3. Ve a la pestaña **Actions**, abre "Publicar en Azure Static Web Apps" y haz clic en **Run workflow**. Debe terminar con un visto verde.

Ni el token ni la contraseña del correo se guardan en el código. El token va en los *Secrets* de GitHub y la contraseña en las *Variables de entorno* de Azure.

## Alternativa: publicar en una VM de Azure

La carpeta `deploy/vm` trae todo para servir el mismo sitio desde una VM Ubuntu con Nginx, Node.js y Let's Encrypt. Ver `deploy/vm/README.md`.

## Configurar el correo con tu buzón de GoDaddy

La contraseña del buzón **nunca** va en el código. Se guarda como variable de entorno en Azure:

1. En el portal de Azure, abre tu Static Web App y entra a **Configuración → Variables de entorno**. En versiones anteriores se llama **Configuración → Configuración de la aplicación**.
2. En **Producción** agrega:

| Nombre | Valor |
|---|---|
| `SMTP_USER` | el buzón completo, p. ej. `polizas@t-shits.co` |
| `SMTP_PASS` | la contraseña del buzón |
| `SMTP_HOST` | `smtpout.secureserver.net` (Professional Email de GoDaddy) |
| `SMTP_PORT` | `465` |
| `SITE_URL` | `https://seguros.t-shits.co` |
| `MAIL_FROM_NAME` | `Insurance Global` (opcional) |
| `MAIL_BCC` | un correo para guardar copia de cada envío (opcional) |

3. Guarda los cambios. La función los lee en el siguiente envío.
4. Para comprobarlo, compra una póliza con un correo real y revisa *Servidor central → Correos*.

**Si tu buzón es "Microsoft 365 de GoDaddy"** (no Professional Email), usa:
- `SMTP_HOST=smtp.office365.com` y `SMTP_PORT=587`;
- activa **SMTP autenticado** para ese buzón en el centro de administración de Microsoft 365.

Microsoft desactivará por defecto la autenticación básica de SMTP a finales de diciembre de 2026, y desde entonces habrá que reactivarla. Para un uso real a largo plazo conviene un servicio de envío (Azure Communication Services, SendGrid…).

Protecciones del envío:
- exige sesión y que la póliza sea del usuario (o de su oficina);
- el destinatario es siempre el correo registrado del tomador;
- arma el asunto y el texto del correo en el servidor;
- solo acepta un PDF real de hasta 500 KB;
- limita a 15 envíos por usuario cada 10 minutos.

### Dominio propio (opcional)
En Azure ve a **Custom domains → Add** y crea un **CNAME** `www` hacia `xxxx.azurestaticapps.net` en tu proveedor de DNS.

Para el dominio sin `www` tienes dos opciones:
- usar el reenvío 301 de tu registrador hacia `www`;
- mover el DNS a Azure DNS.

Dominio configurado: `seguros.t-shits.co` (CNAME en GoDaddy hacia la URL de Azure). El correo de contacto y de envío de pólizas es `seguros@t-shits.co`.

## Qué haría falta en una aseguradora real
Este simulador **no debe usarse para vender seguros reales**. Una operación real necesitaría:
- autorización y vigilancia de la Superintendencia Financiera, con el logo "Vigilado";
- un servidor central redundante, con monitoreo y respaldo de la base de datos;
- doble factor (OTP) también para clientes;
- pasarela de pagos certificada PCI DSS;
- consulta real de listas SARLAFT;
- firma electrónica con OTP;
- doble factor para asesores;
- clausulados depositados.
