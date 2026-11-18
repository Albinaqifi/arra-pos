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
  let handler, actor = 1;
  registerBusinessDays({ handle: (_, fn) => { handler = fn; } }, () => true, db,
    { currentUserId: () => actor, authenticatedUserId: () => actor }, adapter);
  return { db, call: request => handler({}, request), setActor: id => { actor = id; }, day: db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id };
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
  assert.equal(call({ action: 'list' }).data.days.find(row => row.id === day).printResult, 'pending');
  assert.equal(call({ action: 'retry', dayId: day, requestId: 'retry-1', checked: true }).ok, false);
  assert.equal(db.prepare('SELECT count(*) n FROM day_print_attempts').get().n, 1);
  assert.equal(calls, 1);
  resolvePrint('accepted');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(call({ action: 'list' }).data.days.find(row => row.id === day).printResult, 'accepted');
});

test('active scoped attempts are pending, while an interrupted attempt is uncertain', async t => {
  let failPrint;
  const { call, day } = fixture(t, job => job.scope === 'combined'
    ? 'accepted'
    : new Promise((_, reject) => { failPrint = reject; }));
  const tick = () => new Promise(resolve => setImmediate(resolve));
  assert.equal(call({ action:'close', dayId:day }).ok, true);
  await tick();
  assert.equal(call({ action:'retry', dayId:day, scope:'A', requestId:'scope-a', checked:true }).ok, true);
  await tick();
  let row = call({ action:'list' }).data.days.find(item => item.id === day);
  assert.equal(row.printResult, 'accepted');
  assert.equal(row.otherPrints.find(item => item.scope === 'A').printResult, 'pending');
  failPrint(new Error('adapter disconnected'));
  await tick();
  row = call({ action:'list' }).data.days.find(item => item.id === day);
  assert.equal(row.printResult, 'accepted');
  assert.equal(row.otherPrints.find(item => item.scope === 'A').printResult, 'uncertain');
});

test('an owner sees only an anonymous sending signal for another scope', async t => {
  let finishB;
  const { db, call, setActor, day } = fixture(t, job => job.scope === 'B'
    ? new Promise(resolve => { finishB = resolve; })
    : job.scope === 'A' ? 'failed' : 'accepted');
  const tick = () => new Promise(resolve => setImmediate(resolve));
  db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'owner',x'01',x'01'); INSERT INTO financial_scopes VALUES(2,'A'); INSERT INTO user_permissions VALUES(2,'employees.view');");
  assert.equal(call({ action:'close', dayId:day }).ok, true);
  await tick();
  assert.equal(call({ action:'retry', dayId:day, scope:'A', requestId:'scope-a-failure', checked:true }).ok, true);
  await tick();
  assert.equal(call({ action:'retry', dayId:day, scope:'B', requestId:'scope-b-pending', checked:true }).ok, true);
  await tick();
  setActor(2);
  const row = call({ action:'list' }).data.days.find(item => item.id === day);
  assert.equal(row.printResult, 'failed');
  assert.equal(row.reportSending, true);
  assert.equal(row.otherPrints.length, 0);
  assert.equal(Object.hasOwn(row, 'lastAttemptId'), false);
  assert.equal(Object.hasOwn(row, 'attemptId'), false);
  assert.equal(call({ action:'retry', dayId:day, requestId:'owner-retry', checked:true }).ok, false);
  finishB('accepted');
  await tick();
});

test('repeated retries for two failed days print the correct saved day without closing another day', async t => {
  const calls = [];
  let outcome = 'failed';
  const { db, call, day: first } = fixture(t, job => { calls.push(job); return outcome; });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  db.exec(`INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,100,'a'),(2,2,1,1,200,'b');
    INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,100,'cash','A');`);
  assert.equal(call({ action:'close', dayId:first }).ok, true);
  await tick();
  const second = db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id;
  db.exec("INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(2,1,2,200,'cash','B');");
  assert.equal(call({ action:'close', dayId:second }).ok, true);
  await tick();
  assert.deepEqual(calls.map(job => [job.snapshot.dayId, job.snapshot.total]), [[first,100], [second,200]]);
  assert.equal(call({ action:'list' }).data.days.find(row => row.id === first).printResult, 'failed');
  assert.equal(call({ action:'list' }).data.days.find(row => row.id === second).printResult, 'failed');
  assert.equal(call({ action:'retry', dayId:first, requestId:'first-retry-1', checked:true }).ok, true);
  await tick();
  assert.equal(call({ action:'retry', dayId:first, requestId:'first-retry-2', checked:true }).ok, true);
  await tick();
  outcome = 'accepted';
  assert.equal(call({ action:'retry', dayId:second, requestId:'second-retry', checked:true }).ok, true);
  await tick();
  assert.equal(call({ action:'retry', dayId:first, requestId:'first-retry-3', checked:true }).ok, true);
  await tick();
  assert.deepEqual(calls.map(job => [job.snapshot.dayId, job.snapshot.total]),
    [[first,100], [second,200], [first,100], [first,100], [second,200], [first,100]]);
  assert.equal(call({ action:'list' }).data.days.find(row => row.id === first).printResult, 'accepted');
  assert.equal(call({ action:'list' }).data.days.find(row => row.id === second).printResult, 'accepted');
  assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n, 2);
  assert.equal(db.prepare('SELECT count(*) n FROM business_days').get().n, 3);
  assert.equal(db.prepare('SELECT count(*) n FROM business_days WHERE closed_at IS NULL').get().n, 1);
});
test('retry status reconciles only the authenticated actor, day and scope',async t=>{
 let finish;const {db,call,setActor,day}=fixture(t,job=>job.scope==='A'?new Promise(resolve=>{finish=resolve}):'accepted');const tick=()=>new Promise(resolve=>setImmediate(resolve));
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'other',x'01',x'01'); INSERT INTO user_permissions VALUES(2,'business_days.close'); INSERT INTO financial_scopes VALUES(2,'combined');");
 assert.equal(call({action:'close',dayId:day}).ok,true);await tick();
 assert.equal(call({action:'retry',dayId:day,scope:'A',requestId:'status-token',checked:true}).ok,true);await tick();
 let status=call({action:'retryStatus',dayId:day,scope:'A',requestId:'status-token'});assert.equal(status.ok,true);assert.equal(status.data.found,true);assert.equal(status.data.result,'pending');
 assert.equal(call({action:'retryStatus',dayId:day,requestId:'status-token'}).data.found,false);
 assert.equal(call({action:'retryStatus',dayId:day+1,scope:'A',requestId:'status-token'}).data.found,false);
 setActor(2);assert.equal(call({action:'retryStatus',dayId:day,scope:'A',requestId:'status-token'}).data.found,false);setActor(1);
 finish('accepted');await tick();status=call({action:'retryStatus',dayId:day,scope:'A',requestId:'status-token'});assert.equal(status.data.result,'accepted');
});
test('an idempotent retry replay reports that no new print was sent',async t=>{
 let sends=0;const {call,day}=fixture(t,()=>{sends++;return 'accepted'});const tick=()=>new Promise(resolve=>setImmediate(resolve));
 assert.equal(call({action:'close',dayId:day}).ok,true);await tick();let req={action:'retry',dayId:day,requestId:'same-request',checked:true};
 assert.equal(call(req).data.replayed,false);await tick();assert.equal(sends,2);const repeated=call(req);assert.equal(repeated.ok,true);assert.equal(repeated.data.replayed,true);await tick();assert.equal(sends,2);
});
