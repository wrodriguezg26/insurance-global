"use strict";
/*
 * Insurance Global · servidor de la API para una VM (sin dependencias externas).
 * Nginx entrega index.html y reenvía /api/* a este proceso en 127.0.0.1:3000.
 * Reutiliza la misma API /api/v1 que usa Azure Static Web Apps (login + Azure SQL).
 * Requiere "npm install --omit=dev" en la carpeta api (paquete mssql).
 * Variables de entorno: las mismas de Azure (SQL_CONNECTION_STRING, AUTH_SECRET, SETUP_KEY,
 * SMTP_USER, SMTP_PASS, SMTP_HOST, SMTP_PORT, SITE_URL, MAIL_FROM_NAME, MAIL_BCC, MAIL_DRYRUN) + PORT.
 */
const http = require("http");
const path = require("path");
const apiV1 = require(path.join(__dirname, "..", "..", "api", "v1", "index.js"));

const PORT = Number(process.env.PORT || 3000);
const HOST = "127.0.0.1";            // solo local: el público entra por Nginx
const MAX_BODY = 1024 * 1024;        // 1 MB (PDF de hasta ~500 KB en base64)

function log(...a) { console.log(new Date().toISOString(), ...a); }
function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const [url, qs] = (req.url || "").split("?");
  if (!url.startsWith("/api/v1/")) return send(res, 404, { ok: false, error: "No encontrado" });
  if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { ok: false, error: "Método no permitido" });

  let size = 0, chunks = [];
  req.on("data", c => {
    size += c.length;
    if (size > MAX_BODY) { send(res, 413, { ok: false, error: "Solicitud demasiado grande" }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", async () => {
    if (res.writableEnded) return;
    let body = {};
    if (req.method === "POST") {
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
      catch (e) { return send(res, 400, { ok: false, error: "JSON no válido" }); }
    }
    const context = { log: Object.assign((...a) => log(...a), { error: (...a) => log("ERROR", ...a) }), res: null };
    try {
      const query = Object.fromEntries(new URLSearchParams(qs || ""));
      const headers = { ...req.headers, "x-forwarded-for": req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress };
      await apiV1(context, { method: req.method, headers, query, params: { path: url.slice(8) }, body });
      const r = context.res || { status: 500, headers: {}, body: "{\"ok\":false}" };
      res.writeHead(r.status || 200, r.headers || { "Content-Type": "application/json" });
      res.end(r.body);
    } catch (e) {
      log("ERROR", e.message);
      send(res, 500, { ok: false, error: "Error interno" });
    }
  });
});

server.listen(PORT, HOST, () => log(`API de Insurance Global escuchando en http://${HOST}:${PORT}`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
