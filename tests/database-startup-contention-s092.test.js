const { removeFiscalSchemaSql } = require('./support/historical-database');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { openDatabase } = require('../src/desktop/database');

function openWhileLocked(dir) {
  const code = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { openDatabase } = require(workerData.database);
    parentPort.postMessage({ starting: true });
    const started = Date.now();
    try {
      const db = openDatabase(workerData.dir);
      const elapsed = Date.now() - started;
      const version = db.prepare('PRAGMA user_version').get().user_version;
      const timeout = db.prepare('PRAGMA busy_timeout').get().timeout;
      const value = db.prepare("SELECT value FROM app_metadata WHERE key = 'contention-sample'").get().value;
      db.close();
      parentPort.postMessage({ version, timeout, value, elapsed });
    } catch (error) {
      parentPort.postMessage({ error: error.message, elapsed: Date.now() - started });
    }
  `;
  const worker = new Worker(code, { eval: true, workerData: { dir, database: require.resolve('../src/desktop/database') } });
  let start;
  const starting = new Promise(resolve => { start = resolve; });
  const result = new Promise((resolve, reject) => {
    worker.on('message', message => message.starting ? start() : resolve(message));
    worker.on('error', reject);
    worker.on('exit', code => { if (code !== 0) reject(new Error(`Worker exited: ${code}`)); });
  });
  result.catch(() => {});
  return { worker, starting, result };
}

test('startup waits to upgrade after a competing transaction and leaves later lock behavior unchanged', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-startup-wait-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  db.prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?)').run('contention-sample', 'retained');
  db.exec(removeFiscalSchemaSql + `DROP TABLE IF EXISTS order_waiter_ownership; DROP TABLE IF EXISTS legacy_unassigned_orders; DROP TABLE wallet_cancellations; DROP TABLE wallet_prepared; DROP TABLE wallet_requests;
    DROP TABLE wallet_closings; DROP TABLE wallet_movements; DROP TABLE wallet_baselines; DROP TABLE IF EXISTS verified_waiter_pins; PRAGMA user_version=40`);
  db.exec('BEGIN EXCLUSIVE');
  const opening = openWhileLocked(dir);
  try {
    await opening.starting;
    await new Promise(resolve => setTimeout(resolve, 200));
    db.exec('COMMIT');
    const { elapsed, ...result } = await opening.result;
    assert.deepEqual(result, { version: 50, timeout: 0, value: 'retained' });
    assert.ok(elapsed >= 100, `opening returned after ${elapsed}ms without observing the lock`);
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK');
    await opening.worker.terminate();
  }
});

test('startup reports a persistent lock and a later retry preserves data', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-startup-timeout-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  db.prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?)').run('contention-sample', 'retained');
  db.exec('BEGIN IMMEDIATE');
  const opening = openWhileLocked(dir);
  try {
    await opening.starting;
    const result = await opening.result;
    assert.match(result.error, /locked/i);
    assert.ok(result.elapsed >= 4000, `lock timed out too early after ${result.elapsed}ms`);
    db.exec('COMMIT');
    const retried = openDatabase(dir);
    try {
      assert.equal(retried.prepare('SELECT value FROM app_metadata WHERE key = ?').get('contention-sample').value, 'retained');
      assert.equal(retried.prepare('PRAGMA busy_timeout').get().timeout, 0);
    } finally { retried.close(); }
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK');
    await opening.worker.terminate();
  }
});
