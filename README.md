# Insurance Global: simulador de aseguradora en Azure Static Web Apps

Sitio académico de una compañía de seguros **ficticia**. Vende seguros de autos, hogar, vida, salud, viajes, mascotas y empresas por dos canales: la web y las oficinas. Todas las ventas cierran en un mismo **servidor central** ubicado en la sede principal.

El sitio es estático (HTML, CSS y JavaScript en un solo `index.html`). El servidor central se simula en el navegador y los datos se guardan en `localStorage`.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | El sitio completo: tienda, portal de asesores, consola del servidor central, verificación, siniestros, PQR, canales y documentos legales |
| `staticwebapp.config.json` | Configuración de Azure: todas las rutas van a `index.html`, más encabezados de seguridad |

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
Cuando el servidor central emite una póliza (por la web, en oficina o al aprobar una revisión):
- **PDF:** el certificado `Poliza-IG-XXX-AAAA-NNNNNN.pdf` se genera en el navegador. Trae los datos de la póliza, las coberturas, el sello de aprobación, la huella, un código QR y un enlace.
- **Enlace permanente** (`https://seguros.t-shits.co/#/c/...`): se abre en cualquier dispositivo y tiene un sello que detecta si alguien lo modifica.
- **Correo automático:** el sitio llama a la función de Azure `/api/send-policy`, que envía el correo con el PDF adjunto y el enlace por **SMTP**, usando el buzón de GoDaddy. El estado de cada envío se ve en *Servidor central → Correos* (Enviado, Simulado, Error o Reintentar).
- Los correos de prueba (`@ejemplo.com`) y los datos de ejemplo **no** se envían de verdad.

### Servidor central
La consola (`#/central`) muestra todas las transacciones de ambos canales. Desde ahí se:
- aprueban o rechazan las revisiones manuales;
- desbloquean ventas;
- ven siniestros y PQR;
- verifica el historial encadenado. Cada registro lleva una huella que depende del anterior, así que una alteración se detecta. Incluye un botón para simular la alteración y demostrarlo.

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
| Datos de ejemplo | En `#/central`, botón **Generar transacciones de ejemplo** |

## Publicar en Azure Static Web Apps (plan Free)

La carpeta trae el sitio (`index.html`) y la función de correo (`api/`). El plan Free incluye las funciones administradas.

1. Copia la carpeta `insurance-global` a `C:\deploy` (fuera de OneDrive).
2. En una terminal, desde `C:\deploy`, ejecuta:
   ```
   swa deploy insurance-global --api-location insurance-global/api --api-language node --api-version 20 --deployment-token "TU_TOKEN" --env production
   ```
   No ejecutes el comando desde dentro de la carpeta `insurance-global`.

## Beneficios por seguro

Cada seguro incluye beneficios sin costo mientras la póliza esté vigente: cursos online con certificación, coworking, asesoría legal y otros según el producto (página `#/beneficios`). Se activan desde el certificado de la póliza: los de tipo código se activan al instante, el coworking se reserva por ciudad, fecha y jornada, y las asesorías se radican con un número. Todo queda registrado en *Servidor central → Beneficios* y en el historial de la póliza, y el cliente recibe un correo de confirmación (función `/api/send-policy` con `type: "benefit"`; la copia `MAIL_BCC` le llega a la compañía para atender las solicitudes).

## Repositorio en GitHub y publicación automática

El repositorio trae el flujo `.github/workflows/azure-static-web-apps.yml`. Cada vez que se sube un cambio a la rama `main`, GitHub publica el sitio y la función en Azure.

1. En GitHub, ve al repositorio y abre **Settings → Secrets and variables → Actions → New repository secret**.
2. Crea el secreto:
   - **Name:** `AZURE_STATIC_WEB_APPS_API_TOKEN`
   - **Value:** el token de implementación de la Static Web App, que está en Azure en *Información general → Administrar token de implementación*.
3. Ve a la pestaña **Actions**, abre "Publicar en Azure Static Web Apps" y haz clic en **Run workflow**. Debe terminar con un visto verde.

Ni el token ni la contraseña del correo se guardan en el código. El token va en los *Secrets* de GitHub y la contraseña en las *Variables de entorno* de Azure.

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
4. Para comprobarlo, abre `https://seguros.t-shits.co/api/send-policy`. Debe responder `{"ok":true,"configured":true}`.

**Si tu buzón es "Microsoft 365 de GoDaddy"** (no Professional Email), usa:
- `SMTP_HOST=smtp.office365.com` y `SMTP_PORT=587`;
- activa **SMTP autenticado** para ese buzón en el centro de administración de Microsoft 365.

Microsoft desactivará por defecto la autenticación básica de SMTP a finales de diciembre de 2026, y desde entonces habrá que reactivarla. Para un uso real a largo plazo conviene un servicio de envío (Azure Communication Services, SendGrid…).

Protecciones de la función:
- solo envía certificados con un sello válido;
- arma el asunto y el texto del correo en el servidor;
- solo acepta un PDF real de hasta 500 KB;
- limita a 8 envíos por IP cada 10 minutos.

### Dominio propio (opcional)
En Azure ve a **Custom domains → Add** y crea un **CNAME** `www` hacia `xxxx.azurestaticapps.net` en tu proveedor de DNS.

Para el dominio sin `www` tienes dos opciones:
- usar el reenvío 301 de tu registrador hacia `www`;
- mover el DNS a Azure DNS.

Dominio configurado: `seguros.t-shits.co` (CNAME en GoDaddy hacia la URL de Azure). El correo de contacto y de envío de pólizas es `seguros@t-shits.co`.

## Qué haría falta en una aseguradora real
Este simulador **no debe usarse para vender seguros reales**. Una operación real necesitaría:
- autorización y vigilancia de la Superintendencia Financiera, con el logo "Vigilado";
- un servidor central real con API autenticada y base de datos;
- pasarela de pagos certificada PCI DSS;
- consulta real de listas SARLAFT;
- firma electrónica con OTP;
- doble factor para asesores;
- clausulados depositados.
