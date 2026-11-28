"use strict";
/*
 * Almacenamiento en Azure SQL Database (SQL Server) con el paquete "mssql".
 * Configuración (variables de entorno de la Static Web App), una de dos formas:
 *   SQL_CONNECTION_STRING = cadena ADO.NET copiada del portal (Server=tcp:...;Initial Catalog=...;User ID=...;Password=...)
 *   o SQL_SERVER, SQL_DATABASE, SQL_USER, SQL_PASSWORD
 * Las tablas se crean con db/schema.sql.
 */
const sql = require("mssql");

let poolPromise = null;
/* La base gratuita (serverless) se pausa sola y tarda hasta ~1 minuto en despertar:
 * el pool espera hasta 90 s por una conexión en vez de los 30 s por defecto. */
const POOL = { max: 5, min: 0, idleTimeoutMillis: 30000, acquireTimeoutMillis: 90000 };
function config() {
  if (process.env.SQL_CONNECTION_STRING) {
    const c = sql.ConnectionPool.parseConnectionString(process.env.SQL_CONNECTION_STRING);
    return { ...c, options: { encrypt: true, trustServerCertificate: false, ...(c.options || {}) }, pool: { ...POOL, ...(c.pool || {}) }, connectionTimeout: Math.max(c.connectionTimeout || 0, 60000), requestTimeout: 60000 };
  }
  if (!process.env.SQL_SERVER || !process.env.SQL_DATABASE || !process.env.SQL_USER || !process.env.SQL_PASSWORD) return null;
  return {
    server: process.env.SQL_SERVER, database: process.env.SQL_DATABASE,
    user: process.env.SQL_USER, password: process.env.SQL_PASSWORD,
    options: { encrypt: true, trustServerCertificate: false },
    pool: POOL,
    connectionTimeout: 60000, requestTimeout: 60000
  };
}
function pool() {
  if (!poolPromise) {
    const c = config();
    if (!c) return Promise.reject(Object.assign(new Error("Base de datos no configurada"), { status: 503, public: "La base de datos no está configurada (SQL_CONNECTION_STRING)." }));
    poolPromise = new sql.ConnectionPool(c).connect().catch(e => { poolPromise = null; throw e; });
  }
  return poolPromise;
}
async function q(text, params = {}, txn) {
  const req = txn ? new sql.Request(txn) : (await pool()).request();
  for (const [k, [type, val]] of Object.entries(params)) req.input(k, type, val === undefined ? null : val);
  return req.query(text);
}
const S = v => [sql.NVarChar(sql.MAX), v == null ? null : String(v)];
const S1 = (n, v) => [sql.NVarChar(n), v == null ? null : String(v)];
const I = v => [sql.Int, v == null ? null : Number(v)];
const B = v => [sql.Bit, v ? 1 : 0];
const D = v => [sql.DateTime2, v ? new Date(v) : null];
const DT = v => [sql.Date, v ? new Date(String(v).slice(0, 10) + "T00:00:00Z") : null];
const M = v => [sql.Decimal(18, 0), v == null ? null : Math.round(Number(v))];
const iso = d => d ? new Date(d).toISOString() : null;

const userRow = r => r && ({
  id: r.id, email: r.email, name: r.name, role: r.role, office: r.office, doc_type: r.doc_type, doc: r.doc, phone: r.phone,
  first_names: r.first_names || null, last_names: r.last_names || null, birth_date: r.birth_date ? iso(r.birth_date).slice(0, 10) : null, consent_at: iso(r.consent_at),
  pwd_hash: r.pwd_hash, failed: r.failed, locked_until: iso(r.locked_until), active: !!r.active, must_change: !!r.must_change,
  created_at: iso(r.created_at), last_login: iso(r.last_login)
});
let regCols = null;
async function hasRegistroCols() {
  if (regCols === null) { const r = await q("SELECT CASE WHEN COL_LENGTH('dbo.ig_users','birth_date') IS NULL THEN 0 ELSE 1 END AS ok"); regCols = r.recordset[0].ok === 1; }
  return regCols;
}
const txFromRow = r => r ? JSON.parse(r.data) : null;

