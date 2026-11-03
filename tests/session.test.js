const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { bootstrap, createSession, registerSession } = require('../src/desktop/session');
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-session-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return db;
}
test('bootstrap stores salted hashes and does not overwrite an existing account', t => {
  const db = setup(t);
  bootstrap(db, 'sample', 'example password');
  const row = db.prepare('SELECT * FROM local_users').get();
  assert.equal(row.salt.length, 16); assert.equal(row.password_hash.length, 32);
  assert.equal(Buffer.from(row.password_hash).includes(Buffer.from('example password')), false);
  assert.throws(() => bootstrap(db, 'another', 'another password'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM local_users').get().n, 1);
  const other = setup(t); bootstrap(other, 'sample', 'example password');
  assert.notDeepEqual(row.salt, other.prepare('SELECT salt FROM local_users').get().salt);
});
test('sign-in validates credentials, deactivation and session clearing', t => {
  const db = setup(t); bootstrap(db, 'sample', 'example password');
  const session = createSession(db);
  assert.equal(session.currentUserId(), null);
  assert.equal(session.signIn({ username: 'sample', password: 'example password' }).ok, true);
  assert.equal(session.currentUserId(), null);
  assert.equal(session.selectWaiter({ id: 1, pin: '' }).ok, true);
  assert.equal(session.currentUserId(), 1);
  assert.deepEqual(session.signOut(), { ok: true }); assert.equal(session.currentUserId(), null);
  for (const request of [{ username: 'sample', password: 'incorrect' }, { username: 'unknown', password: 'example password' }, {}, null, { username: 'sample', password: 'example password', extra: true }]) {
    assert.deepEqual(session.signIn(request), { ok: false, error: 'Sign in failed' });
    assert.equal(session.currentUserId(), null);
  }
  assert.equal(session.signIn({ username: 'sample', password: 'example password' }).ok, true);
  db.exec('UPDATE local_users SET active = 0');
  assert.equal(session.currentUserId(), null);
  assert.deepEqual(session.signIn({ username: 'sample', password: 'example password' }), { ok: false, error: 'Sign in failed' });
});
test('bridge rejects untrusted senders and malformed requests', t => {
  const db = setup(t); bootstrap(db, 'sample', 'example password');
  const handlers = {}; const trusted = {};
  const session = registerSession({ handle(channel, handler) { handlers[channel] = handler; } }, event => event === trusted, db);
  assert.equal(handlers['arra:sign-in']({}, { username: 'sample', password: 'example password' }).ok, false);
  assert.equal(session.currentUserId(), null);
  assert.equal(handlers['arra:sign-in'](trusted, { username: 'sample', password: 'example password' }).ok, true);
  assert.equal(handlers['arra:select-waiter'](trusted, { id: 1, pin: '' }).ok, true);
  assert.equal(handlers['arra:sign-out']({}, {}).ok, false);
  assert.equal(session.currentUserId(), 1);
  assert.equal(handlers['arra:sign-out'](trusted, { extra: true }).ok, false);
  assert.equal(handlers['arra:sign-out'](trusted, {}).ok, true);
  assert.equal(session.currentUserId(), null);
});
