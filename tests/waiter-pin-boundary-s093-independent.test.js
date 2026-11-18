const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomInt } = require('node:crypto');
const { openDatabase } = require('../src/desktop/database');
const { seedSampleIdentities } = require('../src/desktop/sample-accounts');
const { createSession, hashPassword } = require('../src/desktop/session');
const { registerEmployeeConfig } = require('../src/desktop/employee-config');

test('valid direct PIN management requests require Combined and preserve the current entry flow', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-pin-boundary-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const secret = () => randomBytes(20).toString('hex');
  const passwords = Array.from({ length: 4 }, secret);
  const pin = '0' + String(randomInt(1000)).padStart(3, '0');
  const replacement = '1' + String(randomInt(1000)).padStart(3, '0');
  const managerPin = String(randomInt(1000000)).padStart(6, '0');
  seedSampleIdentities(db, passwords, pin, managerPin);
  const waiter = db.prepare("SELECT id FROM local_users WHERE username='sample-waiter'").get().id;
  const session = createSession(db), handlers = {}, sender = {};
  registerEmployeeConfig({ handle(name, fn) { handlers[name] = fn; } }, event => event === sender, db, session);
  const call = (request, event = sender) => handlers['arra:employee-config'](event, request);
  const create = { action: 'create', username: 'synthetic-new', password: secret(), pin: replacement };
  const reset = { action: 'credential', id: waiter, password: null, pin: replacement };
  for (const [name, index] of [['sample-owner-a', 1], ['sample-owner-b', 2]]) {
    assert.equal(session.signIn({ username: name, password: passwords[index] }).ok, true);
    assert.equal(call(create).ok, false);
    assert.equal(call(reset).ok, false);
  }
  assert.equal(session.signIn({ username: 'sample-restaurant', password: passwords[0] }).ok, true);
  assert.equal(session.selectWaiter({ id: waiter, pin }).ok, true);
  assert.equal(call(create).ok, false);
  assert.equal(call(reset).ok, false);
  assert.equal(session.signIn({ username: 'sample-combined', password: passwords[3] }).ok, true);
  assert.equal(call(reset, {}).ok, false);
  assert.equal(call(reset).ok, true);
  const stored = db.prepare('SELECT pin_salt, pin_hash FROM local_users WHERE id=?').get(waiter);
  assert.deepEqual(Buffer.from(stored.pin_hash), hashPassword(replacement, stored.pin_salt));
  assert.notDeepEqual(Buffer.from(stored.pin_hash), Buffer.from(replacement));
  const listed = call({ action: 'list' }).data;
  assert.deepEqual(Object.keys(listed.users.find(user => user.id === waiter)).sort(),
    ['active', 'hasPin', 'id', 'isTransfer', 'pending', 'pinVerified', 'restaurant', 'scope', 'username'].sort());
  assert.deepEqual(Object.keys(listed.credentialAudit[0]).sort(),
    ['actorId', 'occurredAt', 'passwordChanged', 'pinChanged', 'targetId'].sort());
  assert.equal(session.signIn({ username: 'sample-restaurant', password: passwords[0] }).ok, true);
  assert.equal(session.selectWaiter({ id: waiter, pin }).ok, false);
  assert.equal(session.selectWaiter({ id: waiter, pin: replacement }).ok, true);
});
