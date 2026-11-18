const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDatabase } = require('../src/desktop/database');
const { createBackup, restoreBackup } = require('../src/desktop/backup');
const { registerBusinessDays } = require('../src/desktop/business-days');
const { registerPayments } = require('../src/desktop/payments');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-wallet-independent-'));
  const live = path.join(root, 'live'); fs.mkdirSync(live);
  let db = openDatabase(live), actor = 1, handlers, jobs = [];
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'owner',x'00',x'00'),(2,'waiter',x'00',x'00'),(3,'scoped',x'00',x'00');
    INSERT INTO financial_scopes VALUES(1,'combined'),(2,'waiter'),(3,'A');
    INSERT INTO user_permissions VALUES(1,'business_days.close'),(2,'orders.view'),(2,'orders.change'),(3,'employees.view');
    INSERT INTO dining_tables(id,area) VALUES(1,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,900,'sample');`);
  function register() {
    handlers = {};
    const ipc = {handle: (name, fn) => { handlers[name] = fn; }};
    const session = {currentUserId: () => actor, authenticatedUserId: () => actor};
    registerBusinessDays(ipc, () => true, db, session, job => { jobs.push(job); return 'accepted'; });
    registerPayments(ipc, () => true, db, session);
  }
  register();
  t.after(() => { db.close(); fs.rmSync(root, {recursive:true, force:true}); });
  return {
    root, live, jobs, db: () => db,
    call: req => handlers['arra:business-days']({}, req),
    pay: () => { actor = 2; try { return handlers['arra:payment']({}, {billId:1,method:'cash',account:'A'}); } finally { actor = 1; } },
    as: (id, fn) => { actor = id; try { return fn(); } finally { actor = 1; } },
    use: dir => { db.close(); db = openDatabase(dir); register(); }
  };
}

test('scoped close hides wallet, leaves no invented carry, and restored backup preserves history and replay', async t => {
  const f = fixture(t), call = f.call;
  let state = call({action:'walletStatus'}).data;
  assert.equal(call({action:'walletStart',amount:200,revision:state.revision,requestId:'start'}).ok,true);
  assert.equal(f.pay().ok,true);
  state = call({action:'walletStatus'}).data;
  const movement = {action:'walletMovement',shiftId:state.shiftId,direction:'in',amount:50,reason:'Sample float',requestId:'movement'};
  assert.equal(call(movement).ok,true);
  assert.equal(f.as(3,()=>call({action:'walletHistory'})).ok,false);
  const scoped = f.as(3,()=>call({action:'shiftClose',shiftId:state.shiftId}));
  assert.equal(scoped.ok,true);
  assert.equal(Object.hasOwn(scoped.data.shift,'wallet'),false);
  assert.ok(f.as(3,()=>call({action:'shiftList'})).data.shifts.every(x=>!Object.hasOwn(x,'wallet')));
  state = call({action:'walletStatus'}).data;
  assert.equal(state.baseline,null);
  const history = call({action:'walletHistory'}).data.wallets;
  assert.equal(history.length,1);
  assert.equal(history[0].expected,null);
  assert.equal(history[0].variance,null);
  assert.equal(history[0].movements[0].amount,50);
  const output = path.join(f.root,'sample.enc'), restored = path.join(f.root,'restored');
  const phrase = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(restored);
  await createBackup(f.live,output,phrase);
  restoreBackup(output,restored,phrase);
  f.use(restored);
  assert.equal(f.db().prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(f.db().prepare('PRAGMA foreign_key_check').all(),[]);
  assert.deepEqual(call({action:'walletHistory'}).data.wallets,history);
  assert.equal(call(movement).data.replayed,true);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_movements').get().n,1);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM payments').get().n,1);
});

test('scoped shift printing omits wallet figures from the saved sales snapshot', async t => {
  const f = fixture(t), call = f.call;
  let state = call({action:'walletStatus'}).data;
  assert.equal(call({action:'walletStart',amount:200,revision:state.revision,requestId:'opening'}).ok,true);
  assert.equal(f.pay().ok,true);
  state = call({action:'walletStatus'}).data;
  assert.equal(call({action:'walletShiftClose',shiftId:state.shiftId,counted:1150,retained:200,revision:state.revision,requestId:'close'}).ok,true);
  assert.equal(f.as(3,()=>call({action:'shiftPrint',shiftId:state.shiftId,requestId:'paper',checked:true})).ok,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.jobs.length,1);
  assert.equal(f.jobs[0].scope,'A');
  assert.equal(f.jobs[0].snapshot.cash,900);
  assert.equal(Object.hasOwn(f.jobs[0].snapshot,'wallet'),false);
  assert.doesNotMatch(JSON.stringify(f.jobs[0].snapshot),/1150|variance|retained|baseline|counted/i);
});

for (const scope of ['A','B']) {
  test(`${scope}-scoped day close remains available without wallet access or a fabricated count`, async t => {
    const f = fixture(t), call = f.call;
    f.db().prepare('UPDATE financial_scopes SET scope=? WHERE user_id=3').run(scope);
    let state = call({action:'walletStatus'}).data;
    assert.equal(call({action:'walletStart',amount:100,revision:state.revision,requestId:'start'}).ok,true);
    assert.equal(f.pay().ok,true);
    state = call({action:'walletStatus'}).data;
    const op = {action:'walletDayClose',dayId:state.dayId,shiftId:state.shiftId,counted:1000,revision:state.revision,requestId:'restricted'};
    for (const request of [op,{action:'walletStatus'},{action:'walletHistory'},{action:'walletPrepare',operation:op},{action:'walletExecute',requestId:'restricted'},{action:'walletRequestStatus',requestId:'restricted'},{action:'walletCancel',requestId:'restricted'}]) {
      assert.equal(f.as(3,()=>call(request)).ok,false);
    }
    assert.equal(f.as(3,()=>call({action:'close',dayId:state.dayId})).ok,true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_closings').get().n,0);
    const history = call({action:'walletHistory'}).data.wallets[0];
    assert.equal(history.counted,null);
    assert.equal(history.variance,null);
    assert.equal(call({action:'walletStatus'}).data.baseline,null);
    assert.ok(f.jobs.every(job=>!Object.hasOwn(job.snapshot,'wallet')));
  });
}

test('failure while recording final count rolls back the day and can be retried once', t => {
  const f = fixture(t), call = f.call;
  let state = call({action:'walletStatus'}).data;
  assert.equal(call({action:'walletStart',amount:100,revision:state.revision,requestId:'opening'}).ok,true);
  assert.equal(f.pay().ok,true);
  state = call({action:'walletStatus'}).data;
  const close = {action:'walletDayClose',dayId:state.dayId,shiftId:state.shiftId,counted:1050,revision:state.revision,requestId:'final'};
  assert.equal(f.as(3,()=>call(close)).ok,false);
  f.db().exec("CREATE TRIGGER fail_final_count BEFORE INSERT ON wallet_closings BEGIN SELECT RAISE(ABORT,'sample failure'); END");
  assert.equal(call(close).ok,false);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM business_days WHERE closed_at IS NOT NULL').get().n,0);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM shift_closes').get().n,0);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_closings').get().n,0);
  f.db().exec('DROP TRIGGER fail_final_count');
  assert.equal(call(close).ok,true);
  assert.equal(call(close).data.replayed,true);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM business_days WHERE closed_at IS NOT NULL').get().n,1);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_closings').get().n,1);
  assert.equal(call({action:'walletHistory'}).data.wallets[0].variance,50);
  assert.equal(call({action:'walletStatus'}).data.baseline,null);
});
