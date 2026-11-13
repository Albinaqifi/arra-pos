const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { openDatabase } = require('../src/desktop/database');
const { bootstrap, createSession } = require('../src/desktop/session');
const { recoverLegacyCombined } = require('../src/desktop/legacy-combined-recovery');

test('legacy recovery creates a separate audited Combined account, retaining the source and history', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-legacy-test-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const sourceDir = path.join(root, 'source'), dest = path.join(root, 'recovered');
  const pw = randomBytes(20).toString('hex'), newPw = randomBytes(20).toString('hex');
  let db = openDatabase(sourceDir);
  bootstrap(db, 'legacy-admin', pw);
  db.exec("UPDATE financial_scopes SET scope='waiter'; INSERT INTO dining_tables(id,area) VALUES(1,'sample'); INSERT INTO orders(table_id,opened_at,status) VALUES(1,123,'open')");
  db.close();
  const source = path.join(sourceDir, 'arra.sqlite');
  await assert.rejects(recoverLegacyCombined(source, dest, 'legacy-admin', 'wrong', 'new-combined', newPw));
  assert.equal(fs.existsSync(dest), false);
  await assert.rejects(recoverLegacyCombined(source, dest, 'legacy-admin', pw, 'legacy-admin', newPw));
  assert.equal(fs.existsSync(dest), false);
  await recoverLegacyCombined(source, dest, 'legacy-admin', pw, 'new-combined', newPw);
  db = openDatabase(dest);
  assert.equal(db.prepare('SELECT count(*) n FROM local_users').get().n, 2);
  assert.equal(db.prepare("SELECT scope FROM financial_scopes WHERE user_id=1").get().scope, 'waiter');
  assert.equal(db.prepare('SELECT opened_at FROM orders').get().opened_at, 123);
  assert.equal(db.prepare("SELECT actor_id FROM application_audit WHERE action='legacy_combined_recovery'").get().actor_id, 1);
  let session = createSession(db); assert.equal(session.signIn({ username:'new-combined', password:newPw }).ok, true);
  db.close(); db = openDatabase(dest); session = createSession(db);
  assert.equal(session.signIn({ username:'new-combined', password:newPw }).ok, true); db.close();
  db = openDatabase(sourceDir); assert.equal(db.prepare('SELECT count(*) n FROM local_users').get().n, 1); db.close();
  await assert.rejects(recoverLegacyCombined(source, dest, 'legacy-admin', pw, 'other', newPw));
  assert.equal(fs.existsSync(path.join(dest, 'arra.sqlite')), true);
});

test('legacy recovery rejects inactive, unauthorized, pending and owner-containing databases', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-legacy-denied-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const dir = path.join(root,'source'), dest = path.join(root,'dest'), pw = randomBytes(20).toString('hex');
  let db = openDatabase(dir); bootstrap(db, 'legacy-admin', pw);
  db.exec("UPDATE financial_scopes SET scope='waiter'; UPDATE local_users SET active=0"); db.close();
  const run = () => recoverLegacyCombined(path.join(dir,'arra.sqlite'), dest, 'legacy-admin', pw, 'new-combined', randomBytes(20).toString('hex'));
  await assert.rejects(run());
  db = openDatabase(dir); db.exec("UPDATE local_users SET active=1; DELETE FROM user_permissions WHERE permission='employees.change'"); db.close(); await assert.rejects(run());
  db = openDatabase(dir); db.exec("INSERT INTO user_permissions VALUES(1,'employees.change'); INSERT INTO pending_staff VALUES(1)"); db.close(); await assert.rejects(run());
  db = openDatabase(dir); db.exec("DELETE FROM pending_staff; UPDATE financial_scopes SET scope='combined'"); db.close(); await assert.rejects(run());
  db = openDatabase(dir); db.exec("UPDATE financial_scopes SET scope='A'"); db.close(); await assert.rejects(run());
  db = openDatabase(dir); db.exec("UPDATE financial_scopes SET scope='waiter'; INSERT INTO local_users(username,salt,password_hash) VALUES('unscoped',x'01',x'01')"); db.close(); await assert.rejects(run());
  assert.equal(fs.existsSync(dest), false);
});

test('legacy recovery upgrades a version 27 copy and removes the copy after an audit failure', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-legacy-upgrade-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const dir = path.join(root, 'source'), dest = path.join(root, 'dest'), pw = randomBytes(20).toString('hex');
  let db = openDatabase(dir); bootstrap(db, 'legacy-admin', pw);
  db.exec("UPDATE financial_scopes SET scope='waiter'; DROP TABLE IF EXISTS restaurant_accounts; DROP TABLE IF EXISTS pending_staff; ALTER TABLE day_print_attempts DROP COLUMN scope; PRAGMA user_version=27"); db.close();
  await recoverLegacyCombined(path.join(dir, 'arra.sqlite'), dest, 'legacy-admin', pw, 'combined', pw);
  db = openDatabase(dest); assert.equal(createSession(db).signIn({username:'combined',password:pw}).ok,true); db.close();
  db = new (require('node:sqlite').DatabaseSync)(path.join(dir,'arra.sqlite'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,27);
  db.exec("CREATE TRIGGER fail_recovery BEFORE INSERT ON application_audit BEGIN SELECT RAISE(FAIL,'injected'); END"); db.close();
  const failed = path.join(root,'failed');
  await assert.rejects(recoverLegacyCombined(path.join(dir,'arra.sqlite'), failed, 'legacy-admin', pw, 'combined', pw));
  assert.equal(fs.existsSync(failed),false);
});
