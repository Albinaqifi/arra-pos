const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { registerBusinessDays } = require('../src/desktop/business-days');

test('direct bill report requests reject invalid identity and inputs and serialize printing', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-a-report-boundary-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample-admin',x'00',x'00'),(2,'sample-a',x'00',x'00'),(3,'sample-b',x'00',x'00');
    INSERT INTO financial_scopes VALUES(1,'combined'),(2,'A'),(3,'B');
    INSERT INTO user_permissions VALUES(1,'employees.view'),(1,'business_days.close'),(2,'employees.view'),(3,'employees.view');`);
  let actor = 1, authenticated = 1, handler, complete, calls = 0;
  const pending = new Promise(resolve => { complete = resolve; });
  registerBusinessDays({handle: (_, fn) => { handler = fn; }}, e => e.allowed, db,
    {currentUserId: () => actor, authenticatedUserId: () => authenticated},
    () => { calls++; return pending; });
  const call = req => handler({allowed:true}, req);
  const day = (await call({action:'accountABillsList'})).data.days[0].id;
  const preview = (await call({action:'accountABillsPreview',dayId:day})).data;
  const request = {action:'accountABillsPrint',dayId:day,digest:preview.digest,language:'en',checked:true};
  for (const invalid of [
    {...request,checked:false}, {...request,digest:'bad'}, {...request,language:'xx'},
    {...request,dayId:0}, {...request,extra:true},
    {action:'accountABillsConfigure',queue:'  '}, {action:'accountABillsConfigure',queue:'bad\nqueue'},
    {action:'accountABillsPreview',dayId:999999}
  ]) assert.equal((await call(invalid)).ok, false);
  actor=2; authenticated=1;
  for (const req of [{action:'accountABillsList'}, {action:'accountABillsPreview',dayId:day}, request, {action:'accountABillsConfigure',queue:'queue'}])
    assert.equal((await call(req)).ok, false);
  actor=3; authenticated=3;
  for (const req of [{action:'accountABillsList'}, {action:'accountABillsPreview',dayId:day}, request])
    assert.equal((await call(req)).ok, false);
  actor=1; authenticated=1;
  const first = call(request);
  const second = await call(request);
  assert.equal(second.busy, true);
  assert.equal(calls, 1);
  complete('accepted');
  assert.equal((await first).accepted, true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM account_a_closes').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM business_days WHERE closed_at IS NOT NULL').get().n, 0);
});
