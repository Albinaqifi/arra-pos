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
  db.exec("INSERT INTO app_metadata(key,value) VALUES('migration_sample','preserved'); DROP TABLE order_cancellations; PRAGMA user_version=31");
  db.close();
  return dir;
}

test('version 31 upgrades to cancellation schema and preserves existing data', t => {
  const dir = version31(t);
  const db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 32);
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
