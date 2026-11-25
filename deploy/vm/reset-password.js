#!/usr/bin/env node
"use strict";
/*
 * Insurance Global · Restablecer la contraseña de un usuario (por ejemplo, el administrador que la olvidó).
 * Se ejecuta SOLO en la VM, como root, porque lee /etc/insurance-global.env:
 *
 *   sudo node /var/www/insurance-global/deploy/vm/reset-password.js administrador@t-shits.co
 *
 * Pide la contraseña nueva dos veces (no se ve al escribir), desbloquea la cuenta, la reactiva
 * y deja registro en la auditoría. Al ingresar, el usuario debe cambiarla (contraseña temporal).
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ENV_FILE = process.env.IG_ENV_FILE || "/etc/insurance-global.env";

function loadEnv(file) {
  let txt;
  try { txt = fs.readFileSync(file, "utf8"); }
  catch (e) { console.error(`No pude leer ${file}. Ejecuta el comando con sudo.`); process.exit(1); }
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] == null) process.env[m[1]] = v;
  }
}

function askHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = false;
    rl._writeToOutput = function (s) { if (!rl.stdoutMuted || s.includes(question)) rl.output.write(s); };
    rl.question(question, answer => { rl.close(); process.stdout.write("\n"); resolve(answer); });
    rl.stdoutMuted = true;
  });
}

(async () => {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  if (!email.includes("@")) { console.error("Uso: sudo node reset-password.js correo@dominio.com"); process.exit(1); }
  loadEnv(ENV_FILE);
  const api = path.join(__dirname, "..", "..", "api", "shared");
  const A = require(path.join(api, "auth.js"));
  const store = process.env.STORE === "memory" ? require(path.join(api, "store-mem.js")) : require(path.join(api, "store-sql.js"));

  console.log("Conectando con la base de datos (puede tardar ~1 minuto si estaba en pausa)...");
  const u = await store.getUserByEmail(email);
  if (!u) { console.error(`No existe un usuario con el correo ${email}.`); process.exit(2); }
  console.log(`Usuario: ${u.name} · rol ${u.role}${u.active ? "" : " · INACTIVO (se reactivará)"}`);

  const p1 = process.env.IG_NEW_PASSWORD || await askHidden("Contraseña nueva: ");
  const bad = A.passwordProblem(p1);
  if (bad) { console.error(bad); process.exit(3); }
  const p2 = process.env.IG_NEW_PASSWORD || await askHidden("Repite la contraseña: ");
  if (p1 !== p2) { console.error("Las contraseñas no coinciden."); process.exit(3); }

  await store.updateUser(u.id, { pwd_hash: A.hashPassword(p1), failed: 0, locked_until: null, active: true, must_change: true });
  const hash = (prev, r) => A.hmac([prev, r.n, r.at, r.tx, r.ev, r.by].join("|"));
  await store.appendAudit({ tx: "—", ev: `Contraseña restablecida desde la VM para ${email.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => a + "•".repeat(Math.min(6, b.length)) + c)}`, by: "Consola del servidor (VM)" }, hash);
  console.log("Listo: contraseña restablecida y cuenta desbloqueada. Al ingresar te pedirá cambiarla.");
  process.exit(0);
})().catch(e => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
