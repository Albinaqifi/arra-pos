const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { registerBusinessDays } = require('../src/desktop/business-days');

function fixture(t, adapter) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-day-recovery-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01'); INSERT INTO user_permissions VALUES(1,'business_days.close'); INSERT INTO financial_scopes VALUES(1,'combined');");
  let handler;
  registerBusinessDays({ handle: (_, fn) => { handler = fn; } }, () => true, db,
    { currentUserId: () => 1, authenticatedUserId: () => 1 }, adapter);
  return { db, call: request => handler({}, request), day: db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id };
}

test('failure reserving the print attempt rolls back the entire close', async t => {
  let calls = 0;
  const { db, call, day } = fixture(t, () => { calls++; return 'accepted'; });
  db.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON day_print_attempts BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  assert.equal(call({ action: 'close', dayId: day }).ok, false);
  assert.equal(db.prepare('SELECT count(*) n FROM business_days').get().n, 1);
  assert.equal(db.prepare('SELECT closed_at FROM business_days WHERE id=?').get(day).closed_at, null);
  assert.equal(db.prepare('SELECT count(*) n FROM day_print_jobs').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM day_print_attempts').get().n, 0);
  assert.equal(calls, 0);
  db.exec('DROP TRIGGER injected_failure');
  assert.equal(call({ action: 'close', dayId: day }).ok, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
});

test('retry is refused while the original print is still in progress', async t => {
  let resolvePrint, calls = 0;
  const { db, call, day } = fixture(t, () => { calls++; return new Promise(resolve => { resolvePrint = resolve; }); });
  assert.equal(call({ action: 'close', dayId: day }).ok, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(call({ action: 'retry', dayId: day, requestId: 'retry-1', checked: true }).ok, false);
  assert.equal(db.prepare('SELECT count(*) n FROM day_print_attempts').get().n, 1);
  assert.equal(calls, 1);
  resolvePrint('accepted');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(call({ action: 'list' }).data.days.find(row => row.id === day).printResult, 'accepted');
});
