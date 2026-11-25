"use strict";
/*
 * Insurance Global · API /api/v1/* (Azure Functions administradas por Static Web Apps).
 * Un solo punto de entrada con enrutador interno. La sesión viaja en una cookie HttpOnly.
 * Variables obligatorias: SQL_CONNECTION_STRING (o SQL_SERVER/SQL_DATABASE/SQL_USER/SQL_PASSWORD), AUTH_SECRET.
 * Opcionales: SETUP_KEY (crear el primer administrador), AUDIT_SECRET, SMTP_*, MAIL_*, SITE_URL.
 */
const S = require("../shared/service");
const store = require("../shared/store");

const routes = [
  ["GET", /^health$/, async ctx => { await ctx.store.ping(); return { ok: true, store: ctx.store.kind }; }],
  ["POST", /^setup$/, (ctx, b) => S.setup(ctx, b)],
  ["GET", /^auth\/me$/, async ctx => ({ user: ctx.user ? S.publicUser(ctx.user) : null })],
  ["POST", /^auth\/register$/, (ctx, b) => S.register(ctx, b)],
  ["POST", /^auth\/login$/, (ctx, b) => S.login(ctx, b)],
  ["POST", /^auth\/logout$/, ctx => S.logout(ctx)],
  ["POST", /^auth\/password$/, (ctx, b) => S.changePassword(ctx, b)],
  ["POST", /^auth\/forgot$/, (ctx, b) => S.forgotPassword(ctx, b)],
  ["POST", /^auth\/reset$/, (ctx, b) => S.resetPassword(ctx, b)],
  ["GET", /^public\/verify$/, (ctx, b, q) => S.publicVerify(ctx, q)],
  ["POST", /^pqr$/, (ctx, b) => S.createPqr(ctx, b)],
  ["GET", /^my\/policies$/, ctx => S.myPolicies(ctx)],
  ["POST", /^tx\/web$/, (ctx, b) => S.createWebTx(ctx, b)],
  ["GET", /^tx\/(TX-\d{6})$/, (ctx, b, q, m) => S.getTx(ctx, m[1])],
  ["POST", /^tx\/(TX-\d{6})\/close$/, (ctx, b, q, m) => S.closeOfficeTx(ctx, m[1], b)],
  ["GET", /^policy\/(IG-[A-Z]{3}-\d{4}-\d{6})$/i, (ctx, b, q, m) => S.getPolicy(ctx, m[1])],
  ["POST", /^policy\/(IG-[A-Z]{3}-\d{4}-\d{6})\/revoke$/i, (ctx, b, q, m) => S.revoke(ctx, m[1])],
  ["POST", /^benefits\/activate$/, (ctx, b) => S.activateBenefit(ctx, b)],
  ["POST", /^claims$/, (ctx, b) => S.createClaim(ctx, b)],
  ["POST", /^mail\/policy$/, (ctx, b) => S.mailPolicy(ctx, b)],
  ["POST", /^mail\/benefit$/, (ctx, b) => S.mailBenefit(ctx, b)],
  ["POST", /^office\/tx$/, (ctx, b) => S.createOfficeTx(ctx, b)],
  ["GET", /^office\/tx$/, ctx => S.officeList(ctx)],
  ["GET", /^admin\/summary$/, ctx => S.summary(ctx)],
  ["GET", /^admin\/tx$/, ctx => S.adminTxList(ctx)],
  ["GET", /^admin\/tx\/(TX-\d{6})$/, (ctx, b, q, m) => S.adminTx(ctx, m[1])],
  ["POST", /^admin\/tx\/(TX-\d{6})\/(approve|reject|unlock)$/, (ctx, b, q, m) => S.adminAction(ctx, m[1], m[2], b)],
  ["GET", /^admin\/(claims|pqr|benefits|mail|audit)$/, (ctx, b, q, m) => S.adminList(ctx, m[1])],
  ["POST", /^admin\/audit\/verify$/, ctx => S.verifyAudit(ctx)],
  ["GET", /^admin\/users$/, ctx => S.users(ctx)],
  ["POST", /^admin\/users$/, (ctx, b) => S.createStaff(ctx, b)],
  ["POST", /^admin\/users\/(\d+)$/, (ctx, b, q, m) => S.updateStaff(ctx, Number(m[1]), b)],
  ["POST", /^admin\/seed$/, ctx => S.seedDemo(ctx)]
];

function reply(context, status, body, cookie) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (cookie) headers["Set-Cookie"] = cookie;
  context.res = { status, headers, body: JSON.stringify(body) };
}

module.exports = async function (context, req) {
  const method = String(req.method || "GET").toUpperCase();
  const path = String((req.params && req.params.path) || "").replace(/^\/+|\/+$/g, "");
  const ip = String(req.headers["x-forwarded-for"] || req.headers["x-client-ip"] || "anon").split(",")[0].trim().replace(/:\d+$/, "");
  const ctx = { store, ip, user: null, setCookie: null };
  try {
    if (method === "POST") {
      // Protección CSRF: solo nuestro sitio envía este encabezado (además la cookie es SameSite=Strict).
      if (req.headers["x-ig"] !== "1") return reply(context, 403, { ok: false, error: "Solicitud no permitida." });
    }
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch (e) { return reply(context, 400, { ok: false, error: "JSON no válido." }); } }
    if (Buffer.isBuffer(body)) { try { body = JSON.parse(body.toString("utf8") || "{}"); } catch (e) { return reply(context, 400, { ok: false, error: "JSON no válido." }); } }
    body = body && typeof body === "object" ? body : {};
    const route = routes.find(r => r[0] === method && r[1].test(path));
    if (!route) return reply(context, 404, { ok: false, error: "No encontrado." });
    ctx.user = await S.currentUser(ctx, req);
    const out = await route[2](ctx, body, req.query || {}, path.match(route[1]));
    return reply(context, 200, { ok: true, ...out }, ctx.setCookie);
  } catch (e) {
    const sqlDown = /ETIMEOUT|ESOCKET|ECONNCLOSED|Failed to connect|40613|not currently available|Login failed/i.test(String(e && (e.code || "") + " " + e.message));
    if (!e.public) (context.log.error || context.log)("API error " + method + " " + path + ": " + (e && e.stack || e));
    if (sqlDown && !e.public) return reply(context, 503, { ok: false, error: "La base de datos se está activando o no está disponible. Intenta de nuevo en un minuto.", code: "db" });
    return reply(context, e.status || 500, { ok: false, error: e.public || "Error interno del servidor.", code: e.code }, ctx.setCookie);
  }
};
