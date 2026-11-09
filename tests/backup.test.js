const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../src/desktop/database');
const { createBackup, restoreBackup } = require('../src/desktop/backup');

const phrase = 'sample backup passphrase';
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-backup-test-'));

  const live = path.join(root, 'live'), target = path.join(root, 'restored'), output = path.join(root, 'backup.enc');
  fs.mkdirSync(target);
  const db = openDatabase(live);
  db.exec("INSERT INTO dining_tables (id, area) VALUES (1, 'Sample'); INSERT INTO orders (id, table_id, opened_at, status) VALUES (1, 1, 123, 'open'); INSERT INTO local_users (id, username, salt, password_hash) VALUES (1, 'sample-user', x'01', x'02');");
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, live, target, output, db };
}
test('online snapshot restores orders and users while source connection remains open', async t => {
  const { live, target, output, db } = setup(t);
  await createBackup(live, output, phrase);
  assert.equal(fs.readFileSync(output).includes(Buffer.from('sample-user')), false);
  db.exec("UPDATE orders SET status = 'completed' WHERE id = 1");
  restoreBackup(output, target, phrase);
  const restored = new DatabaseSync(path.join(target, 'arra.sqlite'), { readOnly: true });
  assert.equal(restored.prepare('SELECT status FROM orders WHERE id=1').get().status, 'open');
  assert.equal(restored.prepare('SELECT username FROM local_users WHERE id=1').get().username, 'sample-user');
  restored.close();
});
test('rejects wrong secret, tampering, nonempty destination and overwrites without damaging source or backup', async t => {
  const { live, target, output, db, root } = setup(t);
  await createBackup(live, output, phrase);
  const original = fs.readFileSync(output);
  await assert.rejects(createBackup(live, output, phrase));
  assert.deepEqual(fs.readFileSync(output), original);
  await assert.rejects(createBackup(live, path.join(live, 'unsafe.enc'), phrase));
  assert.throws(() => restoreBackup(output, target, 'wrong passphrase here'));
  assert.deepEqual(fs.readdirSync(target), []);
  const corrupt = Buffer.from(original); corrupt[corrupt.length - 1] ^= 1;
  const damaged = path.join(root, 'damaged.enc'); fs.writeFileSync(damaged, corrupt);
  assert.throws(() => restoreBackup(damaged, target, phrase));
  assert.deepEqual(fs.readdirSync(target), []);
  fs.writeFileSync(path.join(target, 'keep'), 'existing');
  assert.throws(() => restoreBackup(output, target, phrase));
  assert.equal(fs.readFileSync(path.join(target, 'keep'), 'utf8'), 'existing');
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 1);
});
test('fails visibly for missing source and destination; supports a later retry', async t => {
  const { live, output, target, root } = setup(t);
  await assert.rejects(createBackup(path.join(root, 'missing'), output, phrase));
  await assert.rejects(createBackup(live, path.join(root, 'missing', 'backup'), phrase));
  await assert.rejects(createBackup(live, output, 'short'));
  await createBackup(live, output, phrase);
  restoreBackup(output, target, phrase);
  assert.equal(fs.existsSync(path.join(target, 'arra.sqlite')), true);
});


test('snapshot excludes an uncommitted write and remains usable after rollback', async t => {
  const { live, target, output, db } = setup(t);
  db.exec("PRAGMA journal_mode=WAL; BEGIN; UPDATE orders SET status = 'completed' WHERE id = 1;");
  await createBackup(live, output, phrase);
  db.exec('ROLLBACK');
  restoreBackup(output, target, phrase);
  const restored = new DatabaseSync(path.join(target, 'arra.sqlite'), { readOnly: true });
  assert.equal(restored.prepare('SELECT status FROM orders WHERE id=1').get().status, 'open');
  restored.close();
});

