const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { registerBusinessDays } = require('../src/desktop/business-days');

const tick = () => new Promise(resolve => setImmediate(resolve));
function register(db, adapter) {
  let handle;
  registerBusinessDays({ handle: (_, fn) => { handle = fn; } }, () => true, db,
    { currentUserId: () => 1, authenticatedUserId: () => 1 }, adapter);
  return request => handle({}, request);
}

test('failed reports survive restart and retries print only the selected saved day', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-retry-restart-'));
  let db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01');
    INSERT INTO user_permissions VALUES(1,'business_days.close');
    INSERT INTO financial_scopes VALUES(1,'combined');
    INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint)
      VALUES(1,1,1,1,110,'a'),(2,2,1,1,220,'b');
    INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account)
      VALUES(1,1,1,110,'cash','A');`);
  let calls = [], outcome = 'failed';
  let call = register(db, job => { calls.push(job.snapshot); return outcome; });
  const first = db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id;
  assert.equal(call({action:'close', dayId:first}).ok, true);
  await tick();
  const second = db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id;
  db.exec("INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(2,1,2,220,'cash','B')");
  assert.equal(call({action:'close', dayId:second}).ok, true);
  await tick();
  db.close();
  db = openDatabase(dir);
  call = register(db, job => { calls.push(job.snapshot); return outcome; });
  let days = call({action:'list'}).data.days;
  assert.equal(days.find(row => row.id === first).printResult, 'failed');
  assert.equal(days.find(row => row.id === second).printResult, 'failed');
  assert.equal(call({action:'retry', dayId:first, requestId:'retry-one', checked:true}).ok, true);
  await tick();
  assert.equal(call({action:'retry', dayId:first, requestId:'retry-two', checked:true}).ok, true);
  await tick();
  outcome = 'accepted';
  assert.equal(call({action:'retry', dayId:second, requestId:'retry-three', checked:true}).ok, true);
  await tick();
  assert.equal(call({action:'retry', dayId:first, requestId:'retry-four', checked:true}).ok, true);
  await tick();
  assert.deepEqual(calls.map(job => [job.dayId, job.total]),
    [[first,110],[second,220],[first,110],[first,110],[second,220],[first,110]]);
  days = call({action:'list'}).data.days;
  assert.equal(days.find(row => row.id === first).printResult, 'accepted');
  assert.equal(days.find(row => row.id === second).printResult, 'accepted');
  assert.equal(db.prepare('SELECT count(*) n FROM business_days').get().n, 3);
  assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n, 2);
});