module.exports = {
  kind: "sql",
  async ping() { await q("SELECT 1 AS ok"); return true; },

  /* ---------- Usuarios ---------- */
  async getUserByEmail(email) { const r = await q("SELECT * FROM ig_users WHERE email=@e", { e: S1(160, String(email).toLowerCase()) }); return userRow(r.recordset[0]); },
  async getUserById(id) { const r = await q("SELECT * FROM ig_users WHERE id=@id", { id: I(id) }); return userRow(r.recordset[0]); },
  async getUserByDoc(doc) { const r = await q("SELECT * FROM ig_users WHERE role='cliente' AND doc=@d", { d: S1(20, doc) }); return userRow(r.recordset[0]); },
  async createUser(u) {
    const p = {
      email: S1(160, u.email.toLowerCase()), name: S1(120, u.name), role: S1(12, u.role), office: S1(8, u.office || null),
      doc_type: S1(40, u.doc_type || null), doc: S1(20, u.doc || null), phone: S1(20, u.phone || null), pwd: S1(256, u.pwd_hash), mc: B(u.must_change)
    };
    let cols = "email,name,role,office,doc_type,doc,phone,pwd_hash,must_change", vals = "@email,@name,@role,@office,@doc_type,@doc,@phone,@pwd,@mc";
    if (await hasRegistroCols()) {   // columnas de la migración 002 (si ya se ejecutó)
      cols += ",first_names,last_names,birth_date,consent_at"; vals += ",@fn,@ln,@bd,@ca";
      Object.assign(p, { fn: S1(60, u.first_names || null), ln: S1(60, u.last_names || null), bd: DT(u.birth_date || null), ca: D(u.consent_at || null) });
    }
    const r = await q(`INSERT INTO ig_users(${cols}) OUTPUT inserted.* VALUES(${vals})`, p);
    return userRow(r.recordset[0]);
  },
  async updateUser(id, patch) {
    const map = { name: v => S1(120, v), office: v => S1(8, v), phone: v => S1(20, v), pwd_hash: v => S1(256, v), failed: I, locked_until: D, active: B, must_change: B, last_login: D };
    const sets = [], params = { id: I(id) };
    for (const [k, v] of Object.entries(patch)) { if (!map[k]) continue; sets.push(`${k}=@${k}`); params[k] = map[k](v); }
    if (!sets.length) return this.getUserById(id);
    const r = await q(`UPDATE ig_users SET ${sets.join(",")} OUTPUT inserted.* WHERE id=@id`, params);
    return userRow(r.recordset[0]);
  },
  async listUsers() { const r = await q("SELECT * FROM ig_users ORDER BY role, name"); return r.recordset.map(userRow); },
  async countAdmins() { const r = await q("SELECT COUNT(*) AS n FROM ig_users WHERE role='admin' AND active=1"); return r.recordset[0].n; },

  /* ---------- Secuencias ---------- */
  async nextSeq(name) {
    const r = await q(`MERGE ig_counters WITH (HOLDLOCK) AS t USING (SELECT @n AS name) AS s ON t.name=s.name
      WHEN MATCHED THEN UPDATE SET value=t.value+1
      WHEN NOT MATCHED THEN INSERT(name,value) VALUES(s.name,1)
      OUTPUT inserted.value;`, { n: S1(40, name) });
    return r.recordset[0].value;
  },

  /* ---------- Transacciones ---------- */
  async insertTx(t) {
    await q(`INSERT INTO ig_tx(id,created_at,channel,office,seller_id,customer_id,product,status,policy,approval_code,client_doc,client_email,total,data)
      VALUES(@id,@at,@ch,@of,@se,@cu,@pr,@st,@po,@ap,@doc,@em,@tot,@data)`, txParams(t));
  },
  async getTx(id) { const r = await q("SELECT data FROM ig_tx WHERE id=@id", { id: S1(16, id) }); return txFromRow(r.recordset[0]); },
  async getTxByPolicy(p) { const r = await q("SELECT data FROM ig_tx WHERE policy=@p", { p: S1(24, String(p).toUpperCase()) }); return txFromRow(r.recordset[0]); },
  async saveTx(t) {
    await q(`UPDATE ig_tx SET status=@st,policy=@po,approval_code=@ap,customer_id=@cu,total=@tot,data=@data WHERE id=@id`, txParams(t));
  },
  async listTx(f = {}) {
    const where = [], params = { lim: I(f.limit || 500) };
    if (f.customerId != null || f.doc) { where.push("(customer_id=@cu OR (client_doc=@doc AND client_email=@em))"); params.cu = I(f.customerId); params.doc = S1(20, f.doc || null); params.em = S1(160, f.email || null); }
    if (f.office) { where.push("channel='oficina' AND office=@of"); params.of = S1(8, f.office); }
    const r = await q(`SELECT TOP (@lim) data FROM ig_tx ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC`, params);
    return r.recordset.map(txFromRow);
  },

  /* ---------- Historial de la transacción ---------- */
  async addLog(txId, ev, by) { await q("INSERT INTO ig_tx_log(tx_id,at,ev,by_name) VALUES(@t,SYSUTCDATETIME(),@e,@b)", { t: S1(16, txId), e: S1(600, ev), b: S1(160, by) }); },
  async getLogs(txId) { const r = await q("SELECT at,ev,by_name FROM ig_tx_log WHERE tx_id=@t ORDER BY id", { t: S1(16, txId) }); return r.recordset.map(x => ({ at: iso(x.at), ev: x.ev, by: x.by_name })); },

  /* ---------- Auditoría encadenada (bloqueo para que dos escrituras no usen el mismo anterior) ---------- */
  async appendAudit(e, hashFn) {
    const p = await pool(); const txn = new sql.Transaction(p);
    await txn.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const last = (await q("SELECT TOP 1 n,h FROM ig_audit WITH (UPDLOCK,HOLDLOCK) ORDER BY n DESC", {}, txn)).recordset[0];
      const n = last ? last.n + 1 : 1, prev = last ? last.h : "GENESIS";
      const now = new Date(); now.setMilliseconds(0);
      const row = { n, at: now.toISOString(), tx: e.tx, ev: e.ev, by: e.by };
      row.h = hashFn(prev, row);
      await q("INSERT INTO ig_audit(n,at,tx,ev,by_name,h) VALUES(@n,@at,@tx,@ev,@by,@h)", { n: I(n), at: D(row.at), tx: S1(24, row.tx), ev: S1(600, row.ev), by: S1(160, row.by), h: S1(64, row.h) }, txn);
      await txn.commit(); return row;
    } catch (err) { try { await txn.rollback(); } catch (_) {} throw err; }
  },
  async listAudit(limit = 60) { const r = await q("SELECT TOP (@l) n,at,tx,ev,by_name,h FROM ig_audit ORDER BY n DESC", { l: I(limit) }); return r.recordset.map(auditRow); },
  async allAudit() { const r = await q("SELECT n,at,tx,ev,by_name,h FROM ig_audit ORDER BY n"); return r.recordset.map(auditRow); },

  /* ---------- Beneficios ---------- */
  async insertBenefit(b) {
    await q("INSERT INTO ig_benefits(code,tx_id,policy,benefit,detail,at,mail_to,client_name) VALUES(@c,@t,@p,@b,@d,@at,@m,@cn)",
      { c: S1(32, b.code), t: S1(16, b.txId), p: S1(24, b.policy), b: S1(16, b.benefit), d: S(b.detail ? JSON.stringify(b.detail) : null), at: D(b.at), m: S1(160, b.mailTo), cn: S1(120, b.client) });
  },
  async getBenefit(code) { const r = await q("SELECT * FROM ig_benefits WHERE code=@c", { c: S1(32, code) }); return benRow(r.recordset[0]); },
  async listBenefitsByTx(txId) { const r = await q("SELECT * FROM ig_benefits WHERE tx_id=@t ORDER BY at", { t: S1(16, txId) }); return r.recordset.map(benRow); },
  async listBenefits(limit = 300) { const r = await q("SELECT TOP (@l) * FROM ig_benefits ORDER BY at DESC", { l: I(limit) }); return r.recordset.map(benRow); },

  /* ---------- Siniestros y PQR ---------- */
  async insertClaim(c) {
    await q("INSERT INTO ig_claims(id,at,policy,user_id,tipo,fecha,ciudad,descr) VALUES(@id,@at,@p,@u,@t,@f,@c,@d)",
      { id: S1(24, c.id), at: D(c.at), p: S1(24, c.policy), u: I(c.userId), t: S1(60, c.tipo), f: DT(c.fecha), c: S1(60, c.ciudad), d: S1(2000, c.desc) });
  },
  async listClaims(limit = 300) { const r = await q("SELECT TOP (@l) * FROM ig_claims ORDER BY at DESC", { l: I(limit) }); return r.recordset.map(x => ({ id: x.id, at: iso(x.at), policy: x.policy, tipo: x.tipo, fecha: iso(x.fecha).slice(0, 10), ciudad: x.ciudad, desc: x.descr })); },
  async insertPqr(p) {
    await q("INSERT INTO ig_pqr(id,at,tipo,nombre,doc,email,poliza,msg,due,user_id) VALUES(@id,@at,@t,@n,@d,@e,@p,@m,@due,@u)",
      { id: S1(24, p.id), at: D(p.at), t: S1(20, p.tipo), n: S1(120, p.nombre), d: S1(20, p.doc), e: S1(160, p.email), p: S1(24, p.poliza || null), m: S1(2000, p.msg), due: D(p.due), u: I(p.userId) });
  },
  async listPqr(limit = 300) { const r = await q("SELECT TOP (@l) * FROM ig_pqr ORDER BY at DESC", { l: I(limit) }); return r.recordset.map(x => ({ id: x.id, at: iso(x.at), tipo: x.tipo, nombre: x.nombre, doc: x.doc, email: x.email, poliza: x.poliza, msg: x.msg, due: iso(x.due) })); },

  /* ---------- Correos ---------- */
  async insertMail(m) {
    await q("INSERT INTO ig_outbox(id,at,to_addr,subject,policy,tx_id,kind,benefit_code,status,note) VALUES(@id,@at,@to,@s,@p,@t,@k,@b,@st,@n)",
      { id: S1(24, m.id), at: D(m.at), to: S1(160, m.to), s: S1(200, m.subject), p: S1(24, m.policy), t: S1(16, m.tx), k: S1(10, m.kind), b: S1(32, m.benefitCode || null), st: S1(12, m.status), n: S1(400, m.note || null) });
  },
  async updateMail(id, patch) {
    await q("UPDATE ig_outbox SET status=@st,note=@n,sent_at=@sa WHERE id=@id", { id: S1(24, id), st: S1(12, patch.status), n: S1(400, patch.note || null), sa: D(patch.sentAt || null) });
  },
  async findPendingMail(policy, kind, benefitCode) {
    const r = await q(`SELECT TOP 1 * FROM ig_outbox WHERE policy=@p AND kind=@k AND status IN ('pendiente','error')
      ${benefitCode ? "AND benefit_code=@b" : ""} ORDER BY at DESC`, { p: S1(24, policy), k: S1(10, kind), b: S1(32, benefitCode || null) });
    return mailRow(r.recordset[0]);
  },
  async listMail(limit = 300) { const r = await q("SELECT TOP (@l) * FROM ig_outbox ORDER BY at DESC", { l: I(limit) }); return r.recordset.map(mailRow); }
};

function txParams(t) {
  return {
    id: S1(16, t.id), at: D(t.createdAt), ch: S1(10, t.channel), of: S1(8, t.office || null), se: I(t.sellerId || null), cu: I(t.customerId == null ? null : t.customerId),
    pr: S1(12, t.product), st: S1(16, t.status), po: S1(24, t.policy || null), ap: S1(32, t.approval ? t.approval.code : null),
    doc: S1(20, t.client.doc), em: S1(160, t.client.email), tot: M(t.premium.total), data: S(JSON.stringify(t))
  };
}
const auditRow = x => ({ n: x.n, at: iso(x.at), tx: x.tx, ev: x.ev, by: x.by_name, h: x.h });
const benRow = x => x && ({ code: x.code, txId: x.tx_id, policy: x.policy, benefit: x.benefit, detail: x.detail ? JSON.parse(x.detail) : null, at: iso(x.at), mailTo: x.mail_to, client: x.client_name });
const mailRow = x => x && ({ id: x.id, at: iso(x.at), to: x.to_addr, subject: x.subject, policy: x.policy, tx: x.tx_id, kind: x.kind, benefitCode: x.benefit_code, status: x.status, note: x.note, sentAt: iso(x.sent_at) });
