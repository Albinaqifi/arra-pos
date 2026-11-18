const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { registerBusinessDays } = require('../src/desktop/business-days');

test('retry status requires authorization and survives restart without changing history', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-status-independent-'));
  let db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, {recursive:true, force:true}); });
  db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01'),(2,'restricted',x'01',x'01'); INSERT INTO user_permissions VALUES(1,'business_days.close'),(2,'employees.view'); INSERT INTO financial_scopes VALUES(1,'combined'),(2,'A');");
  let actor = 1, authenticated = 1, sender = true, handler;
  const register = () => registerBusinessDays({handle: (_, fn) => { handler = fn; }}, () => sender, db,
    {currentUserId: () => actor, authenticatedUserId: () => authenticated}, () => 'accepted');
  register();
  const call = req => handler({}, req);
  const day = db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id;
  assert.equal(call({action:'close',dayId:day}).ok, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(call({action:'retry',dayId:day,scope:'A',requestId:'status-check',checked:true}).ok, true);
  await new Promise(resolve => setImmediate(resolve));
  const query = {action:'retryStatus',dayId:day,scope:'A',requestId:'status-check'};
  const before = db.prepare('SELECT (SELECT count(*) FROM payments) AS payments, (SELECT count(*) FROM business_days) AS days, (SELECT count(*) FROM day_print_attempts) AS attempts').get();
  assert.deepEqual(call(query).data, {found:true,result:'accepted'});
  assert.equal(call({...query, extra:true}).ok, false);
  assert.equal(call({...query, requestId:'invalid!'}).ok, false);
  sender = false; assert.equal(call(query).ok, false); sender = true;
  authenticated = 2; assert.equal(call(query).ok, false); authenticated = 1;
  actor = authenticated = 2;
  assert.equal(call(query).ok, false, 'scoped owners cannot request another explicit scope');
  assert.equal(call({action:'retryStatus',dayId:day,requestId:'status-check'}).data.found, false, 'attempt belongs to another actor');
  actor = authenticated = 1;
  db.close(); db = openDatabase(dir); register();
  assert.deepEqual(call(query).data, {found:true,result:'accepted'});
  assert.deepEqual(db.prepare('SELECT (SELECT count(*) FROM payments) AS payments, (SELECT count(*) FROM business_days) AS days, (SELECT count(*) FROM day_print_attempts) AS attempts').get(), before);
});
