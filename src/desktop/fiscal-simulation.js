// An offline development simulation only. This module is not a fiscal driver,
// does not open the application's database and has no transport or IPC hook.
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const path = require('node:path');

const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));

function validateReceipt(value) {
  if (!exact(value, ['paymentRef', 'method', 'account', 'lines']) || !identifier(value.paymentRef) ||
      !['cash', 'card'].includes(value.method) || value.account !== 'A' || !Array.isArray(value.lines) || !value.lines.length || value.lines.length > 1000) throw Error('Invalid simulated receipt');
  let total = 0;
  const lines = value.lines.map(line => {
    if (!exact(line, ['name', 'unitMinor', 'quantity', 'taxGroup']) || typeof line.name !== 'string' ||
        !line.name.trim() || line.name.length > 120 || /[\x00-\x1f\x7f]/.test(line.name) ||
        !Number.isSafeInteger(line.unitMinor) || line.unitMinor < 0 || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 ||
        !identifier(line.taxGroup)) throw Error('Invalid simulated line');
    const amount = line.unitMinor * line.quantity;
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(total + amount)) throw Error('Invalid simulated total');
    total += amount;
    return { name: line.name, unitMinor: line.unitMinor, quantity: line.quantity, taxGroup: line.taxGroup };
  });
  return { paymentRef: value.paymentRef, method: value.method, account: value.account, lines, totalMinor: total };
}

// The caller supplies an isolated test directory, not the live application DB.
// Attempts without outcomes are permanently uncertain; no retry is provided.
function openFiscalSimulation(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw Error('Absolute simulation directory required');
  const db = new DatabaseSync(path.join(directory, 'fiscal-simulation.sqlite'));
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS operations(id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('receipt','report')), ref TEXT NOT NULL, payload TEXT NOT NULL, fingerprint TEXT NOT NULL, UNIQUE(kind,ref)) STRICT;
      CREATE TABLE IF NOT EXISTS attempts(operation_id INTEGER PRIMARY KEY REFERENCES operations(id), started_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS outcomes(operation_id INTEGER PRIMARY KEY REFERENCES attempts(operation_id), result TEXT NOT NULL CHECK(result IN ('simulated_accept','simulated_failure')), ended_at INTEGER NOT NULL) STRICT;
      CREATE TRIGGER IF NOT EXISTS simulation_operations_no_update BEFORE UPDATE ON operations BEGIN SELECT RAISE(ABORT,'immutable'); END;
      CREATE TRIGGER IF NOT EXISTS simulation_operations_no_delete BEFORE DELETE ON operations BEGIN SELECT RAISE(ABORT,'immutable'); END;
      CREATE TRIGGER IF NOT EXISTS simulation_attempts_no_update BEFORE UPDATE ON attempts BEGIN SELECT RAISE(ABORT,'immutable'); END;
      CREATE TRIGGER IF NOT EXISTS simulation_attempts_no_delete BEFORE DELETE ON attempts BEGIN SELECT RAISE(ABORT,'immutable'); END;
      CREATE TRIGGER IF NOT EXISTS simulation_outcomes_no_update BEFORE UPDATE ON outcomes BEGIN SELECT RAISE(ABORT,'immutable'); END;
      CREATE TRIGGER IF NOT EXISTS simulation_outcomes_no_delete BEFORE DELETE ON outcomes BEGIN SELECT RAISE(ABORT,'immutable'); END;
      CREATE TRIGGER IF NOT EXISTS simulation_operations_no_replace BEFORE INSERT ON operations WHEN EXISTS(SELECT 1 FROM operations WHERE id=NEW.id OR (kind=NEW.kind AND ref=NEW.ref)) BEGIN SELECT RAISE(ABORT,'immutable'); END;
      CREATE TRIGGER IF NOT EXISTS simulation_attempts_no_replace BEFORE INSERT ON attempts WHEN EXISTS(SELECT 1 FROM attempts WHERE operation_id=NEW.operation_id) BEGIN SELECT RAISE(ABORT,'immutable'); END;
      CREATE TRIGGER IF NOT EXISTS simulation_outcomes_no_replace BEFORE INSERT ON outcomes WHEN EXISTS(SELECT 1 FROM outcomes WHERE operation_id=NEW.operation_id) BEGIN SELECT RAISE(ABORT,'immutable'); END;`);
  } catch (error) { db.close(); throw error; }

  function prepare(kind, ref, data) {
    const payload = JSON.stringify(data), fingerprint = createHash('sha256').update(payload).digest('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      const prior = db.prepare('SELECT id,fingerprint FROM operations WHERE kind=? AND ref=?').get(kind, ref);
      if (prior && prior.fingerprint !== fingerprint) throw Error('Simulation reference conflict');
      const id = prior ? prior.id : Number(db.prepare('INSERT INTO operations(kind,ref,payload,fingerprint) VALUES(?,?,?,?)').run(kind, ref, payload, fingerprint).lastInsertRowid);
      db.exec('COMMIT'); return id;
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  }

  function reserve(id) {
    if (!Number.isSafeInteger(id) || id <= 0) throw Error('Invalid operation');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!db.prepare('SELECT 1 FROM operations WHERE id=?').get(id)) throw Error('Unknown operation');
      if (db.prepare('SELECT 1 FROM attempts WHERE operation_id=?').get(id)) throw Error('Simulation attempt already reserved');
      db.prepare('INSERT INTO attempts VALUES(?,?)').run(id, Date.now());
      db.exec('COMMIT');
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  }

  return Object.freeze({
    prepareReceipt(value) { const receipt = validateReceipt(value); return prepare('receipt', receipt.paymentRef, receipt); },
    // This opaque simulation reference is deliberately not an Arra business day.
    prepareReport(ref) { if (!identifier(ref)) throw Error('Invalid simulated report reference'); return prepare('report', ref, { ref }); },
    reserve,
    // No adapter can be supplied: only these explicitly simulated outcomes exist.
    finishSimulated(id, result) {
      if (!Number.isSafeInteger(id) || id <= 0 || !['simulated_accept', 'simulated_failure'].includes(result)) throw Error('Invalid simulated outcome');
      db.prepare('INSERT INTO outcomes VALUES(?,?,?)').run(id, result, Date.now());
    },
    get(id) {
      const row = db.prepare(`SELECT o.id,o.kind,o.ref,o.payload,a.started_at AS startedAt,r.result
        FROM operations o LEFT JOIN attempts a ON a.operation_id=o.id LEFT JOIN outcomes r ON r.operation_id=o.id WHERE o.id=?`).get(id);
      return row ? { ...row, payload: JSON.parse(row.payload), state: row.result || (row.startedAt ? 'uncertain' : 'prepared') } : null;
    },
    close() { db.close(); }
  });
}

module.exports = { openFiscalSimulation };
