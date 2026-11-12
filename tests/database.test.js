const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../src/desktop/database');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-db-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('fresh database migrates and preserves sample data after close and reopen', (t) => {
  const directory = temporaryDirectory(t);
  let db = openDatabase(directory);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 29);
  db.prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?)').run('sample', 'retained');
  db.close();
  db = openDatabase(directory);
  assert.equal(db.prepare('SELECT value FROM app_metadata WHERE key = ?').get('sample').value, 'retained');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 29);
  db.close();
});

test('upgrades version 1 without losing existing records', (t) => {
  const directory = temporaryDirectory(t);
  let db = new DatabaseSync(path.join(directory, 'arra.sqlite'));
  db.exec(`CREATE TABLE app_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT;
    INSERT INTO app_metadata VALUES ('sample', 'existing'); DROP TABLE IF EXISTS financial_scopes; DROP TABLE IF EXISTS test_print_results; DROP TABLE IF EXISTS test_print_attempts; DROP TABLE IF EXISTS test_print_jobs; DROP TABLE IF EXISTS test_printer_queues; DROP TABLE IF EXISTS day_print_settings; DROP TABLE IF EXISTS day_print_results; DROP TABLE IF EXISTS day_print_attempts; DROP TABLE IF EXISTS day_print_jobs; DROP TABLE IF EXISTS pending_staff; PRAGMA user_version = 1;`);
  db.close();
  db = openDatabase(directory);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 29);
  assert.deepEqual({ ...db.prepare('SELECT * FROM app_metadata').get() },
    { key: 'sample', value: 'existing', updated_at: null });
  db.close();
});

test('failed upgrade rolls back and leaves existing records and version intact', (t) => {
  const directory = temporaryDirectory(t);
  let db = new DatabaseSync(path.join(directory, 'arra.sqlite'));
  db.exec(`CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    INSERT INTO app_metadata VALUES ('sample', 'existing', NULL); DROP TABLE IF EXISTS financial_scopes; DROP TABLE IF EXISTS test_print_results; DROP TABLE IF EXISTS test_print_attempts; DROP TABLE IF EXISTS test_print_jobs; DROP TABLE IF EXISTS test_printer_queues; DROP TABLE IF EXISTS day_print_settings; DROP TABLE IF EXISTS day_print_results; DROP TABLE IF EXISTS day_print_attempts; DROP TABLE IF EXISTS day_print_jobs; DROP TABLE IF EXISTS pending_staff; PRAGMA user_version = 1;`);
  db.close();
  assert.throws(() => openDatabase(directory));
  db = new DatabaseSync(path.join(directory, 'arra.sqlite'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(db.prepare('SELECT value FROM app_metadata').get().value, 'existing');
  db.close();
});

test('rejects a newer database without modifying it', (t) => {
  const directory = temporaryDirectory(t);
  let db = new DatabaseSync(path.join(directory, 'arra.sqlite'));
  db.exec("CREATE TABLE saved (value TEXT); INSERT INTO saved VALUES ('existing'); DROP TABLE IF EXISTS financial_scopes; PRAGMA user_version = 99;");
  db.close();
  assert.throws(() => openDatabase(directory), /newer/);
  db = new DatabaseSync(path.join(directory, 'arra.sqlite'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 99);
  assert.equal(db.prepare('SELECT value FROM saved').get().value, 'existing');
  db.close();
});

test('reports an inaccessible database location', (t) => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'not-a-directory');
  fs.writeFileSync(file, 'sample');
  assert.throws(() => openDatabase(file));
  assert.equal(fs.readFileSync(file, 'utf8'), 'sample');
});
