"use strict";
/* Autenticación: contraseñas con scrypt y sesión en cookie HttpOnly firmada con HMAC-SHA256. */
const crypto = require("crypto");

const COOKIE = "ig_session";
const SESSION_HOURS = 8;

function secret() {
  const s = process.env.AUTH_SECRET || "";
  if (s.length < 32) throw Object.assign(new Error("AUTH_SECRET no configurado (mínimo 32 caracteres)"), { status: 503, public: "El servicio de autenticación no está configurado." });
  return s;
}

/* ---------- Contraseñas ---------- */
function hashPassword(pwd) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pwd), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString("base64")}$${key.toString("base64")}`;
}
function verifyPassword(pwd, stored) {
  try {
    const [alg, n, saltB64, keyB64] = String(stored).split("$");
    if (alg !== "scrypt") return false;
    const key = Buffer.from(keyB64, "base64");
    const test = crypto.scryptSync(String(pwd), Buffer.from(saltB64, "base64"), key.length, { N: Number(n), r: 8, p: 1 });
    return crypto.timingSafeEqual(key, test);
  } catch (e) { return false; }
}
function passwordProblem(pwd) {
  const p = String(pwd || "");
  if (p.length < 10) return "La contraseña debe tener al menos 10 caracteres.";
  if (p.length > 128) return "La contraseña es demasiado larga.";
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(p) || !/\d/.test(p)) return "La contraseña debe combinar letras y números.";
  return "";
}

/* ---------- Token de sesión ---------- */
const b64u = b => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = b64u(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token || typeof token !== "string" || token.length > 2000) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const good = b64u(crypto.createHmac("sha256", secret()).update(body).digest());
  const a = Buffer.from(mac), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (!p.exp || Date.now() > p.exp) return null;
    return p;
  } catch (e) { return null; }
}
function newSession(user) {
  const now = Date.now();
  return sign({ uid: user.id, iat: now, exp: now + SESSION_HOURS * 3600e3, n: crypto.randomBytes(8).toString("hex") });
}
function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function sessionCookie(token) {
  const secure = process.env.COOKIE_INSECURE === "1" ? "" : "; Secure";
  return `${COOKIE}=${token}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}
function clearCookie() {
  const secure = process.env.COOKIE_INSECURE === "1" ? "" : "; Secure";
  return `${COOKIE}=; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=0`;
}

/* ---------- Huellas (historial e integridad) ---------- */
function hmac(data) {
  const key = process.env.AUDIT_SECRET || secret();
  return crypto.createHmac("sha256", key).update(String(data)).digest("hex");
}
function randomDigits(n) { let s = ""; for (let i = 0; i < n; i++) s += crypto.randomInt(10); return s; }

module.exports = { COOKIE, hashPassword, verifyPassword, passwordProblem, newSession, verify, parseCookies, sessionCookie, clearCookie, hmac, randomDigits };
