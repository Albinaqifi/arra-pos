const { removeFiscalSchemaSql } = require('./support/historical-database');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../src/desktop/database');

function version31(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-cancel-migration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(dir);
  db.exec(removeFiscalSchemaSql + "DROP TABLE IF EXISTS order_waiter_ownership; DROP TABLE IF EXISTS legacy_unassigned_orders; DROP TABLE IF EXISTS wallet_cancellations; DROP TABLE IF EXISTS wallet_prepared; DROP TABLE IF EXISTS wallet_requests; DROP TABLE IF EXISTS wallet_closings; DROP TABLE IF EXISTS wallet_movements; DROP TABLE IF EXISTS wallet_baselines; DROP TABLE IF EXISTS shift_print_results; DROP TABLE IF EXISTS shift_print_attempts; DROP TABLE IF EXISTS payment_shifts; DROP TABLE IF EXISTS shift_closes; DROP TABLE IF EXISTS restaurant_shifts; DROP TABLE IF EXISTS shift_coverage_unavailable; INSERT INTO app_metadata(key,value) VALUES('migration_sample','preserved'); DROP TABLE order_cancellations; DROP TABLE IF EXISTS verified_waiter_pins; PRAGMA user_version=31");
  db.close();
  return dir;
}

test('version 31 upgrades to cancellation schema and preserves existing data', t => {
  const dir = version31(t);
  const db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,45);
  assert.equal(db.prepare("SELECT value FROM app_metadata WHERE key='migration_sample'").get().value, 'preserved');
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'order_cancellations_no_%'").get().n, 3);
  db.close();
});

test('failed version 32 migration retains version 31 and existing data', t => {
  const dir = version31(t);
  let db = new DatabaseSync(path.join(dir, 'arra.sqlite'));
  db.exec('CREATE TABLE order_cancellations(blocker TEXT)');
  db.close();
  assert.throws(() => openDatabase(dir));
  db = new DatabaseSync(path.join(dir, 'arra.sqlite'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 31);
  assert.equal(db.prepare("SELECT value FROM app_metadata WHERE key='migration_sample'").get().value, 'preserved');
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'order_cancellations_no_%'").get().n, 0);
  db.close();
});
