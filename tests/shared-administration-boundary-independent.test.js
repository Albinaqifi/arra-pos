const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { createSampleAccounts } = require('../src/desktop/sample-accounts');
const { createSession, hashPassword } = require('../src/desktop/session');
const { registerEmployeeConfig } = require('../src/desktop/employee-config');
const { randomBytes, randomInt } = require('node:crypto');
function entryFixture(db, waiter = 1) {
  const password = randomBytes(24).toString('hex'), pin = String(randomInt(10000)).padStart(4, '0');
  const salt = randomBytes(16), pinSalt = randomBytes(16);
  const id = db.prepare('INSERT INTO local_users(username,salt,password_hash) VALUES(?,?,?)').run('sample restaurant',salt,hashPassword(password,salt)).lastInsertRowid;
  db.prepare("INSERT INTO financial_scopes VALUES(?,'waiter')").run(id);
  db.prepare('INSERT INTO restaurant_accounts VALUES(?)').run(id);
  db.prepare('UPDATE local_users SET pin_salt=?,pin_hash=? WHERE id=?').run(pinSalt,hashPassword(pin,pinSalt),waiter);
  return { password, pin };
}

test('credential and grant control remains Combined-only for owners and pre-existing waiter administrators', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-admin-boundary-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const passwords = ['sample one', 'sample two', 'sample three', 'sample four'];
  createSampleAccounts(db, passwords);
  const entry = entryFixture(db);
  // Model a pre-existing waiter with employee-administration grants.
  const grant = db.prepare('INSERT OR IGNORE INTO user_permissions(user_id, permission) VALUES (?, ?)');
  for (const p of ['employees.view', 'employees.change']) grant.run(1, p);
  const session = createSession(db), handlers = {}, event = {};
  registerEmployeeConfig({ handle: (name, fn) => { handlers[name] = fn; } }, e => e === event, db, session);
  const invoke = req => handlers['arra:employee-config'](event, req);
  const names = ['sample-waiter', 'sample-owner-a', 'sample-owner-b', 'sample-combined'];
  function login(id) {
    session.signOut();
    assert.equal(session.signIn({ username: id === 1 ? 'sample restaurant' : names[id - 1], password: id === 1 ? entry.password : passwords[id - 1] }).ok, true);
    if (id === 1) assert.equal(session.selectWaiter({ id, pin: entry.pin }).ok, true);
  }
  for (const actor of [1, 2, 3]) {
    login(actor);
    for (const target of [1, 2, 3, 4]) {
      assert.equal(invoke({ action: 'credential', id: target, password: 'sample replacement', pin: null }).ok, false);
      assert.equal(invoke({ action: 'permissions', id: target, permissions: ['employees.view', 'employees.change'] }).ok, false);
      assert.equal(invoke({ action: 'financialAccess', id: target, scope: 'combined', close: true }).ok, false);
    }
    assert.equal(invoke({ action: 'create', username: `sample new ${actor}`, password: 'sample new', pin: '' }).ok, false);
  }
  login(2);
  assert.equal(invoke({ action: 'createPending', username: 'sample pending' }).ok, true);
  const pending = db.prepare('SELECT id, active FROM local_users WHERE username=?').get('sample pending');
  assert.equal(pending.active, 0);
  assert.equal(invoke({ action: 'account', id: pending.id, username: 'sample pending', active: true }).ok, false);
  login(4);
  assert.equal(invoke({ action: 'account', id: pending.id, username: 'sample pending', active: true }).ok, false);
  assert.equal(session.signIn({ username: 'sample pending', password: 'sample new' }).ok, false);
  login(4);
  assert.equal(invoke({ action: 'credential', id: pending.id, password: 'sample new', pin: entry.pin }).ok, true);
  assert.equal(invoke({ action: 'permissions', id: pending.id, permissions: ['orders.view'] }).ok, true);
  assert.equal(invoke({ action: 'account', id: pending.id, username: 'sample pending', active: true }).ok, true);
  assert.equal(db.prepare("SELECT count(*) AS n FROM application_audit WHERE actor_id=2 AND action='create' AND entity_type='employee' AND entity_id=?").get(String(pending.id)).n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM employee_credential_audit WHERE actor_id=4 AND target_id=?').get(pending.id).n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM employee_permission_audit WHERE actor_id=4 AND target_id=?').get(pending.id).n, 1);
  assert.equal(session.signIn({ username: 'sample restaurant', password: entry.password }).ok, true);
  assert.equal(session.selectWaiter({ id: pending.id, pin: entry.pin }).ok, true);
  // A different password-authenticated identity cannot use a selected admin's rights.
  assert.equal(session.selectWaiter({ id: 4, pin: '' }).ok, false);
  assert.equal(invoke({ action: 'credential', id: 2, password: 'sample replacement', pin: null }).ok, false);
  assert.equal(handlers['arra:employee-config']({}, { action: 'list' }).ok, false);
});

