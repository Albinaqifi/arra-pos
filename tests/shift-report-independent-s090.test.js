const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { registerBusinessDays } = require('../src/desktop/business-days');
const { markService } = require('../src/desktop/shifts');
const { textForJob } = require('../src/desktop/windows-test-printer');

test('concurrent connections exclude shift retries and recover failed and unknown outcomes without changing financial records', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-s090-independent-'));
  let first = openDatabase(dir), second = openDatabase(dir), actor = 1, release;
  t.after(() => { first.close(); second.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  first.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample-a',x'00',x'00'),(2,'sample-b',x'00',x'00');
    INSERT INTO user_permissions VALUES(1,'employees.view'),(2,'employees.view');
    INSERT INTO financial_scopes VALUES(1,'A'),(2,'B');
    INSERT INTO dining_tables(id,area) VALUES(1,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,150,'sample');
    BEGIN IMMEDIATE;`);
  markService(first, 1000);
  const shiftId = first.prepare('SELECT id FROM restaurant_shifts').get().id;
  first.exec(`INSERT INTO payments(id,bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,2,150,'card','A');
    INSERT INTO payment_shifts VALUES(1,${shiftId}); COMMIT`);
  const jobs = [];
  const adapter = job => { jobs.push(job); return new Promise((resolve, reject) => { release = { resolve, reject }; }); };
  function register(db) {
    let handler;
    registerBusinessDays({handle: (_, fn) => { handler = fn; }}, () => true, db,
      {currentUserId: () => actor, authenticatedUserId: () => actor}, adapter);
    return req => handler({}, req);
  }
  const a = register(first), b = register(second);
  assert.equal(a({action:'shiftClose', shiftId}).ok, true);
  const financialState = () => ({
    shifts: first.prepare('SELECT count(*) n FROM restaurant_shifts').get().n,
    days: first.prepare('SELECT count(*) n FROM business_days WHERE closed_at IS NOT NULL').get().n,
    payments: first.prepare('SELECT count(*) n FROM payments').get().n,
    closes: first.prepare('SELECT count(*) n FROM shift_closes').get().n,
  });
  const before = financialState();
  assert.equal(a({action:'shiftPrint', shiftId, requestId:'first', checked:true}).ok, true);
  assert.equal(b({action:'shiftPrint', shiftId, requestId:'second', checked:true}).ok, false);
  assert.equal(b({action:'shiftPrint', shiftId, requestId:'first', checked:true}).data.replayed, true);
  actor = 2;
  assert.equal(b({action:'shiftPrint', shiftId, requestId:'other', checked:true}).ok, false);
  assert.equal(b({action:'shiftPrintStatus', shiftId, requestId:'first'}).data.found, false);
  await Promise.resolve();
  assert.equal(jobs.length, 1);
  assert.match(textForJob(jobs[0]), /Card: 150 MKD/);
  assert.match(textForJob(jobs[0]), /Cash: 0 MKD/);
  assert.doesNotMatch(textForJob(jobs[0]), /ACCOUNT B/);
  release.resolve('failed');
  await new Promise(resolve => setImmediate(resolve));
  actor = 1;
  assert.equal(a({action:'shiftPrintStatus', shiftId, requestId:'first'}).data.result, 'failed');
  assert.equal(a({action:'shiftPrint', shiftId, requestId:'retry', checked:false}).ok, false);
  assert.equal(a({action:'shiftPrint', shiftId, requestId:'retry', checked:true}).ok, true);
  await Promise.resolve();
  release.reject(new Error('simulated lost outcome'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(a({action:'shiftPrintStatus', shiftId, requestId:'retry'}).data.result, 'uncertain');
  assert.deepEqual(financialState(), before);
  first.close(); second.close();
  first = openDatabase(dir); second = openDatabase(dir);
  const restarted = register(first);
  assert.equal(restarted({action:'shiftList'}).data.shifts.find(s => s.id === shiftId).printResult, 'uncertain');
  assert.equal(restarted({action:'shiftPrintStatus', shiftId, requestId:'retry'}).data.result, 'uncertain');
  assert.equal(restarted({action:'shiftPrint', shiftId, requestId:'retry', checked:true}).data.replayed, true);
  assert.deepEqual(financialState(), before);
});
