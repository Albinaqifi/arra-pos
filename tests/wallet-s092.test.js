const { removeFiscalSchemaSql } = require('./support/historical-database');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openDatabase}=require('../src/desktop/database');
const {registerBusinessDays}=require('../src/desktop/business-days');
const {registerPayments}=require('../src/desktop/payments');
const {registerTransferCorrection}=require('../src/desktop/transfer-correction');

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-wallet-'));
  let db=openDatabase(dir),actor=1,handlers={};
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash,pin_salt,pin_hash) VALUES(1,'owner',x'00',x'00',NULL,NULL),(2,'waiter',x'00',x'00',NULL,NULL),(3,'manager',x'00',x'00',x'01',x'01'),(4,'a',x'00',x'00',NULL,NULL),(5,'b',x'00',x'00',NULL,NULL),(6,'second-owner',x'00',x'00',NULL,NULL);
    INSERT INTO financial_scopes VALUES(1,'combined'),(2,'waiter'),(4,'A'),(5,'B'),(6,'combined');
    INSERT INTO user_permissions VALUES(1,'business_days.close'),(2,'orders.view'),(2,'orders.change'),(4,'employees.view'),(5,'employees.view'),(6,'business_days.close');
    INSERT INTO transfer_managers VALUES(3);
    INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample'),(3,'sample'),(4,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'),(3,3,1,'open'),(4,4,1,'open'); INSERT INTO order_waiter_ownership SELECT id,2,2,1,'open' FROM orders WHERE id NOT IN (SELECT order_id FROM order_waiter_ownership);
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,9000,'one'),(2,2,1,1,500,'two'),(3,3,1,1,300,'three'),(4,4,1,1,400,'four');`);
  function register() { handlers={}; const ipc={handle:(name,fn)=>handlers[name]=fn},session={currentUserId:()=>actor,authenticatedUserId:()=>actor}; for(const fn of [registerBusinessDays,registerPayments,registerTransferCorrection]) fn(ipc,()=>true,db,session); }
  register();
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  const as=(who,fn)=>{actor=who;try{return fn();}finally{actor=1;}};
  return {day:req=>handlers['arra:business-days']({},req),pay:(billId,method='cash',account='A')=>as(2,()=>handlers['arra:payment']({},{billId,method,account})),correct:paymentId=>as(3,()=>handlers['arra:transfer-correction']({},{action:'correct',paymentId,reason:'sample'})),as,db:()=>db,restart:()=>{db.close();db=openDatabase(dir);register();}};
}

test('wallet handover counts physical cash, rejects stale counts, carries once and persists without changing sales',t=>{
  const f=fixture(t), day=f.day;
  assert.equal(day({action:'walletStatus'}).data.baseline,null);
  const start={action:'walletStart',amount:2000,revision:day({action:'walletStatus'}).data.revision,requestId:'start'};
  assert.equal(day(start).ok,true); assert.equal(day(start).data.replayed,true);
  assert.equal(day({...start,amount:1}).ok,false);
  let s=day({action:'walletStatus'}).data; assert.equal(s.reportable,false); assert.equal(s.expected,2000);
  assert.equal(f.pay(1,'cash','B').ok,true);
  const movement={action:'walletMovement',shiftId:s.shiftId,direction:'out',amount:1000,reason:'Taken to safe',requestId:'move'};
  assert.equal(day(movement).ok,true); assert.equal(day(movement).data.replayed,true);
  s=day({action:'walletStatus'}).data; assert.equal(s.expected,10000);
  assert.equal(f.correct(1).ok,true); assert.equal(day({action:'walletStatus'}).data.revision,s.revision);
  const close={action:'walletShiftClose',shiftId:s.shiftId,counted:9900,retained:2000,revision:s.revision,requestId:'close'};
  assert.equal(f.pay(2,'cash','A').ok,true);
  assert.deepEqual(day(close),{ok:false,error:'stale'});
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM shift_closes').get().n,0);
  s=day({action:'walletStatus'}).data; close.revision=s.revision; close.counted=10400;
  assert.equal(day(close).ok,true); assert.equal(day(close).data.replayed,true);
  const saved=day({action:'shiftList'}).data.shifts.find(x=>x.id===s.shiftId);
  assert.deepEqual([saved.wallet.expected,saved.wallet.counted,saved.wallet.variance,saved.wallet.retained,saved.wallet.taken],[10500,10400,-100,2000,8400]);
  assert.equal(saved.cash,9500); assert.equal(day({action:'walletStatus'}).data.expected,2000);
  assert.equal(day({action:'walletStatus'}).data.reportable,false);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM restaurant_shifts').get().n,2);
  f.restart(); assert.equal(day(close).data.replayed,true); assert.equal(day({action:'walletStatus'}).data.expected,2000);
  for(const who of [4,5]) { assert.equal(f.as(who,()=>day({action:'walletStatus'})).ok,false); assert.equal(f.as(who,()=>day(movement)).ok,false); assert.ok(f.as(who,()=>day({action:'shiftList'})).data.shifts.every(x=>!Object.hasOwn(x,'wallet'))); }
});

test('midshift baseline, zero, card, exact and day close; skipped count stays unknown',t=>{
  const f=fixture(t),day=f.day;
  assert.equal(f.pay(1).ok,true);
  assert.equal(day({action:'walletStart',amount:0,revision:day({action:'walletStatus'}).data.revision,requestId:'zero'}).ok,true);
  let s=day({action:'walletStatus'}).data; assert.equal(s.expected,0); assert.equal(s.openingFloat,null); assert.equal(s.baselineKind,'midshift');
  assert.equal(f.pay(2,'card','A').ok,true); assert.equal(day({action:'walletStatus'}).data.revision,s.revision);
  assert.equal(f.pay(3,'cash','B').ok,true); s=day({action:'walletStatus'}).data; assert.equal(s.expected,300);
  const close={action:'walletDayClose',dayId:s.dayId,shiftId:s.shiftId,counted:300,revision:s.revision,requestId:'day'};
  assert.equal(day(close).ok,true); f.restart(); assert.equal(day(close).data.replayed,true);
  const saved=day({action:'shiftList'}).data.shifts.find(x=>x.id===s.shiftId); assert.equal(saved.wallet.variance,0); assert.equal(saved.wallet.dayClose,true);
  assert.equal(day({action:'walletStatus'}).data.baseline,null);
  assert.equal(f.pay(4).ok,true); const newShift=day({action:'walletStatus'}).data;
  assert.equal(day({action:'shiftClose',shiftId:newShift.shiftId}).ok,true);
  assert.equal(day({action:'shiftList'}).data.shifts.find(x=>x.id===newShift.shiftId).wallet,null);
});

test('a payment during the first count requires a fresh baseline',t=>{
  const f=fixture(t),day=f.day;
  const old=day({action:'walletStatus'}).data;
  assert.equal(f.pay(1,'cash','A').ok,true);
  assert.deepEqual(day({action:'walletStart',amount:2000,revision:old.revision,requestId:'stale-start'}),{ok:false,error:'stale'});
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_baselines').get().n,0);
  const current=day({action:'walletStatus'}).data;
  assert.equal(day({action:'walletStart',amount:2000,revision:current.revision,requestId:'fresh-start'}).ok,true);
  assert.equal(day({action:'walletStatus'}).data.expected,2000);
});

test('idle successor final wallet count is retained without an empty shift report',t=>{
  const f=fixture(t),day=f.day;
  let s=day({action:'walletStatus'}).data;
  assert.equal(day({action:'walletStart',amount:2000,revision:s.revision,requestId:'begin'}).ok,true);
  assert.equal(f.pay(1).ok,true); s=day({action:'walletStatus'}).data;
  assert.equal(day({action:'walletShiftClose',shiftId:s.shiftId,counted:11000,retained:2500,revision:s.revision,requestId:'handover'}).ok,true);
  s=day({action:'walletStatus'}).data; assert.equal(s.reportable,false);
  assert.equal(day({action:'walletDayClose',dayId:s.dayId,shiftId:s.shiftId,counted:2600,revision:s.revision,requestId:'final'}).ok,true);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM shift_closes').get().n,1);
  const records=day({action:'walletHistory'}).data.wallets;
  const last=records.find(x=>x.shiftId===s.shiftId);
  assert.equal(last.reportable,false); assert.equal(last.variance,100); assert.equal(last.dayClose,true);
  assert.equal(f.as(4,()=>day({action:'walletHistory'})).ok,false);
  assert.throws(()=>f.db().exec('UPDATE wallet_closings SET counted=1'));
  assert.throws(()=>f.db().exec('DELETE FROM wallet_closings'));
});

test('v40 upgrade preserves shifts and starts with no wallet counts',t=>{
  const f=fixture(t),day=f.day;
  assert.equal(f.pay(1).ok,true);
  const shift=day({action:'shiftList'}).data.shifts[0];
  f.db().exec(removeFiscalSchemaSql + 'DROP TABLE IF EXISTS order_waiter_ownership; DROP TABLE IF EXISTS legacy_unassigned_orders; DROP TABLE IF EXISTS wallet_cancellations; DROP TABLE IF EXISTS wallet_prepared; DROP TABLE wallet_requests; DROP TABLE wallet_closings; DROP TABLE wallet_movements; DROP TABLE wallet_baselines; DROP TABLE IF EXISTS verified_waiter_pins; PRAGMA user_version=40');
  f.restart();
  assert.equal(f.db().prepare('PRAGMA user_version').get().user_version,48);
  assert.equal(day({action:'shiftList'}).data.shifts[0].id,shift.id);
  assert.equal(day({action:'walletStatus'}).data.baseline,null);
  assert.deepEqual(f.db().prepare('PRAGMA foreign_key_check').all(),[]);
});

test('worked handover example and rollback leave all records unchanged on failure',t=>{
  const f=fixture(t),day=f.day;
  let s=day({action:'walletStatus'}).data;
  assert.equal(day({action:'walletStart',amount:2000,revision:s.revision,requestId:'worked-start'}).ok,true);
  assert.equal(f.pay(1,'cash','B').ok,true); s=day({action:'walletStatus'}).data;
  const movement={action:'walletMovement',shiftId:s.shiftId,direction:'out',amount:1000,reason:'Taken to safe',requestId:'worked-move'};
  assert.equal(day(movement).ok,true); assert.equal(day({...movement,amount:1001}).ok,false);
  s=day({action:'walletStatus'}).data; assert.equal(s.expected,10000);
  const req={action:'walletShiftClose',shiftId:s.shiftId,counted:9900,retained:2000,revision:s.revision,requestId:'worked-close'};
  f.db().exec("CREATE TRIGGER fail_wallet_carry BEFORE INSERT ON wallet_baselines WHEN NEW.kind='carry' BEGIN SELECT RAISE(ABORT,'sample failure'); END");
  assert.equal(day(req).ok,false);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM shift_closes').get().n,0);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_closings').get().n,0);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_requests WHERE request_id=?').get(req.requestId).n,0);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM restaurant_shifts').get().n,1);
  f.db().exec('DROP TRIGGER fail_wallet_carry');
  assert.equal(day(req).ok,true);
  const h=day({action:'walletHistory'}).data.wallets.find(x=>x.shiftId===s.shiftId);
  assert.deepEqual([h.expected,h.counted,h.variance,h.retained,h.taken],[10000,9900,-100,2000,7900]);
  assert.equal(h.movements[0].reason,'Taken to safe');
  assert.equal(day({action:'shiftList'}).data.shifts.find(x=>x.id===s.shiftId).cash,9000);
  assert.equal(day({action:'walletStatus'}).data.expected,2000);
});

test('invalid and unauthorized wallet requests do not mutate records',t=>{
  const f=fixture(t),day=f.day;
  const s=day({action:'walletStatus'}).data;
  for(const value of [-1,1.5,Number.MAX_SAFE_INTEGER+1,'0',null]) assert.equal(day({action:'walletStart',amount:value,revision:s.revision,requestId:'invalid'}).ok,false);
  assert.equal(day({action:'walletStart',amount:0,revision:s.revision,requestId:'zero-ok'}).ok,true);
  const current=day({action:'walletStatus'}).data;
  for(const req of [
    {action:'walletMovement',shiftId:current.shiftId,direction:'in',amount:0,reason:'sample',requestId:'bad1'},
    {action:'walletMovement',shiftId:current.shiftId,direction:'out',amount:1,reason:' ',requestId:'bad2'},
    {action:'walletShiftClose',shiftId:current.shiftId,counted:2,retained:3,revision:current.revision,requestId:'bad3'},
    {action:'walletDayClose',dayId:current.dayId,shiftId:current.shiftId,counted:-1,revision:current.revision,requestId:'bad4'}
  ]) assert.equal(day(req).ok,false);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_movements').get().n,0);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_closings').get().n,0);
});

test('competing payment and counted handover serialize at the cash boundary',async t=>{
  const {Worker}=require('node:worker_threads');
  const f=fixture(t),day=f.day;
  let s=day({action:'walletStatus'}).data;
  assert.equal(day({action:'walletStart',amount:2000,revision:s.revision,requestId:'race-start'}).ok,true);
  assert.equal(f.pay(1).ok,true); s=day({action:'walletStatus'}).data;
  const req={action:'walletShiftClose',shiftId:s.shiftId,counted:11000,retained:2000,revision:s.revision,requestId:'race-close'};
  const dbPath=f.db().location();
  const dir=path.dirname(dbPath),shared=new SharedArrayBuffer(4),workers=[];
  const code=`const {parentPort,workerData}=require('node:worker_threads');const db=require(workerData.db).openDatabase(workerData.dir);let fn;const session={currentUserId:()=>workerData.actor,authenticatedUserId:()=>workerData.actor};require(workerData.module)[workerData.register]({handle:(_,h)=>fn=h},()=>true,db,session);parentPort.postMessage('ready');Atomics.wait(new Int32Array(workerData.shared),0,0);parentPort.postMessage(fn({},workerData.req));setImmediate(()=>db.close());`;
  async function start(module,register,actor,request){
    const worker=new Worker(code,{eval:true,workerData:{dir,shared,db:require.resolve('../src/desktop/database'),module:require.resolve(module),register,actor,req:request}});workers.push(worker);
    const ready=new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject)});
    const result=new Promise((resolve,reject)=>{worker.on('message',m=>{if(m!=='ready')resolve(m)});worker.once('error',reject)});
    await ready;return {result};
  }
  const a=await start('../src/desktop/business-days','registerBusinessDays',1,req);
  const b=await start('../src/desktop/payments','registerPayments',2,{billId:2,method:'cash',account:'A'});
  Atomics.store(new Int32Array(shared),0,1);Atomics.notify(new Int32Array(shared),0,2);
  const [closed,paid]=await Promise.all([a.result,b.result]);
  await Promise.all(workers.map(w=>w.terminate()));
  if (!paid.ok) assert.equal(f.pay(2).ok,true);
  if(closed.ok) {
    assert.equal(day(req).data.replayed,true);
    assert.equal(day({action:'walletStatus'}).data.expected,2500);
  } else {
    assert.equal(day(req).error,'stale');
    assert.equal(f.db().prepare('SELECT count(*) AS n FROM shift_closes').get().n,0);
    assert.equal(day({action:'walletStatus'}).data.expected,11500);
  }
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM payments').get().n,2);
});

test('prepared wallet operations recover lost replies, restart, and enforce actor and payload identity',t=>{
  const f=fixture(t),day=f.day;
  const state=day({action:'walletStatus'}).data;
  const op={action:'walletStart',amount:2000,revision:state.revision,requestId:'journal-start'};
  const prepare={action:'walletPrepare',operation:op};
  const status={action:'walletRequestStatus',requestId:op.requestId},execute={action:'walletExecute',requestId:op.requestId};
  assert.deepEqual(day(status).data,{status:'absent'});
  assert.deepEqual(day(prepare).data,{status:'prepared'});
  assert.deepEqual(day(status).data,{status:'prepared'});
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_baselines').get().n,0);
  assert.equal(day({action:'walletPrepare',operation:{...op,amount:3000}}).ok,false);
  assert.equal(day({...op,amount:3000}).ok,false);
  for(const who of [4,5,6]) {
    assert.equal(f.as(who,()=>day(status)).ok,false);
    assert.equal(f.as(who,()=>day(execute)).ok,false);
    assert.equal(f.as(who,()=>day(prepare)).ok,false);
  }
  f.restart(); assert.equal(day(status).data.status,'prepared');
  assert.equal(day(execute).ok,true);
  assert.equal(day(status).data.status,'completed');
  assert.equal(day(execute).data.replayed,true);
  f.restart(); assert.equal(day(status).data.status,'completed');
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_baselines').get().n,1);
  assert.equal(day({action:'walletPrepare',operation:{action:'walletStatus'}}).ok,false);
  assert.equal(day({action:'walletPrepare',operation:{...op,extra:true}}).ok,false);
  assert.equal(day({action:'walletExecute',requestId:'missing'}).ok,false);
  assert.throws(()=>f.db().exec('DELETE FROM wallet_prepared'));
});

test('journal preserves stale close without applying it and counted day close replays after restart',t=>{
  const f=fixture(t),day=f.day;
  let state=day({action:'walletStatus'}).data;
  const start={action:'walletStart',amount:100,revision:state.revision,requestId:'journal-opening'};
  assert.equal(day({action:'walletPrepare',operation:start}).ok,true);
  assert.equal(day({action:'walletExecute',requestId:start.requestId}).ok,true);
  assert.equal(f.pay(1).ok,true); state=day({action:'walletStatus'}).data;
  const close={action:'walletShiftClose',shiftId:state.shiftId,counted:9100,retained:100,revision:state.revision,requestId:'journal-stale'};
  assert.equal(day({action:'walletPrepare',operation:close}).ok,true);
  assert.equal(f.pay(2).ok,true);
  assert.deepEqual(day({action:'walletExecute',requestId:close.requestId}),{ok:false,error:'stale'});
  assert.equal(day({action:'walletRequestStatus',requestId:close.requestId}).data.status,'prepared');
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM shift_closes').get().n,0);
  state=day({action:'walletStatus'}).data;
  const final={action:'walletDayClose',dayId:state.dayId,shiftId:state.shiftId,counted:9600,revision:state.revision,requestId:'journal-day'};
  assert.equal(day({action:'walletPrepare',operation:final}).ok,true);
  assert.equal(day({action:'walletExecute',requestId:final.requestId}).ok,true);
  f.restart();
  const resolved=day({action:'walletRequestStatus',requestId:final.requestId});
  assert.equal(resolved.data.status,'completed'); assert.equal(resolved.data.result.dayId,final.dayId);
  assert.equal(day({action:'walletExecute',requestId:final.requestId}).data.replayed,true);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_closings').get().n,1);
});

test('two executions of one prepared movement apply it once',async t=>{
  const {Worker}=require('node:worker_threads'),f=fixture(t),day=f.day;
  let state=day({action:'walletStatus'}).data;
  assert.equal(day({action:'walletStart',amount:500,revision:state.revision,requestId:'race-journal-start'}).ok,true);
  state=day({action:'walletStatus'}).data;
  const operation={action:'walletMovement',shiftId:state.shiftId,direction:'in',amount:50,reason:'sample',requestId:'race-journal-move'};
  assert.equal(day({action:'walletPrepare',operation}).ok,true);
  const shared=new SharedArrayBuffer(4),workers=[],dir=path.dirname(f.db().location());
  const code=`const {parentPort,workerData}=require('node:worker_threads');const db=require(workerData.db).openDatabase(workerData.dir);let fn;const session={currentUserId:()=>1,authenticatedUserId:()=>1};require(workerData.module).registerBusinessDays({handle:(_,h)=>fn=h},()=>true,db,session);parentPort.postMessage('ready');Atomics.wait(new Int32Array(workerData.shared),0,0);parentPort.postMessage(fn({},{action:'walletExecute',requestId:'race-journal-move'}));setImmediate(()=>db.close());`;
  async function start() {
    const worker=new Worker(code,{eval:true,workerData:{dir,shared,db:require.resolve('../src/desktop/database'),module:require.resolve('../src/desktop/business-days')}});workers.push(worker);
    const ready=new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject)});
    const result=new Promise((resolve,reject)=>{worker.on('message',m=>{if(m!=='ready')resolve(m)});worker.once('error',reject)});
    await ready;return {result};
  }
  const a=await start(),b=await start();
  Atomics.store(new Int32Array(shared),0,1);Atomics.notify(new Int32Array(shared),0,2);
  const results=await Promise.all([a.result,b.result]); await Promise.all(workers.map(worker=>worker.terminate()));
  assert.ok(results.some(result=>result.ok));
  assert.equal(day({action:'walletExecute',requestId:operation.requestId}).data.replayed,true);
  assert.equal(day({action:'walletRequestStatus',requestId:operation.requestId}).data.status,'completed');
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_movements').get().n,1);
  assert.equal(day({action:'walletStatus'}).data.expected,550);
});

test('a prepared movement can be cancelled after an A owner closes its shift, including after restart',t=>{
  const f=fixture(t),day=f.day;
  let s=day({action:'walletStatus'}).data;
  assert.equal(day({action:'walletStart',amount:500,revision:s.revision,requestId:'cancel-start'}).ok,true);
  assert.equal(f.pay(1).ok,true); s=day({action:'walletStatus'}).data;
  const op={action:'walletMovement',shiftId:s.shiftId,direction:'out',amount:50,reason:'sample',requestId:'cancel-movement'};
  assert.equal(day({action:'walletPrepare',operation:op}).ok,true);
  assert.equal(f.as(4,()=>day({action:'shiftClose',shiftId:s.shiftId})).ok,true);
  f.restart();
  assert.equal(day({action:'walletRequestStatus',requestId:op.requestId}).data.status,'prepared');
  assert.equal(day({action:'walletExecute',requestId:op.requestId}).ok,false);
  assert.equal(f.as(6,()=>day({action:'walletCancel',requestId:op.requestId})).ok,false);
  assert.equal(f.as(4,()=>day({action:'walletCancel',requestId:op.requestId})).ok,false);
  assert.equal(day({action:'walletCancel',requestId:op.requestId}).data.status,'cancelled');
  assert.equal(day({action:'walletCancel',requestId:op.requestId}).data.status,'cancelled');
  f.restart();
  assert.equal(day({action:'walletRequestStatus',requestId:op.requestId}).data.status,'cancelled');
  assert.equal(day({action:'walletPrepare',operation:op}).data.status,'cancelled');
  assert.equal(day({action:'walletExecute',requestId:op.requestId}).ok,false);
  assert.equal(day(op).ok,false);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_movements').get().n,0);
});

test('cancelling a completed operation reports its saved result and never reverses it',t=>{
  const f=fixture(t),day=f.day;
  const s=day({action:'walletStatus'}).data;
  const op={action:'walletStart',amount:100,revision:s.revision,requestId:'completed-before-cancel'};
  assert.equal(day({action:'walletPrepare',operation:op}).ok,true);
  assert.equal(day({action:'walletExecute',requestId:op.requestId}).ok,true);
  const result=day({action:'walletCancel',requestId:op.requestId});
  assert.equal(result.data.status,'completed'); assert.equal(result.data.result.shiftId,day({action:'walletStatus'}).data.shiftId);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_cancellations').get().n,0);
});

test('cancelling and executing concurrently produce one terminal outcome',async t=>{
  const {Worker}=require('node:worker_threads'),f=fixture(t),day=f.day;
  let s=day({action:'walletStatus'}).data;
  assert.equal(day({action:'walletStart',amount:500,revision:s.revision,requestId:'cancel-race-start'}).ok,true);
  s=day({action:'walletStatus'}).data;
  const op={action:'walletMovement',shiftId:s.shiftId,direction:'in',amount:50,reason:'sample',requestId:'cancel-race'};
  assert.equal(day({action:'walletPrepare',operation:op}).ok,true);
  const shared=new SharedArrayBuffer(4),workers=[],dir=path.dirname(f.db().location());
  const code=`const {parentPort,workerData}=require('node:worker_threads');const db=require(workerData.db).openDatabase(workerData.dir);let fn;const session={currentUserId:()=>1,authenticatedUserId:()=>1};require(workerData.module).registerBusinessDays({handle:(_,h)=>fn=h},()=>true,db,session);parentPort.postMessage('ready');Atomics.wait(new Int32Array(workerData.shared),0,0);parentPort.postMessage(fn({},{action:workerData.action,requestId:'cancel-race'}));setImmediate(()=>db.close());`;
  async function start(action) {
    const worker=new Worker(code,{eval:true,workerData:{dir,shared,action,db:require.resolve('../src/desktop/database'),module:require.resolve('../src/desktop/business-days')}});workers.push(worker);
    const ready=new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject)});
    const result=new Promise((resolve,reject)=>{worker.on('message',m=>{if(m!=='ready')resolve(m)});worker.once('error',reject)});
    await ready;return {result};
  }
  const a=await start('walletExecute'),b=await start('walletCancel');
  Atomics.store(new Int32Array(shared),0,1);Atomics.notify(new Int32Array(shared),0,2);
  const results=await Promise.all([a.result,b.result]); await Promise.all(workers.map(worker=>worker.terminate()));
  if (!results.some(result=>result.ok)) assert.equal(day({action:'walletCancel',requestId:op.requestId}).ok,true);
  const status=day({action:'walletRequestStatus',requestId:op.requestId}).data.status;
  assert.ok(['completed','cancelled'].includes(status));
  if(status==='completed') {
    assert.equal(day({action:'walletCancel',requestId:op.requestId}).data.status,'completed');
    assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_movements').get().n,1);
  } else {
    assert.equal(day({action:'walletExecute',requestId:op.requestId}).ok,false);
    assert.equal(f.db().prepare('SELECT count(*) AS n FROM wallet_movements').get().n,0);
  }
});