test('waiter-only version 27 upgrade preserves identity without silently granting Combined', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-legacy-admin-'));
  let db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const { bootstrap } = require('../src/desktop/session');
  bootstrap(db, 'sample legacy', 'sample legacy password');
  db.prepare("UPDATE financial_scopes SET scope='waiter' WHERE user_id=1").run();
  db.prepare("DELETE FROM user_permissions WHERE user_id=1 AND permission='business_days.close'").run();
  db.exec('DROP TABLE IF EXISTS restaurant_accounts; DROP TABLE IF EXISTS pending_staff; ALTER TABLE day_print_attempts DROP COLUMN scope; PRAGMA user_version=27');
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 31);
  assert.equal(db.prepare('SELECT scope FROM financial_scopes WHERE user_id=1').get().scope, 'waiter');
  assert.equal(db.prepare("SELECT count(*) AS n FROM financial_scopes WHERE scope='combined'").get().n, 0);
  assert.throws(() => bootstrap(db, 'sample second', 'sample second password'));
  const session = createSession(db), handlers = {}, event = {};
  registerEmployeeConfig({ handle: (name, fn) => { handlers[name] = fn; } }, e => e === event, db, session);
  assert.equal(session.signIn({ username: 'sample legacy', password: 'sample legacy password' }).ok, false);
  const entry = entryFixture(db);
  assert.equal(session.signIn({ username: 'sample restaurant', password: entry.password }).ok, true);
  assert.equal(session.selectWaiter({ id: 1, pin: entry.pin }).ok, true);
  assert.equal(handlers['arra:employee-config'](event, { action: 'create', username: 'sample new', password: 'sample new', pin: '' }).ok, false);
  assert.equal(handlers['arra:employee-config'](event, { action: 'financialAccess', id: 1, scope: 'combined', close: true }).ok, false);
});

test('financial administration rolls back on audit failure and retains an active Combined administrator', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-combined-integrity-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  createSampleAccounts(db, ['sample one', 'sample two', 'sample three', 'sample four']);
  const session = createSession(db), invalidated = [], originalInvalidate = session.invalidateUser;
  session.invalidateUser = id => { invalidated.push(id); originalInvalidate(id); };
  const handlers = {}, event = {};
  registerEmployeeConfig({ handle: (name, fn) => { handlers[name] = fn; } }, e => e === event, db, session);
  assert.equal(session.signIn({ username: 'sample-combined', password: 'sample four' }).ok, true);
  const call = req => handlers['arra:employee-config'](event, req);
  const change = { action: 'financialAccess', id: 1, scope: 'combined', close: true };
  db.exec("CREATE TRIGGER fail_financial_audit BEFORE INSERT ON application_audit BEGIN SELECT RAISE(ABORT, 'sample failure'); END;");
  assert.equal(call(change).ok, false);
  assert.equal(db.prepare('SELECT scope FROM financial_scopes WHERE user_id=1').get().scope, 'waiter');
  assert.equal(db.prepare("SELECT count(*) AS n FROM user_permissions WHERE user_id=1 AND permission='business_days.close'").get().n, 0);
  assert.deepEqual(invalidated, []);
  db.exec('DROP TRIGGER fail_financial_audit');
  assert.equal(call(change).ok, true);
  assert.deepEqual(invalidated, [1]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM application_audit WHERE action='financial_access' AND actor_id=4").get().n, 1);
  assert.equal(call({ action: 'financialAccess', id: 4, scope: 'waiter', close: false }).ok, false);
  assert.equal(call({ action: 'account', id: 4, username: 'sample-combined', active: false }).ok, false);
  assert.equal(call({ action: 'financialAccess', id: 1, scope: 'waiter', close: false }).ok, true);
  assert.equal(db.prepare("SELECT count(*) AS n FROM local_users u JOIN financial_scopes f ON f.user_id=u.id WHERE u.active=1 AND f.scope='combined'").get().n, 1);
});

test('sample recovery rejects missing marker and removes failed copy after audit error', async t => {
  const { bootstrap } = require('../src/desktop/session');
  const { recoverSampleCombined } = require('../src/desktop/sample-combined-recovery');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-recovery-independent-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = openDatabase(dir);
  bootstrap(db, 'sample legacy admin', 'sample legacy password');
  db.exec("UPDATE financial_scopes SET scope='waiter' WHERE user_id=1; DELETE FROM user_permissions WHERE permission='business_days.close'; INSERT INTO dining_tables(id,area) VALUES(1,'sample'); INSERT INTO orders(table_id,opened_at,status) VALUES(1,456,'open'); CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON application_audit BEGIN SELECT RAISE(ABORT, 'sample failure'); END;");
  db.close();
  const file = path.join(dir, 'arra.sqlite');
  const originalMkdtemp = fs.mkdtempSync;
  const created = [];
  fs.mkdtempSync = (...args) => { const result = originalMkdtemp(...args); created.push(result); return result; };
  try {
    await assert.rejects(recoverSampleCombined(file, 'sample legacy admin', 'sample legacy password'));
    assert.deepEqual(created, []);
    fs.writeFileSync(path.join(dir, 'SAMPLE-DATA-ONLY'), 'synthetic sample');
    await assert.rejects(recoverSampleCombined(file, 'sample legacy admin', 'sample legacy password'));
    assert.equal(created.length, 1);
    assert.equal(fs.existsSync(created[0]), false);
  } finally {
    fs.mkdtempSync = originalMkdtemp;
  }
  db = openDatabase(dir);
  assert.equal(db.prepare('SELECT scope FROM financial_scopes WHERE user_id=1').get().scope, 'waiter');
  assert.equal(db.prepare('SELECT opened_at FROM orders').get().opened_at, 456);
  assert.equal(db.prepare("SELECT count(*) AS n FROM application_audit WHERE action='sample_combined_setup'").get().n, 0);
  db.close();
});
