"use strict";
/* Lógica de negocio de Insurance Global (servidor central). Todas las reglas se aplican aquí, no en el navegador. */
const crypto = require("crypto");
const C = require("./catalog");
const A = require("./auth");
const mail = require("./mail");

/* ---------- Utilidades ---------- */
const E = (status, msg, code) => Object.assign(new Error(msg), { status, public: msg, code });
const pad = (n, l = 2) => String(n).padStart(l, "0");
const todayBog = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
const compactDate = () => todayBog().replace(/-/g, "");
const addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addYear = s => { const d = new Date(s + "T12:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); };
const addBizDays = (n) => { const d = new Date(); while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w && w < 6) n--; } return d.toISOString(); };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(Date.parse(s));
const str = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
const maskName = c => c ? `${String(c.nombres).split(" ")[0]} ${String(c.apellidos).charAt(0)}.` : "—";
const maskMail = m => m ? m.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => a + "•".repeat(Math.min(6, b.length)) + c) : "";
const fullName = c => `${c.nombres} ${c.apellidos}`.trim();
const BANKS = ["Bancolombia", "Banco de Bogotá", "Davivienda", "BBVA Colombia", "Banco de Occidente", "Banco Popular", "Scotiabank Colpatria", "Nequi", "Daviplata"];
const DOC_TYPES = ["Cédula de ciudadanía", "Cédula de extranjería", "Pasaporte"];
const ACCEPTS = ["ac_cond", "ac_decl", "ac_datos", "ac_fondos", "ac_firma"];
const STEP_NAMES = ["Recepción en el servidor central", "Identidad y listas de control (SARLAFT)", "Suscripción y tarifa", "Autorización del pago", "Emisión y número de aprobación"];
const STAFF = ["admin", "asesor"];

/* Límite simple por IP en memoria de la instancia (complementa el bloqueo por usuario en la base). */
const hits = new Map();
function limited(key, max, winMs) {
  const now = Date.now(), arr = (hits.get(key) || []).filter(t => now - t < winMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr); return false;
}

/* ---------- Auditoría ---------- */
const auditHash = (prev, r) => A.hmac([prev, r.n, r.at, r.tx, r.ev, r.by].join("|"));
async function audit(ctx, tx, ev, by) { await ctx.store.appendAudit({ tx: tx || "—", ev: str(ev, 600), by: str(by, 160) }, auditHash); }
async function logTx(ctx, t, ev, by) { await ctx.store.addLog(t.id, str(ev, 600), str(by, 160)); await audit(ctx, t.id, ev, by); }

/* ---------- Sesión ---------- */
async function currentUser(ctx, req) {
  const tok = A.parseCookies(req.headers.cookie || req.headers.Cookie)[A.COOKIE];
  const p = tok && A.verify(tok);
  if (!p) return null;
  const u = await ctx.store.getUserById(p.uid);
  return u && u.active ? u : null;
}
const publicUser = u => u && ({ id: u.id, email: u.email, name: u.name, role: u.role, office: u.office, docType: u.doc_type, doc: u.doc, phone: u.phone, firstNames: u.first_names || null, lastNames: u.last_names || null, birthDate: u.birth_date || null, mustChange: !!u.must_change });
function need(ctx, roles) {
  if (!ctx.user) throw E(401, "Debes iniciar sesión.", "login");
  if (ctx.user.must_change && !ctx.allowMustChange) throw E(403, "Debes cambiar tu contraseña antes de continuar.", "must_change");
  if (roles && !roles.includes(ctx.user.role)) throw E(403, "No tienes permiso para esta acción.", "forbidden");
  return ctx.user;
}

/* ---------- Autenticación ---------- */
async function register(ctx, b) {
  if (limited("reg:" + ctx.ip, 10, 3600e3)) throw E(429, "Demasiados registros desde esta conexión. Intenta más tarde.");
  const c = {
    tipoDoc: str(b.tipoDoc, 40), doc: str(b.doc, 20), nombres: str(b.nombres, 60), apellidos: str(b.apellidos, 60),
    nacimiento: str(b.nacimiento, 10), celular: str(b.celular, 10), email: str(b.email, 160).toLowerCase()
  };
  if (!DOC_TYPES.includes(c.tipoDoc)) throw E(400, "Elige un tipo de documento válido.");
  if (c.tipoDoc === "Pasaporte" ? !/^[A-Z0-9]{5,12}$/i.test(c.doc) : !/^\d{5,12}$/.test(c.doc)) throw E(400, "Escribe un número de documento válido.");
  if (c.nombres.length < 2 || c.apellidos.length < 2) throw E(400, "Escribe tus nombres y apellidos.");
  if (!isDate(c.nacimiento)) throw E(400, "Escribe tu fecha de nacimiento.");
  const age = (Date.now() - Date.parse(c.nacimiento)) / 31557600000; if (age < 18 || age > 100) throw E(400, "Debes ser mayor de edad.");
  if (!/^3\d{9}$/.test(c.celular)) throw E(400, "El celular debe tener 10 dígitos y empezar por 3.");
  if (!EMAIL_RE.test(c.email)) throw E(400, "Escribe un correo válido.");
  const pp = A.passwordProblem(b.password); if (pp) throw E(400, pp);
  if (!b.acepto) throw E(400, "Debes autorizar el tratamiento de datos para crear la cuenta.");
  if (await ctx.store.getUserByEmail(c.email)) throw E(409, "Ya existe una cuenta con ese correo. Inicia sesión.");
  if (await ctx.store.getUserByDoc(c.doc)) throw E(409, "Ya existe una cuenta con ese documento. Inicia sesión.");
  const consentAt = new Date().toISOString();
  const u = await ctx.store.createUser({ email: c.email, name: `${c.nombres} ${c.apellidos}`, role: "cliente", doc_type: c.tipoDoc, doc: c.doc, phone: c.celular, pwd_hash: A.hashPassword(b.password),
    first_names: c.nombres, last_names: c.apellidos, birth_date: c.nacimiento, consent_at: consentAt });
  await ctx.store.updateUser(u.id, { last_login: new Date().toISOString() });
  await audit(ctx, "—", `Cuenta de cliente creada (${maskMail(u.email)})`, "Registro web");
  await notifyRegistration(ctx, u, c, consentAt);
  ctx.setCookie = A.sessionCookie(A.newSession(u));
  return { user: publicUser(u), profile: { nombres: c.nombres, apellidos: c.apellidos, nacimiento: c.nacimiento } };
}
/* Cada registro nuevo se envía en un archivo JSON al buzón de la compañía (REGISTRO_NOTIFY_TO).
 * Si el correo falla, el registro sigue normal: el cliente ya quedó guardado en la base de datos. */
