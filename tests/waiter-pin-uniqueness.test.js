const { removeFiscalSchemaSql } = require('./support/historical-database');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomInt } = require('node:crypto');
const { openDatabase } = require('../src/desktop/database');
const { bootstrap, createSession, hashPassword } = require('../src/desktop/session');
const { registerEmployeeConfig } = require('../src/desktop/employee-config');
const { seedSampleIdentities } = require('../src/desktop/sample-accounts');

test('unique staff PIN provisioning, legacy transition and role conversion survive restart', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-pin-transition-'));
  let db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const secret = () => randomBytes(16).toString('hex');
  const pin = '0' + String(randomInt(1000)).padStart(3, '0');
  const secondPin = '1' + String(randomInt(1000)).padStart(3, '0');
  const thirdPin = '2' + String(randomInt(1000)).padStart(3, '0');
  const password = secret();
  bootstrap(db, 'combined', password);
  let session, call;
  function connect() {
    session = createSession(db); const handlers = {}, sender = {};
    registerEmployeeConfig({ handle: (name, fn) => { handlers[name] = fn; } }, event => event === sender, db, session);
    call = req => handlers['arra:employee-config'](sender, req);
    assert.equal(session.signIn({ username: 'combined', password }).ok, true);
  }
  connect();
  assert.equal(call({ action: 'create', username: 'first', password: secret(), pin }).ok, true);
  const first = db.prepare("SELECT id FROM local_users WHERE username='first'").get().id;
  const samplePasswords = Array.from({ length: 4 }, secret), managerPin = String(randomInt(1000000)).padStart(6, '0');
  assert.throws(() => seedSampleIdentities(db, samplePasswords, pin, managerPin));
  assert.equal(db.prepare("SELECT count(*) AS n FROM local_users WHERE username LIKE 'sample-%'").get().n, 0, 'colliding sample setup rolls back all identities');
  assert.equal(call({ action: 'create', username: 'duplicate', password: secret(), pin }).ok, false);
  assert.equal(call({ action: 'create', username: 'second', password: secret(), pin: secondPin }).ok, true);
  const second = db.prepare("SELECT id FROM local_users WHERE username='second'").get().id;
  assert.equal(call({ action: 'credential', id: second, password: null, pin }).ok, false);
  assert.equal(call({ action: 'account', id: first, username: 'first', active: false }).ok, true);
  assert.equal(call({ action: 'credential', id: second, password: null, pin }).ok, false, 'inactive credentials remain reserved');
  assert.equal(call({ action: 'account', id: first, username: 'first', active: true }).ok, true);

  // Simulate an upgrade from v41 with two independently salted matching PINs.
  const salt = randomBytes(16);
  db.prepare('UPDATE local_users SET pin_salt=?, pin_hash=? WHERE id=?').run(salt, hashPassword(pin, salt), second);
  db.exec(removeFiscalSchemaSql + 'DROP TABLE IF EXISTS order_waiter_ownership; DROP TABLE IF EXISTS legacy_unassigned_orders; DROP TABLE verified_waiter_pins; PRAGMA user_version=41');
  db.close(); db = openDatabase(dir); connect();
  assert.equal(db.prepare('SELECT count(*) AS n FROM verified_waiter_pins').get().n, 0);
  assert.equal(call({ action: 'account', id: first, username: 'first renamed', active: true }).ok, true);
  assert.equal(call({ action: 'credential', id: first, password: null, pin }).ok, false);
  assert.equal(call({ action: 'account', id: second, username: 'second', active: false }).ok, true);
  assert.equal(call({ action: 'account', id: second, username: 'second', active: true }).ok, false);
  assert.equal(call({ action: 'credential', id: second, password: null, pin: secondPin }).ok, true);
  assert.equal(call({ action: 'credential', id: first, password: null, pin }).ok, true);
  assert.equal(call({ action: 'account', id: second, username: 'second', active: true }).ok, true);

  db.exec("CREATE TRIGGER fail_pin_audit BEFORE INSERT ON employee_credential_audit BEGIN SELECT RAISE(ABORT, 'failure'); END");
  assert.equal(call({ action: 'credential', id: first, password: null, pin: thirdPin }).ok, false);
  db.exec('DROP TRIGGER fail_pin_audit');
  assert.equal(call({ action: 'create', username: 'reserved', password: secret(), pin }).ok, false, 'failed reset leaves old credential intact');
  assert.equal(call({ action: 'financialAccess', id: second, scope: 'A', close: false }).ok, true);
  assert.equal(call({ action: 'financialAccess', id: second, scope: 'waiter', close: false }).ok, false);
  assert.equal(call({ action: 'account', id: second, username: 'second', active: false }).ok, true);
  assert.equal(call({ action: 'financialAccess', id: second, scope: 'waiter', close: false }).ok, true);
  assert.equal(call({ action: 'account', id: second, username: 'second', active: true }).ok, false);
  assert.equal(call({ action: 'credential', id: second, password: null, pin: secondPin }).ok, true);
  assert.equal(call({ action: 'account', id: second, username: 'second', active: true }).ok, true);
  const listed = call({ action: 'list' }).data;
  for (const user of listed.users) assert.deepEqual(Object.keys(user).sort(), ['active', 'hasPin', 'id', 'isTransfer', 'pending', 'pinVerified', 'restaurant', 'scope', 'username'].sort());
  db.close(); db = openDatabase(dir); connect();
  assert.equal(db.prepare('SELECT count(*) AS n FROM verified_waiter_pins').get().n, 2);
  assert.equal(call({ action: 'create', username: 'duplicate-after-restart', password: secret(), pin }).ok, false);
});
