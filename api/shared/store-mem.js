"use strict";
/* Almacenamiento en memoria: SOLO para pruebas locales (STORE=memory). En Azure se usa store-sql.js. */
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const db = { users: [], seq: {}, tx: new Map(), logs: [], audit: [], benefits: [], claims: [], pqr: [], outbox: [] };
let uid = 0;

module.exports = {
  kind: "memory",
  async ping() { return true; },
  // usuarios
  async getUserByEmail(email) { return clone(db.users.find(u => u.email === String(email).toLowerCase())); },
  async getUserById(id) { return clone(db.users.find(u => u.id === Number(id))); },
  async getUserByDoc(doc) { return clone(db.users.find(u => u.role === "cliente" && u.doc === doc)); },
  async createUser(u) { const row = { id: ++uid, failed: 0, locked_until: null, active: true, must_change: false, created_at: new Date().toISOString(), last_login: null, ...u, email: u.email.toLowerCase() }; db.users.push(row); return clone(row); },
  async updateUser(id, patch) { const u = db.users.find(x => x.id === Number(id)); if (u) Object.assign(u, patch); return clone(u); },
  async listUsers() { return clone(db.users); },
  async countAdmins() { return db.users.filter(u => u.role === "admin" && u.active).length; },
  // secuencias
  async nextSeq(name) { db.seq[name] = (db.seq[name] || 0) + 1; return db.seq[name]; },
  // transacciones
  async insertTx(tx) { if (db.tx.has(tx.id)) throw new Error("duplicada"); db.tx.set(tx.id, clone(tx)); },
  async getTx(id) { return clone(db.tx.get(id)); },
  async getTxByPolicy(p) { for (const t of db.tx.values()) if (t.policy && t.policy.toUpperCase() === String(p).toUpperCase()) return clone(t); return null; },
  async saveTx(tx) { db.tx.set(tx.id, clone(tx)); },
  async listTx(f = {}) {
    let a = [...db.tx.values()];
    if (f.customerId != null || f.doc) a = a.filter(t => t.customerId === f.customerId || (f.doc && t.client.doc === f.doc && t.client.email === f.email));
    if (f.office) a = a.filter(t => t.channel === "oficina" && t.office === f.office);
    return clone(a.sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, f.limit || 500));
  },
  // historial de transacción
  async addLog(txId, ev, by) { db.logs.push({ txId, at: new Date().toISOString(), ev, by }); },
  async getLogs(txId) { return clone(db.logs.filter(l => l.txId === txId).map(({ at, ev, by }) => ({ at, ev, by }))); },
  // auditoría encadenada
  async appendAudit(e, hashFn) {
    const last = db.audit[db.audit.length - 1];
    const n = last ? last.n + 1 : 1, at = new Date().toISOString(), prev = last ? last.h : "GENESIS";
    const row = { n, at, tx: e.tx, ev: e.ev, by: e.by };
    row.h = hashFn(prev, row);
    db.audit.push(row); return clone(row);
  },
  async listAudit(limit = 60) { return clone(db.audit.slice(-limit).reverse()); },
  async allAudit() { return clone(db.audit); },
  get _db() { return db; },
  // beneficios
  async insertBenefit(b) { db.benefits.push(clone(b)); },
  async getBenefit(code) { return clone(db.benefits.find(b => b.code === code)); },
  async listBenefitsByTx(txId) { return clone(db.benefits.filter(b => b.txId === txId)); },
  async listBenefits(limit = 300) { return clone(db.benefits.slice(-limit).reverse()); },
  // siniestros y PQR
  async insertClaim(c) { db.claims.push(clone(c)); },
  async listClaims(limit = 300) { return clone(db.claims.slice(-limit).reverse()); },
  async insertPqr(p) { db.pqr.push(clone(p)); },
  async listPqr(limit = 300) { return clone(db.pqr.slice(-limit).reverse()); },
  // correos
  async insertMail(m) { db.outbox.push(clone(m)); },
  async updateMail(id, patch) { const m = db.outbox.find(x => x.id === id); if (m) Object.assign(m, patch); },
  async findPendingMail(policy, kind, benefitCode) { return clone([...db.outbox].reverse().find(m => m.policy === policy && m.kind === kind && (benefitCode ? m.benefitCode === benefitCode : true) && ["pendiente", "error"].includes(m.status))); },
  async listMail(limit = 300) { return clone(db.outbox.slice(-limit).reverse()); },
  _reset() { Object.assign(db, { users: [], seq: {}, tx: new Map(), logs: [], audit: [], benefits: [], claims: [], pqr: [], outbox: [] }); uid = 0; }
};