function registrationJson(u, c, consentAt) {
  const id = "CLI-" + pad(u.id, 6);
  return { id, data: {
    registro: { id, fecha: consentAt, canal: "web", formulario: "#/registro" },
    cliente: { tipoDocumento: c.tipoDoc, documento: c.doc, nombres: c.nombres, apellidos: c.apellidos, fechaNacimiento: c.nacimiento, celular: c.celular, correo: c.email },
    autorizaciones: { tratamientoDatos: true, politica: "Ley 1581 de 2012", fecha: consentAt },
    origen: mail.siteUrl()
  } };
}
/* En la VM, además, cada registro se guarda como archivo .json (REGISTRO_JSON_DIR, p. ej. /var/lib/insurance-global/registros).
 * Nunca dentro de la carpeta pública del sitio. En Azure Static Web Apps no hay disco persistente: allí no se define. */
const fs = require("fs"), pathMod = require("path");
async function saveRegistrationFile(id, data) {
  const dir = (process.env.REGISTRO_JSON_DIR || "").trim();
  if (!dir) return { status: "omitido" };
  const abs = pathMod.resolve(dir);
  if (/^\/(var\/www|srv\/www|usr\/share\/nginx)(\/|$)/.test(abs)) return { status: "error", note: "REGISTRO_JSON_DIR está dentro de la carpeta pública del sitio" };
  try {
    await fs.promises.mkdir(abs, { recursive: true, mode: 0o700 });
    const file = pathMod.join(abs, `registro-${id}.json`);
    await fs.promises.writeFile(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    return { status: "guardado", file };
  } catch (e) { return { status: "error", note: String(e.code || e.message).slice(0, 120) }; }
}
/* Copia del registro en Azure Blob Storage (contenedor privado), para descargarla desde el portal.
 * REGISTRO_BLOB_SAS_URL = URL SAS del contenedor con permisos SOLO de crear y escribir (sp=cw):
 *   https://<cuenta>.blob.core.windows.net/registros?sv=...&sp=cw&se=...&sig=...
 * Sin dependencias: PUT Blob por REST. Funciona igual en Azure Static Web Apps y en la VM. */
async function uploadRegistrationBlob(id, data) {
  const sas = (process.env.REGISTRO_BLOB_SAS_URL || "").trim();
  if (!sas) return { status: "omitido" };
  let u;
  try { u = new URL(sas); } catch (e) { return { status: "error", note: "REGISTRO_BLOB_SAS_URL no es una URL válida" }; }
  const azure = u.protocol === "https:" && /\.blob\.core\.windows\.net$/i.test(u.hostname), azurite = u.hostname === "127.0.0.1";
  if (!(azure || azurite) || !u.searchParams.get("sig")) return { status: "error", note: "REGISTRO_BLOB_SAS_URL debe ser la URL SAS de un contenedor de Azure Storage" };
  const name = `registro-${id}.json`;
  const target = `${u.origin}${u.pathname.replace(/\/+$/, "")}/${encodeURIComponent(name)}${u.search}`;
  try {
    const r = await fetch(target, { method: "PUT", body: JSON.stringify(data, null, 2) + "\n", signal: AbortSignal.timeout(15000),
      headers: { "x-ms-blob-type": "BlockBlob", "x-ms-version": "2021-08-06", "Content-Type": "application/json; charset=utf-8", "If-None-Match": "*" } });
    if (r.status === 201) return { status: "subido", name };
    const txt = (await r.text().catch(() => "")).match(/<Code>([^<]+)<\/Code>/);
    return { status: "error", note: `HTTP ${r.status}${txt ? " " + txt[1] : ""}` };
  } catch (e) { return { status: "error", note: String(e.name === "TimeoutError" ? "tiempo de espera agotado" : e.message).slice(0, 120) }; }
}
async function notifyRegistration(ctx, u, c, consentAt) {
  let to = (process.env.REGISTRO_NOTIFY_TO || process.env.MAIL_BCC || "administrador@t-shits.co").trim();
  if (!EMAIL_RE.test(to)) to = "administrador@t-shits.co"; // REGISTRO_NOTIFY_TO mal escrito (p. ej. una URL)
  const { id, data } = registrationJson(u, c, consentAt);
  const saved = await saveRegistrationFile(id, data);
  const blob = await uploadRegistrationBlob(id, data);
  if (blob.status !== "omitido") { try { await audit(ctx, "—", blob.status === "subido" ? `Registro ${id} subido a Azure Blob Storage (${blob.name})` : `No se pudo subir el registro ${id} a Azure Blob Storage: ${blob.note}`, "Registro web"); } catch (e) { } }
  if (saved.status !== "omitido") { try { await audit(ctx, "—", saved.status === "guardado" ? `Registro ${id} guardado en el servidor (${saved.file})` : `No se pudo guardar el archivo del registro ${id}: ${saved.note}`, "Registro web"); } catch (e) { } }
  let res;
  try { res = await mail.sendRegistration(to, data, `registro-${id}.json`); }
  catch (e) { res = { status: "error", note: String(e.message).slice(0, 160) }; }
  try { await audit(ctx, "—", `Datos del registro ${id} enviados en JSON a ${maskMail(to)} (correo: ${res.status})`, "Registro web"); } catch (e) { }
  return res;
}
async function login(ctx, b) {
  if (limited("login:" + ctx.ip, 20, 600e3)) throw E(429, "Demasiados intentos desde esta conexión. Espera 10 minutos.");
  const email = str(b.email, 160).toLowerCase(), pwd = String(b.password || "");
  const u = await ctx.store.getUserByEmail(email);
  const bad = E(401, "Correo o contraseña incorrectos.");
  if (!u || !u.active) { A.verifyPassword(pwd, "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86)); throw bad; }
  if (u.locked_until && Date.parse(u.locked_until) > Date.now()) throw E(423, "Cuenta bloqueada temporalmente por intentos fallidos. Intenta de nuevo en 15 minutos.");
  if (!A.verifyPassword(pwd, u.pwd_hash)) {
    const failed = (u.failed || 0) + 1;
    await ctx.store.updateUser(u.id, failed >= 5 ? { failed: 0, locked_until: new Date(Date.now() + 15 * 60e3).toISOString() } : { failed });
    if (failed >= 5) await audit(ctx, "—", `Cuenta ${maskMail(u.email)} bloqueada 15 minutos por 5 intentos fallidos`, "Seguridad");
    throw bad;
  }
  await ctx.store.updateUser(u.id, { failed: 0, locked_until: null, last_login: new Date().toISOString() });
  await audit(ctx, "—", `Inicio de sesión (${u.role}) ${maskMail(u.email)}`, u.name);
  ctx.setCookie = A.sessionCookie(A.newSession(u));
  return { user: publicUser(u) };
}
async function logout(ctx) { ctx.setCookie = A.clearCookie(); if (ctx.user) await audit(ctx, "—", `Cierre de sesión ${maskMail(ctx.user.email)}`, ctx.user.name); return {}; }
async function changePassword(ctx, b) {
  ctx.allowMustChange = true; const u = need(ctx);
  if (!A.verifyPassword(String(b.current || ""), u.pwd_hash)) throw E(400, "La contraseña actual no es correcta.");
  const pp = A.passwordProblem(b.password); if (pp) throw E(400, pp);
  if (b.password === b.current) throw E(400, "La nueva contraseña debe ser distinta a la actual.");
  await ctx.store.updateUser(u.id, { pwd_hash: A.hashPassword(b.password), must_change: false });
  await audit(ctx, "—", `Cambio de contraseña ${maskMail(u.email)}`, u.name);
  ctx.setCookie = A.sessionCookie(A.newSession(u));
  return { ok: true };
}
/* ---------- Recuperar contraseña por correo ----------
 * Enlace firmado con AUTH_SECRET que incluye un pedazo del hash actual de la contraseña:
 * vence a los 30 minutos y deja de servir apenas se cambia la contraseña (un solo uso), sin tablas nuevas. */
const RESET_MIN = 30;
const resetSig = (u, exp) => A.hmac(["reset", u.id, exp, String(u.pwd_hash).slice(-24)].join("|"));
async function forgotPassword(ctx, b) {
  const email = str(b.email, 160).toLowerCase();
  const generic = { message: "Si el correo está registrado, te enviamos un enlace para restablecer la contraseña. Revisa también la carpeta de spam." };
  if (!EMAIL_RE.test(email)) throw E(400, "Escribe un correo válido.");
  if (limited("forgot:" + ctx.ip, 5, 3600e3) || limited("forgot:" + email, 3, 3600e3)) return generic; // misma respuesta: no revela nada
  const u = await ctx.store.getUserByEmail(email);
  if (!u || !u.active) return generic;
  const exp = Date.now() + RESET_MIN * 60e3, token = `${u.id}.${exp}.${resetSig(u, exp).slice(0, 43)}`;
  const res = await mail.sendReset(u.email, u.name, `${mail.siteUrl()}/#/restablecer/${token}`, RESET_MIN);
  await audit(ctx, "—", `Solicitud de recuperación de contraseña para ${maskMail(u.email)} (correo: ${res.status})`, "Recuperación de contraseña");
  return generic;
}
async function resetPassword(ctx, b) {
  if (limited("reset:" + ctx.ip, 10, 3600e3)) throw E(429, "Demasiados intentos. Espera una hora.");
  const m = String(b.token || "").match(/^(\d{1,9})\.(\d{13})\.([A-Za-z0-9+/=_-]{20,64})$/);
  const bad = E(400, "El enlace no es válido o ya venció. Solicita uno nuevo.");
  if (!m) throw bad;
  const exp = Number(m[2]); if (exp < Date.now()) throw bad;
  const u = await ctx.store.getUserById(Number(m[1])); if (!u || !u.active) throw bad;
  const want = Buffer.from(resetSig(u, exp).slice(0, 43)), got = Buffer.from(m[3]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) throw bad;
  const pp = A.passwordProblem(b.password); if (pp) throw E(400, pp);
  await ctx.store.updateUser(u.id, { pwd_hash: A.hashPassword(b.password), failed: 0, locked_until: null, must_change: false });
  await audit(ctx, "—", `Contraseña restablecida con enlace de recuperación (${maskMail(u.email)})`, "Recuperación de contraseña");
  return { ok: true };
}
async function setup(ctx, b) {
  const key = process.env.SETUP_KEY || "";
  if (key.length < 16) throw E(404, "No encontrado");
  const given = Buffer.from(String(b.key || "")), want = Buffer.from(key);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw E(403, "Clave de instalación incorrecta.");
  if (await ctx.store.countAdmins() > 0) throw E(409, "Ya existe un administrador. Este paso solo se usa una vez.");
  const email = str(b.email, 160).toLowerCase(), name = str(b.name, 120);
  if (!EMAIL_RE.test(email) || name.length < 3) throw E(400, "Escribe nombre y correo válidos.");
  const pp = A.passwordProblem(b.password); if (pp) throw E(400, pp);
  const u = await ctx.store.createUser({ email, name, role: "admin", pwd_hash: A.hashPassword(b.password) });
  await audit(ctx, "—", `Administrador inicial creado (${maskMail(email)})`, "Instalación");
  return { user: publicUser(u) };
}

/* ---------- Validación de datos de la venta ---------- */
function readParams(pid, raw) {
  const p = C.P[pid]; if (!p) throw E(400, "Seguro no válido.");
  const v = {};
  for (const f of p.fields) {
    const x = raw ? raw[f.id] : undefined;
    if (f.type === "select") { if (!f.opts.includes(x)) throw E(400, `Elige una opción válida en “${f.label}”.`); v[f.id] = x; }
    else { const n = Number(x); if (!Number.isFinite(n)) throw E(400, `Completa “${f.label}”.`); v[f.id] = Math.round(n); }
  }
  const bad = C.validParams(p, v); if (bad) throw E(400, bad);
  return v;
}
function readExtra(pid, raw) {
  const ex = C.P[pid].extra; raw = raw || {};
  if (ex === "beneficiarios") {
    const list = Array.isArray(raw.beneficiarios) ? raw.beneficiarios.slice(0, 3) : [];
    const b = list.map(x => ({ nombre: str(x.nombre, 80), parentesco: str(x.parentesco, 40), pct: Math.round(Number(x.pct)) })).filter(x => x.nombre);
    if (!b.length) throw E(400, "Indica al menos un beneficiario.");
    if (b.some(x => !(x.pct > 0 && x.pct <= 100)) || b.reduce((a, x) => a + x.pct, 0) !== 100) throw E(400, "Los porcentajes de los beneficiarios deben sumar 100%.");
    return { beneficiarios: b };
  }
  const o = {};
  for (const f of ex) {
    let val = str(raw[f.id], 120);
    if (!val) throw E(400, `Completa “${f.label}”.`);
    if (f.re && !f.re.test(val)) throw E(400, f.msg || `“${f.label}” no es válido.`);
    if (f.type === "date" && (!isDate(val) || val < todayBog())) throw E(400, "La fecha de salida no puede ser anterior a hoy.");
    o[f.id] = f.id === "placa" ? val.toUpperCase() : val;
  }
  return o;
}
function readClient(raw, fixed) {
  const c = {
    tipoDoc: str(raw.tipoDoc, 40), doc: str(raw.doc, 20), nombres: str(raw.nombres, 60), apellidos: str(raw.apellidos, 60),
    nacimiento: str(raw.nacimiento, 10), celular: str(raw.celular, 10), email: str(raw.email, 160).toLowerCase(),
    ciudad: str(raw.ciudad, 40), direccion: str(raw.direccion, 120), ...(fixed || {})
  };
  if (!DOC_TYPES.includes(c.tipoDoc)) throw E(400, "Elige un tipo de documento válido.");
  if (c.tipoDoc === "Pasaporte" ? !/^[A-Z0-9]{5,12}$/i.test(c.doc) : !/^\d{5,12}$/.test(c.doc)) throw E(400, "Escribe un número de documento válido.");
  if (c.nombres.length < 2 || c.apellidos.length < 2) throw E(400, "Escribe nombres y apellidos.");
  if (!isDate(c.nacimiento)) throw E(400, "Escribe la fecha de nacimiento.");
  const age = (Date.now() - Date.parse(c.nacimiento)) / 31557600000; if (age < 18 || age > 100) throw E(400, "El tomador debe ser mayor de edad.");
  if (!/^3\d{9}$/.test(c.celular)) throw E(400, "El celular debe tener 10 dígitos y empezar por 3.");
  if (!EMAIL_RE.test(c.email)) throw E(400, "Escribe un correo válido.");
  if (!C.CITIES.includes(c.ciudad)) throw E(400, "Elige una ciudad válida.");
  if (c.direccion.length < 6) throw E(400, "Escribe la dirección de correspondencia.");
  return c;
}
function readStart(pid, raw, extra) {
  const start = pid === "viaje" ? extra.salida : str(raw, 10);
  if (!isDate(start) || start < todayBog()) throw E(400, "La fecha de inicio no puede ser anterior a hoy.");
  if (start > addDays(todayBog(), 90)) throw E(400, "La fecha de inicio no puede ser mayor a 90 días.");
  return start;
}

/* ---------- Servidor central: procesamiento, emisión y aprobado ---------- */
async function newTxId(ctx) { return "TX-" + pad(await ctx.store.nextSeq("tx"), 6); }
function newApproval() { return { code: "APR-" + compactDate() + "-" + A.randomDigits(6), at: new Date().toISOString() }; }
function payMsg(t) {
  const p = t.pay;
  return { pse: "Pago aprobado por PSE (" + p.bank + ")", credito: `Tarjeta de crédito •••• ${p.last4} autorizada${p.cuotas > 1 ? " a " + p.cuotas + " cuotas" : ""}`, debito: `Tarjeta débito •••• ${p.last4} autorizada`, efectivo: "Pago en efectivo registrado en caja", datafono: `Datáfono: tarjeta •••• ${p.last4} autorizada`, link: "Enlace de pago PSE pagado por el cliente" }[p.method] || "Pago autorizado";
}
const chName = t => t.channel === "web" ? "Web" : "Oficina " + ((C.OFFICES.find(o => o.id === t.office) || {}).city || "");
async function emit(ctx, t, by) {
  t.approval = t.approval || newApproval();
  t.policy = `IG-${C.P[t.product].code}-${new Date().getFullYear()}-${pad(await ctx.store.nextSeq("pol_" + t.product), 6)}`;
  t.status = "aprobada"; t.approvedAt = new Date().toISOString();
  t.end = t.product === "viaje" ? addDays(t.start, t.params.dias) : addYear(t.start);
  t.fp = A.hmac([t.policy, t.approval.code, t.premium.total, t.client.doc, t.start].join("|")).slice(0, 16).toUpperCase();
  await logTx(ctx, t, `Póliza ${t.policy} emitida con número de aprobación ${t.approval.code}`, by);
  await queueMail(ctx, t, "policy");
}
async function preapprove(ctx, t) {
  t.approval = newApproval(); t.status = "preaprobada"; t.attempts = 0;
  await logTx(ctx, t, `Número de aprobación ${t.approval.code} generado; pendiente del aprobado del asesor`, "Servidor central");
}
async function processTx(ctx, t) {
  const steps = [], reasons = [];
  await logTx(ctx, t, "Transacción recibida por el servidor central (" + chName(t) + ")", "Servidor central");
  steps.push({ st: "done", msg: "Transacción " + t.id + " registrada" });
  if (/0000$/.test(t.client.doc)) reasons.push("Coincidencia parcial en listas de control (SARLAFT): requiere revisión de cumplimiento.");
  steps.push(reasons.length ? { st: "warn", msg: "Requiere revisión de cumplimiento" } : { st: "done", msg: "Identidad validada, sin alertas" });
  const r = C.P[t.product].review(t.params); if (r) reasons.push(r);
  steps.push(r ? { st: "warn", msg: "Requiere suscripción manual" } : { st: "done", msg: "Tarifa confirmada: " + C.money(t.premium.total) });
  if (t.pay.declined) {
    t.status = "rechazada"; t.reason = "La entidad emisora rechazó el pago. No se realizó ningún cobro.";
    steps.push({ st: "fail", msg: "Pago rechazado por la entidad emisora" }, { st: "skip", msg: "No se emitió la póliza" });
    t.steps = steps; await logTx(ctx, t, "Pago rechazado por la entidad emisora", "Servidor central"); return;
  }
  steps.push({ st: "done", msg: payMsg(t) });
  if (reasons.length) {
    t.status = "revision"; t.reasons = reasons; steps.push({ st: "warn", msg: "En revisión manual en el servidor central" });
    t.steps = steps; await logTx(ctx, t, "Enviada a revisión manual: " + reasons.join(" "), "Servidor central"); return;
  }
  if (t.channel === "web") { steps.push({ st: "done", msg: "Póliza emitida" }); t.steps = steps; await emit(ctx, t, "Servidor central"); }
  else { steps.push({ st: "done", msg: "Número de aprobación generado: falta el aprobado del asesor" }); t.steps = steps; await preapprove(ctx, t); }
}
function readPay(raw, channel, freq, pid) {
  const m = str(raw && raw.method, 12), p = { method: m };
  if (channel === "web") {
    if (!["pse", "credito", "debito"].includes(m)) throw E(400, "Elige un medio de pago válido.");
    if (m === "pse") { if (freq === "mensual") throw E(400, "Las 12 cuotas solo se pagan con tarjeta."); p.bank = str(raw.bank, 40); if (!BANKS.includes(p.bank)) throw E(400, "Elige un banco válido."); }
    else {
      p.last4 = str(raw.last4, 4); if (!/^\d{4}$/.test(p.last4)) throw E(400, "Datos de la tarjeta no válidos.");
      p.brand = str(raw.brand, 20) || "Tarjeta"; p.cuotas = m === "credito" ? Math.min(36, Math.max(1, Math.round(Number(raw.cuotas) || 1))) : 1;
      p.declined = !!raw.testDecline; // tarjeta de prueba 4000 0000 0000 0002 (el número completo nunca se envía al servidor)
    }
  } else {
    if (!["efectivo", "datafono", "link"].includes(m)) throw E(400, "Elige un medio de pago válido.");
    if (m === "datafono") { p.last4 = str(raw.last4, 4); if (!/^\d{4}$/.test(p.last4)) throw E(400, "Escribe los últimos 4 dígitos de la tarjeta."); }
  }
  return p;
}
async function createWebTx(ctx, b) {
  const u = need(ctx, ["cliente"]);
  if (limited("buy:" + u.id, 20, 3600e3)) throw E(429, "Demasiadas compras seguidas. Intenta más tarde.");
  const pid = str(b.product, 12), plan = str(b.plan, 12);
  if (!C.P[pid] || !C.PLANS.some(x => x[0] === plan)) throw E(400, "Seguro o plan no válido.");
  const params = readParams(pid, b.params), extra = readExtra(pid, b.extra);
  const client = readClient(b.client || {}, { tipoDoc: u.doc_type, doc: u.doc, email: u.email });
  const start = readStart(pid, b.start, extra);
  const freq = C.P[pid].monthly === false ? "unico" : (b.freq === "mensual" ? "mensual" : "anual");
  const accepted = Array.isArray(b.accepted) ? b.accepted : [];
  if (!ACCEPTS.every(a => accepted.includes(a))) throw E(400, "Debes aceptar todas las declaraciones y autorizaciones.");
  const pay = readPay(b.pay, "web", freq, pid);
  const t = { id: await newTxId(ctx), createdAt: new Date().toISOString(), status: "procesando", steps: [], attempts: 0, channel: "web", customerId: u.id, product: pid, plan, params, extra, client, start, premium: C.price(pid, params, plan), freq, pay, accepted: ACCEPTS };
  await ctx.store.insertTx(t);
  await logTx(ctx, t, "Solicitud de compra recibida desde el canal web", "Cliente (web) " + maskMail(u.email));
  await processTx(ctx, t);
  await ctx.store.saveTx(t);
  return { tx: await txView(ctx, t) };
}
async function createOfficeTx(ctx, b) {
  const u = need(ctx, STAFF);
  const office = u.role === "asesor" ? u.office : str(b.office, 8);
  if (!C.OFFICES.some(o => o.id === office)) throw E(400, "Oficina no válida.");
  const pid = str(b.product, 12), plan = str(b.plan, 12);
  if (!C.P[pid] || !C.PLANS.some(x => x[0] === plan)) throw E(400, "Seguro o plan no válido.");
  const params = readParams(pid, b.params), extra = readExtra(pid, b.extra), client = readClient(b.client || {});
  const start = readStart(pid, b.start, extra), pay = readPay(b.pay, "oficina");
  if (!b.okCliente || !b.okDocumento) throw E(400, "Confirma la aceptación del cliente y la verificación del documento.");
  const acct = await ctx.store.getUserByDoc(client.doc);
  const t = { id: await newTxId(ctx), createdAt: new Date().toISOString(), status: "procesando", steps: [], attempts: 0, channel: "oficina", office, sellerId: u.id, seller: u.name, sellerCode: "AS-" + u.id, customerId: acct && acct.email === client.email ? acct.id : null, product: pid, plan, params, extra, client, start, premium: C.price(pid, params, plan), freq: "anual", pay, accepted: ["firma_tableta"] };
  await ctx.store.insertTx(t);
  await logTx(ctx, t, `Venta registrada en ${C.OFFICES.find(o => o.id === office).name} por ${u.name}`, u.name);
  await processTx(ctx, t);
  await ctx.store.saveTx(t);
  return { tx: await txView(ctx, t) };
}
async function closeOfficeTx(ctx, id, b) {
  const u = need(ctx, STAFF);
  const t = await ctx.store.getTx(id); if (!t || t.channel !== "oficina") throw E(404, "Venta no encontrada.");
  if (u.role === "asesor" && t.office !== u.office) throw E(403, "Esta venta es de otra oficina.");
  if (t.status !== "preaprobada") throw E(409, "Esta venta no está pendiente de aprobado.");
  const okCode = str(b.code, 40).toUpperCase() === t.approval.code, okTotal = Number(String(b.total || "").replace(/\D/g, "")) === t.premium.total;
  let msg = null;
  if (okCode && okTotal) await emit(ctx, t, u.name + " (aprobado dado en oficina)");
  else {
    t.attempts = (t.attempts || 0) + 1;
    await logTx(ctx, t, `Intento de aprobado fallido (${!okCode ? "número de aprobación" : "valor"} no coincide). Intento ${t.attempts} de 3`, u.name);
    if (t.attempts >= 3) { t.status = "bloqueada"; await logTx(ctx, t, "Venta bloqueada por 3 intentos fallidos. Requiere desbloqueo en el servidor central", "Servidor central"); msg = "Venta bloqueada por seguridad tras 3 intentos. El servidor central debe desbloquearla."; }
    else msg = (!okCode ? "El número de aprobación no coincide con el emitido por el servidor central." : "El valor cobrado no coincide con el valor aprobado.") + ` Intento ${t.attempts} de 3.`;
  }
  await ctx.store.saveTx(t);
  return { closed: !msg, msg, tx: await txView(ctx, t) };
}
async function adminAction(ctx, id, action, b) {
  const u = need(ctx, ["admin"]);
  const t = await ctx.store.getTx(id); if (!t) throw E(404, "Transacción no encontrada.");
  if (action === "approve") {
    if (t.status !== "revision") throw E(409, "La transacción no está en revisión.");
    await logTx(ctx, t, "Revisión manual aprobada", u.name);
    if (t.channel === "web") await emit(ctx, t, "Servidor central"); else await preapprove(ctx, t);
  } else if (action === "reject") {
    if (!["revision", "preaprobada", "bloqueada"].includes(t.status)) throw E(409, "No se puede rechazar en este estado.");
    const reason = str(b.reason, 300); if (reason.length < 5) throw E(400, "Escribe el motivo del rechazo.");
    t.status = "rechazada"; t.reason = reason; await logTx(ctx, t, "Solicitud rechazada: " + reason, u.name);
  } else if (action === "unlock") {
    if (t.status !== "bloqueada") throw E(409, "La venta no está bloqueada.");
    await logTx(ctx, t, "Venta desbloqueada; el número de aprobación anterior quedó anulado", u.name); await preapprove(ctx, t);
  } else throw E(404, "Acción no válida.");
  await ctx.store.saveTx(t);
  return { tx: await txView(ctx, t, true) };
}

/* ---------- Lectura de pólizas con control de acceso ---------- */
function canSee(u, t) {
  if (!u || !t) return false;
  if (u.role === "admin") return true;
  if (u.role === "asesor") return t.channel === "oficina" && t.office === u.office;
  return t.customerId === u.id || (t.client.doc === u.doc && t.client.email === u.email);
}
async function txView(ctx, t, withLogs) {
  const v = { ...t };
  const bens = await ctx.store.listBenefitsByTx(t.id);
  v.benefits = {}; bens.forEach(b => { (v.benefits[b.benefit] = v.benefits[b.benefit] || []).push({ code: b.code, at: b.at, mailTo: b.mailTo, ...(b.detail || {}) }); });
  if (withLogs || (ctx.user && STAFF.includes(ctx.user.role))) v.log = await ctx.store.getLogs(t.id);
  delete v.accepted;
  return v;
}
async function getTx(ctx, id) {
  const u = need(ctx); const t = await ctx.store.getTx(id);
  if (!canSee(u, t)) throw E(404, "No encontramos esta transacción.");
  return { tx: await txView(ctx, t) };
}
async function getPolicy(ctx, no) {
  const u = need(ctx); const t = await ctx.store.getTxByPolicy(no);
  if (!canSee(u, t)) throw E(404, "No encontramos esta póliza en tu cuenta.");
  return { tx: await txView(ctx, t) };
}
async function myPolicies(ctx) {
  const u = need(ctx, ["cliente"]);
  const list = await ctx.store.listTx({ customerId: u.id, doc: u.doc, email: u.email, limit: 200 });
  return { list: list.filter(t => canSee(u, t)).map(t => ({ id: t.id, createdAt: t.createdAt, channel: t.channel, office: t.office, product: t.product, plan: t.plan, policy: t.policy || null, start: t.start, end: t.end || null, total: t.premium.total, status: t.status })) };
}
async function revoke(ctx, no) {
  const u = need(ctx, ["cliente", "admin"]); const t = await ctx.store.getTxByPolicy(no);
  if (!canSee(u, t)) throw E(404, "No encontramos esta póliza en tu cuenta.");
  if (t.status !== "aprobada") throw E(409, "Solo se pueden revocar pólizas vigentes.");
  const s = Date.parse(t.start + "T05:00:00Z"), e = Date.parse(t.end + "T05:00:00Z"), now = Date.now();
  const total = e - s, left = Math.max(0, Math.min(total, e - Math.max(now, s)));
  t.refund = Math.round(t.premium.total * left / total); t.status = "revocada"; t.revokedAt = new Date().toISOString();
  await logTx(ctx, t, `Póliza revocada por el tomador (art. 1071 C. de Co.). Devolución de prima no causada: ${C.money(t.refund)}`, u.role === "admin" ? u.name : "Tomador (web)");
  await ctx.store.saveTx(t);
  return { refund: t.refund, tx: await txView(ctx, t) };
}

/* ---------- Público: verificación y certificado ---------- */
async function publicVerify(ctx, q) {
  if (limited("ver:" + ctx.ip, 30, 60e3)) throw E(429, "Demasiadas consultas. Espera un minuto.");
  const p = str(q.p, 24).toUpperCase(), a = str(q.a, 32).toUpperCase();
  if (!p || !a) throw E(400, "Escribe el número de póliza y el número de aprobación.");
  const t = await ctx.store.getTxByPolicy(p);
  if (!t || !t.approval || t.approval.code !== a) return { found: false };
  return { found: true, cert: publicCert(t) };
}
function publicCert(t) {
  return { id: "PUB", policy: t.policy, approval: { code: t.approval.code }, approvedAt: t.approvedAt, product: t.product, plan: t.plan, params: t.params, extra: t.product === "vida" ? {} : t.extra,
    client: { nombres: String(t.client.nombres).split(" ")[0], apellidos: String(t.client.apellidos).charAt(0) + ".", tipoDoc: t.client.tipoDoc, doc: "••••" + String(t.client.doc).slice(-4) },
    start: t.start, end: t.end, premium: t.premium, freq: t.freq, pay: { method: t.pay.method }, channel: t.channel, office: t.office, status: t.status, refund: t.refund, fp: t.fp };
}

/* ---------- Beneficios ---------- */
async function activateBenefit(ctx, b) {
  const u = need(ctx, ["cliente"]);
  const t = await ctx.store.getTxByPolicy(str(b.policy, 24));
  if (!canSee(u, t)) throw E(404, "No encontramos esta póliza en tu cuenta.");
  if (t.status !== "aprobada" || t.end < todayBog()) throw E(409, "Los beneficios están disponibles mientras la póliza esté vigente.");
  const key = str(b.benefit, 16), x = C.BENEFITS[key];
  if (!x || !C.benefitsOf(t.product).includes(key)) throw E(400, "Ese beneficio no corresponde a tu seguro.");
  let detail = null; const d = b.detail || {};
  if (x.kind === "reserve") {
    const fecha = str(d.fecha, 10), min = t.start > todayBog() ? t.start : todayBog();
    if (!C.OFFICES.some(o => o.city === d.ciudad) || !["Mañana", "Tarde", "Día completo"].includes(d.jornada) || !isDate(fecha) || fecha < min || fecha > t.end) throw E(400, "Elige ciudad, jornada y una fecha dentro de la vigencia de tu póliza.");
    detail = { ciudad: d.ciudad, fecha, jornada: d.jornada };
  } else if (x.kind === "request") {
    const nota = str(d.nota, 400);
    if (!x.topics.includes(d.tema) || !["Teléfono", "Videollamada", "Correo"].includes(d.canal) || nota.length < 10) throw E(400, "Completa el tema, el canal y una breve descripción (mínimo 10 caracteres).");
    detail = { tema: d.tema, canal: d.canal, nota };
  } else {
    const prev = (await ctx.store.listBenefitsByTx(t.id)).find(r => r.benefit === key);
    if (prev) return { rec: { code: prev.code, at: prev.at, mailTo: prev.mailTo }, tx: await txView(ctx, t) };
  }
  const code = x.kind === "code" ? `${x.code}-${A.randomDigits(4)}-${A.randomDigits(4)}` : `BEN-${x.code}-${new Date().getFullYear()}-${pad(await ctx.store.nextSeq("ben_" + key), 6)}`;
  const rec = { code, at: new Date().toISOString(), mailTo: t.client.email };
  await ctx.store.insertBenefit({ code, txId: t.id, policy: t.policy, benefit: key, detail, at: rec.at, mailTo: t.client.email, client: maskName(t.client) });
  const msg = x.kind === "code" ? `Beneficio “${x.name}” activado: código ${code}` : x.kind === "reserve" ? `Reserva de coworking ${code} en ${detail.ciudad} para el ${detail.fecha} (${detail.jornada.toLowerCase()})` : `Solicitud de ${x.name.toLowerCase()} ${code}: ${detail.tema}, por ${detail.canal.toLowerCase()}`;
  await logTx(ctx, t, msg, "Tomador (beneficios)");
  await queueMail(ctx, t, "benefit", { key, code });
  return { rec: { ...rec, ...(detail || {}) }, tx: await txView(ctx, t) };
}

/* ---------- Correos (destinatario siempre desde la base) ---------- */
const certLink = t => `${mail.siteUrl()}/#/certificado/${t.policy}/${t.approval.code}`;
const mailD = t => ({ name: fullName(t.client), policy: t.policy, approval: t.approval.code, product: t.product, plan: t.plan, start: t.start, end: t.end, premium: t.premium });
async function queueMail(ctx, t, kind, ben) {
  const id = "MAIL-" + pad(await ctx.store.nextSeq("mail"), 6);
  const subject = kind === "benefit" ? `${C.BENEFITS[ben.key].name} (${ben.code}) · Insurance Global` : `Tu póliza ${t.policy} · Insurance Global`;
  await ctx.store.insertMail({ id, at: new Date().toISOString(), to: t.client.email, subject, policy: t.policy, tx: t.id, kind, benefitCode: ben ? ben.code : null, status: "pendiente", note: "Esperando el PDF" });
}
function readPdf(b64) {
  let pdf = null; try { pdf = Buffer.from(String(b64 || ""), "base64"); } catch (e) { }
  if (!pdf || pdf.length < 500 || pdf.length > 500 * 1024 || pdf.slice(0, 5).toString() !== "%PDF-") throw E(400, "El PDF no es válido.");
  return pdf;
}
async function finishMail(ctx, t, kind, benefitCode, res) {
  let m = await ctx.store.findPendingMail(t.policy, kind, benefitCode);
  if (!m) { await queueMail(ctx, t, kind, kind === "benefit" ? { key: (await ctx.store.getBenefit(benefitCode)).benefit, code: benefitCode } : null); m = await ctx.store.findPendingMail(t.policy, kind, benefitCode); }
  await ctx.store.updateMail(m.id, { status: res.status, note: res.note, sentAt: new Date().toISOString() });
  const what = kind === "benefit" ? `la confirmación del beneficio ${benefitCode}` : "el certificado PDF";
  await logTx(ctx, t, res.status === "enviado" ? `Correo con ${what} enviado a ${maskMail(t.client.email)}` : res.status === "simulado" ? `Envío de correo simulado a ${maskMail(t.client.email)}: ${res.note}` : `Falló el envío del correo a ${maskMail(t.client.email)}: ${res.note}`, "Servicio de correo");
}
async function mailPolicy(ctx, b) {
  const u = need(ctx); const t = await ctx.store.getTxByPolicy(str(b.policy, 24));
  if (!canSee(u, t)) throw E(404, "No encontramos esta póliza.");
  if (!["aprobada"].includes(t.status)) throw E(409, "La póliza no está vigente.");
  if (limited("mail:" + u.id, 15, 600e3)) throw E(429, "Demasiados envíos seguidos. Intenta en unos minutos.");
  const pdf = readPdf(b.pdf);
  const res = await mail.sendPolicy(t.client.email, mailD(t), certLink(t), pdf);
  await finishMail(ctx, t, "policy", null, res);
  return { status: res.status, note: res.note, to: maskMail(t.client.email) };
}
async function mailBenefit(ctx, b) {
  const u = need(ctx); const rec = await ctx.store.getBenefit(str(b.code, 32));
  const t = rec && await ctx.store.getTx(rec.txId);
  if (!canSee(u, t)) throw E(404, "No encontramos este beneficio.");
  if (limited("mail:" + u.id, 15, 600e3)) throw E(429, "Demasiados envíos seguidos. Intenta en unos minutos.");
  const pdf = b.pdf ? readPdf(b.pdf) : null;
  const res = await mail.sendBenefit(t.client.email, mailD(t), { key: rec.benefit, code: rec.code, detail: rec.detail }, certLink(t), pdf);
  await finishMail(ctx, t, "benefit", rec.code, res);
  return { status: res.status, note: res.note, to: maskMail(t.client.email) };
}

/* ---------- Siniestros y PQR ---------- */
async function createClaim(ctx, b) {
  const u = need(ctx, ["cliente"]); const t = await ctx.store.getTxByPolicy(str(b.policy, 24));
  if (!canSee(u, t)) throw E(404, "No encontramos esa póliza en tu cuenta.");
  const fecha = str(b.fecha, 10);
  if (!isDate(fecha) || fecha > todayBog()) throw E(400, "Escribe una fecha válida (no futura).");
  if (t.status !== "aprobada" || fecha < t.start || fecha > t.end) throw E(400, "La fecha del siniestro está fuera de la vigencia o la póliza no está vigente.");
  const tipo = str(b.tipo, 60), ciudad = str(b.ciudad, 60), desc = str(b.desc, 2000);
  if (!["Choque o daño", "Hurto", "Incendio o daño por agua", "Enfermedad o accidente", "Fallecimiento", "Pérdida de equipaje", "Otro"].includes(tipo) || !C.CITIES.includes(ciudad)) throw E(400, "Datos del siniestro no válidos.");
  if (desc.length < 20) throw E(400, "Describe qué pasó (mínimo 20 caracteres).");
  const id = `SIN-${new Date().getFullYear()}-${pad(await ctx.store.nextSeq("sin"), 6)}`;
  await ctx.store.insertClaim({ id, at: new Date().toISOString(), policy: t.policy, userId: u.id, tipo, fecha, ciudad, desc });
  await logTx(ctx, t, `Siniestro ${id} reportado (${tipo})`, "Asegurado (web)");
  return { id };
}
async function createPqr(ctx, b) {
  if (limited("pqr:" + ctx.ip, 10, 3600e3)) throw E(429, "Demasiadas solicitudes desde esta conexión. Intenta más tarde.");
  const p = { tipo: str(b.tipo, 20), nombre: str(b.nombre, 120), doc: str(b.doc, 20), email: str(b.email, 160), poliza: str(b.poliza, 24), msg: str(b.msg, 2000) };
  if (!["Petición", "Queja", "Reclamo", "Sugerencia", "Felicitación"].includes(p.tipo)) throw E(400, "Elige un tipo válido.");
  if (p.nombre.length < 3 || !/^[A-Z0-9]{5,12}$/i.test(p.doc) || !EMAIL_RE.test(p.email) || p.msg.length < 20) throw E(400, "Revisa nombre, documento, correo y el detalle (mínimo 20 caracteres).");
  if (!b.datos) throw E(400, "Autoriza el tratamiento de datos para poder responderte.");
  const id = `PQR-${new Date().getFullYear()}-${pad(await ctx.store.nextSeq("pqr"), 6)}`, due = addBizDays(15);
  await ctx.store.insertPqr({ id, at: new Date().toISOString(), ...p, due, userId: ctx.user ? ctx.user.id : null });
  await audit(ctx, "—", `PQR ${id} radicada (${p.tipo})`, "Consumidor (web)");
  return { id, due };
}

/* ---------- Asesor y administración ---------- */
const listItem = t => ({ id: t.id, createdAt: t.createdAt, channel: t.channel, office: t.office, seller: t.seller || null, product: t.product, plan: t.plan, client: maskName(t.client), doc4: String(t.client.doc).slice(-4), total: t.premium.total, policy: t.policy || null, approval: t.approval ? t.approval.code : null, status: t.status });
async function officeList(ctx) { const u = need(ctx, STAFF); const list = await ctx.store.listTx(u.role === "asesor" ? { office: u.office, limit: 300 } : { limit: 300 }); return { list: list.filter(t => t.channel === "oficina").map(t => ({ ...listItem(t), client: fullName(t.client) })) }; }
async function adminTxList(ctx) { need(ctx, ["admin"]); const list = await ctx.store.listTx({ limit: 500 }); return { list: list.map(listItem) }; }
async function adminTx(ctx, id) { need(ctx, ["admin"]); const t = await ctx.store.getTx(id); if (!t) throw E(404, "No encontrada."); return { tx: await txView(ctx, t, true) }; }
async function summary(ctx) {
  need(ctx, ["admin"]);
  const txs = await ctx.store.listTx({ limit: 2000 });
  const em = txs.filter(t => ["aprobada", "revocada"].includes(t.status)), fin = txs.filter(t => ["aprobada", "rechazada", "revocada"].includes(t.status));
  const [claims, pqr, bens, mails] = await Promise.all([ctx.store.listClaims(1000), ctx.store.listPqr(1000), ctx.store.listBenefits(1000), ctx.store.listMail(1000)]);
  return { k: { tx: txs.length, web: txs.filter(t => t.channel === "web").length, office: txs.filter(t => t.channel === "oficina").length, emitted: em.length, premiums: em.reduce((a, t) => a + t.premium.total, 0), action: txs.filter(t => ["revision", "bloqueada"].includes(t.status)).length, rate: fin.length ? Math.round(100 * fin.filter(t => t.status !== "rechazada").length / fin.length) : 0 }, counts: { claims: claims.length, pqr: pqr.length, benefits: bens.length, mail: mails.length }, store: ctx.store.kind };
}
async function adminList(ctx, what) {
  need(ctx, ["admin"]);
  if (what === "claims") return { list: await ctx.store.listClaims() };
  if (what === "pqr") return { list: (await ctx.store.listPqr()).map(p => ({ ...p, email: maskMail(p.email) })) };
  if (what === "benefits") return { list: await ctx.store.listBenefits() };
  if (what === "mail") return { list: (await ctx.store.listMail()).map(m => ({ ...m, to: maskMail(m.to) })) };
  if (what === "audit") return { list: await ctx.store.listAudit(80) };
  throw E(404, "No encontrado.");
}
async function verifyAudit(ctx) {
  need(ctx, ["admin"]);
  const all = await ctx.store.allAudit(); let prev = "GENESIS";
  for (const r of all) { if (auditHash(prev, r) !== r.h) return { intact: false, at: r.n, n: all.length }; prev = r.h; }
  return { intact: true, n: all.length };
}
async function users(ctx) { need(ctx, ["admin"]); return { list: (await ctx.store.listUsers()).map(u => ({ ...publicUser(u), active: u.active, lastLogin: u.last_login, locked: !!(u.locked_until && Date.parse(u.locked_until) > Date.now()) })) }; }
async function createStaff(ctx, b) {
  const me = need(ctx, ["admin"]);
  const email = str(b.email, 160).toLowerCase(), name = str(b.name, 120), role = str(b.role, 12), office = str(b.office, 8) || null;
  if (!EMAIL_RE.test(email) || name.length < 3) throw E(400, "Escribe nombre y correo válidos.");
  if (!["asesor", "admin"].includes(role)) throw E(400, "Rol no válido.");
  if (role === "asesor" && !C.OFFICES.some(o => o.id === office)) throw E(400, "Elige la oficina del asesor.");
  const pp = A.passwordProblem(b.password); if (pp) throw E(400, "Contraseña temporal: " + pp);
  if (await ctx.store.getUserByEmail(email)) throw E(409, "Ya existe un usuario con ese correo.");
  const u = await ctx.store.createUser({ email, name, role, office: role === "asesor" ? office : null, pwd_hash: A.hashPassword(b.password), must_change: true });
  await audit(ctx, "—", `Usuario ${role} creado: ${maskMail(email)}${office ? " (" + office + ")" : ""}`, me.name);
  return { user: publicUser(u) };
}
async function updateStaff(ctx, id, b) {
  const me = need(ctx, ["admin"]); const u = await ctx.store.getUserById(id); if (!u) throw E(404, "Usuario no encontrado.");
  const patch = {}, notes = [];
  if (b.active != null) { if (u.id === me.id && !b.active) throw E(400, "No puedes desactivar tu propia cuenta."); patch.active = !!b.active; notes.push(b.active ? "activado" : "desactivado"); }
  if (b.unlock) { patch.failed = 0; patch.locked_until = null; notes.push("desbloqueado"); }
  if (b.password) { const pp = A.passwordProblem(b.password); if (pp) throw E(400, "Contraseña temporal: " + pp); patch.pwd_hash = A.hashPassword(b.password); patch.must_change = true; notes.push("contraseña restablecida"); }
  if (b.office != null && u.role === "asesor") { if (!C.OFFICES.some(o => o.id === b.office)) throw E(400, "Oficina no válida."); patch.office = b.office; notes.push("oficina " + b.office); }
  const nu = await ctx.store.updateUser(u.id, patch);
  await audit(ctx, "—", `Usuario ${maskMail(u.email)}: ${notes.join(", ") || "sin cambios"}`, me.name);
  return { user: publicUser(nu) };
}
async function seedDemo(ctx) {
  const me = need(ctx, ["admin"]);
  const people = [["Laura", "Gómez Ruiz", "1020304051"], ["Andrés", "Pérez Mora", "79865432"], ["Natalia", "Suárez León", "52987123"], ["Jorge", "Ramírez Díaz", "80100000"], ["Paula", "Castro Niño", "1098765432"], ["Diego", "Vargas Rey", "1015432876"]];
  const specs = [["web", "auto", "plus", { valor: 92000000, modelo: 2022, ciudad: "Bogotá", uso: "Particular" }, { placa: "JKL482", marca: "Mazda 3" }], ["oficina", "vida", "total", { edad: 41, suma: 300000000, fuma: "No" }, { beneficiarios: [{ nombre: "Sofía Pérez", parentesco: "Hijo(a)", pct: 100 }] }], ["web", "viaje", "plus", { destino: "Europa (Schengen)", dias: 20, viajeros: 2, edad: 38 }, { salida: addDays(todayBog(), 10) }], ["web", "hogar", "plus", { inmueble: 420000000, contenido: 60000000, tipo: "Apartamento", ciudad: "Medellín" }, { dir_riesgo: "Cra 43A # 1-50" }], ["oficina", "auto", "total", { valor: 350000000, modelo: 2025, ciudad: "Cali", uso: "Particular" }, { placa: "XYZ123", marca: "BMW X3" }], ["oficina", "mascotas", "plus", { tipo: "Perro", edad: 4 }, { mascota: "Toby", raza: "Labrador" }]];
  let i = 0;
  for (const [ch, pid, plan, params, extra] of specs) {
    const [n, a, doc] = people[i], off = C.OFFICES[i % C.OFFICES.length];
    const client = { tipoDoc: "Cédula de ciudadanía", doc, nombres: n, apellidos: a, nacimiento: "1988-05-14", celular: "3001234567", email: n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") + "@ejemplo.com", ciudad: "Bogotá", direccion: "Calle 10 # 20-30" };
    const t = { id: await newTxId(ctx), createdAt: new Date().toISOString(), status: "procesando", steps: [], attempts: 0, channel: ch, office: ch === "oficina" ? off.id : undefined, seller: ch === "oficina" ? "Asesor de ejemplo" : undefined, customerId: null, product: pid, plan, params, extra, client, start: pid === "viaje" ? extra.salida : addDays(todayBog(), 1), premium: C.price(pid, params, plan), freq: "anual", pay: ch === "web" ? { method: "pse", bank: "Bancolombia" } : { method: "efectivo" }, demo: true };
    await ctx.store.insertTx(t);
    await logTx(ctx, t, "Transacción de ejemplo creada desde la consola", me.name);
    await processTx(ctx, t);
    if (ch === "oficina" && t.status === "preaprobada" && i !== 5) await emit(ctx, t, "Asesor de ejemplo (aprobado dado en oficina)");
    await ctx.store.saveTx(t); i++;
  }
  return { created: specs.length };
}

module.exports = { E, currentUser, publicUser, need, register, login, logout, changePassword, setup, forgotPassword, resetPassword, createWebTx, createOfficeTx, closeOfficeTx, adminAction, getTx, getPolicy, myPolicies, revoke, publicVerify, activateBenefit, mailPolicy, mailBenefit, createClaim, createPqr, officeList, adminTxList, adminTx, summary, adminList, verifyAudit, users, createStaff, updateStaff, seedDemo, STEP_NAMES, _limits: hits };
