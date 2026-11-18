const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('../src/desktop/database');
const { registerBusinessDays } = require('../src/desktop/business-days');

test('Account A PF700 profile and rehearsal enforce scope and succeed with a read-only database', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  migrate(db);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES
    (1,'sample-combined',x'00',x'00'), (2,'sample-a',x'00',x'00'),
    (3,'sample-b',x'00',x'00'), (4,'sample-no-grant',x'00',x'00');
    INSERT INTO financial_scopes VALUES (1,'combined'), (2,'A'), (3,'B'), (4,'combined');
    INSERT INTO user_permissions VALUES
    (1,'business_days.close'), (2,'business_days.close'), (3,'business_days.close');
    PRAGMA query_only=ON;`);

  let selected = 1, authenticated = 1, handler, printCalls = 0;
  const session = { currentUserId: () => selected, authenticatedUserId: () => authenticated };
  registerBusinessDays({ handle: (_, callback) => { handler = callback; } }, event => event.trusted, db,
    session, () => { printCalls++; });

  const request = (action, fields = {}) => handler({ trusted: true }, { action, ...fields });
  const profile = 'accountAPf700Profile';
  const rehearsal = 'accountAPf700Simulate';
  for (const action of [profile, rehearsal]) {
    for (const [user, identity] of [[2, 2], [3, 3], [4, 4], [1, 2], [null, null]]) {
      selected = user;
      authenticated = identity;
      assert.deepEqual(request(action), { ok: false, denied: true });
    }
    selected = authenticated = 1;
    assert.deepEqual(handler({ trusted: false }, { action }), { ok: false });
    for (const fields of [{ port: 'COM5' }, { live: true }, { command: 69 }]) {
      assert.deepEqual(request(action, fields), { ok: false });
    }
  }
  assert.deepEqual(request('accountAPf700Send'), { ok: false });
  assert.deepEqual(request(profile), { ok: true, data: {
    profile: { model: 'Synergy PF700', port: 'COM3', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 },
    hardwareVerified: false
  } });
  const simulated = { ok: true, data: { mode: 'offline', result: 'simulated-response', hardwareVerified: false } };
  assert.deepEqual(request(rehearsal), simulated);
  assert.deepEqual(request(rehearsal), simulated);
  await new Promise(setImmediate);
  assert.equal(printCalls, 0);
});
