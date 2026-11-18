const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {openDatabase} = require('../src/desktop/database');
const {registerBusinessDays} = require('../src/desktop/business-days');
const {registerPayments} = require('../src/desktop/payments');
const {registerTransferCorrection} = require('../src/desktop/transfer-correction');

test('real payments and transfer reconcile across two handovers and a day boundary', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'arra-shift-independent-'));
  let db = openDatabase(dir), actor = 1, authenticated = 1, handlers = {};
  const realNow = Date.now;
  t.after(() => { Date.now = realNow; db.close(); fs.rmSync(dir,{recursive:true,force:true}); });
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash,pin_salt,pin_hash) VALUES
    (1,'owner',x'00',x'00',NULL,NULL),(2,'waiter',x'00',x'00',NULL,NULL),(3,'manager',x'00',x'00',x'01',x'01'),(4,'a',x'00',x'00',NULL,NULL),(5,'b',x'00',x'00',NULL,NULL);
    INSERT INTO financial_scopes VALUES(1,'combined'),(2,'waiter'),(4,'A'),(5,'B');
    INSERT INTO user_permissions VALUES(1,'business_days.close'),(2,'orders.view'),(2,'orders.change'),(4,'employees.view'),(5,'employees.view');
    INSERT INTO transfer_managers VALUES(3);
    INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample'),(3,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'),(3,3,1,'open'); INSERT INTO order_waiter_ownership SELECT id,2,2,1,'open' FROM orders WHERE id NOT IN (SELECT order_id FROM order_waiter_ownership);
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,100,'one'),(2,2,1,1,200,'two'),(3,3,1,1,300,'three');`);
  function register() {
    handlers = {};
    const ipc={handle:(channel,fn)=>handlers[channel]=fn};
    const session={currentUserId:()=>actor, authenticatedUserId:()=>authenticated};
    for (const fn of [registerBusinessDays,registerPayments,registerTransferCorrection]) fn(ipc,()=>true,db,session);
  }
  register();
  const call=(channel,req)=>handlers[channel]({},req);
  const as=(id,fn)=>{actor=id; authenticated=id; try{return fn();}finally{actor=authenticated=1;}};
  const day=req=>call('arra:business-days',req);
  const pay=req=>as(2,()=>call('arra:payment',req));
  Date.now=()=>Date.parse('2026-11-18T20:00:00Z');
  assert.equal(pay({billId:1,method:'cash',account:'B'}).ok,true);
  const dayId=day({action:'shiftList'}).data.dayId;
  const first=day({action:'shiftList'}).data.shifts[0];
  Date.now=()=>Date.parse('2026-11-18T22:00:00Z');
  assert.equal(day({action:'shiftClose',shiftId:first.id}).ok,true);
  assert.equal(pay({billId:2,method:'card',account:'B'}).ok,false);
  assert.equal(pay({billId:2,method:'card',account:'A'}).ok,true);
  const second=day({action:'shiftList'}).data.shifts[0];
  assert.equal(second.openedAt,Date.now());
  Date.now=()=>Date.parse('2026-11-19T01:00:00Z');
  assert.equal(day({action:'shiftClose',shiftId:second.id}).ok,true);
  const correction=as(3,()=>call('arra:transfer-correction',{action:'correct',paymentId:1,reason:'sample'}));
  assert.equal(correction.ok,true);
  assert.equal(as(3,()=>call('arra:transfer-correction',{action:'correct',paymentId:1,reason:'sample'})).ok,false);
  assert.equal(as(4,()=>day({action:'shiftList'})).data.shifts.find(x=>x.id===first.id).total,0);
  assert.equal(as(5,()=>day({action:'shiftList'})).data.shifts.find(x=>x.id===first.id).total,100);
  assert.equal(pay({billId:3,method:'cash',account:'A'}).ok,true);
  assert.equal(day({action:'close',dayId}).ok,true);
  await new Promise(resolve=>setImmediate(resolve));
  const snapshot=JSON.parse(db.prepare('SELECT snapshot FROM day_print_jobs WHERE day_id=?').get(dayId).snapshot);
  assert.equal(snapshot.total,600);
  assert.deepEqual(snapshot.records.map(x=>[x.amount,x.account,x.method]),[[100,'A','cash'],[200,'A','card'],[300,'A','cash']]);
  assert.deepEqual(db.prepare('SELECT shift_id,COUNT(*) AS n FROM payment_shifts GROUP BY shift_id ORDER BY shift_id').all().map(x=>x.n),[1,1,1]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM shift_closes').get().n,3);
  assert.equal(as(3,()=>call('arra:transfer-correction',{action:'correct',paymentId:1,reason:'sample'})).ok,false);
  db.close(); db=openDatabase(dir); register();
  assert.equal(day({action:'shiftClose',shiftId:first.id}).data.replayed,true);
  assert.equal(day({action:'shiftClose',shiftId:second.id}).data.replayed,true);
  assert.equal(pay({billId:3,method:'cash',account:'A'}).ok,true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n,3);
  assert.equal(db.prepare('SELECT count(*) AS n FROM restaurant_shifts').get().n,3);
  assert.equal(day({action:'close',dayId}).ok,false);
  assert.equal(day({action:'list'}).data.days.find(x=>x.id===dayId).closedAt,Date.now());
});

test('day close followed by a carried payment and stale handover keeps the new day intact', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-shift-close-order-'));
  const db=openDatabase(dir); t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'owner',x'00',x'00'),(2,'waiter',x'00',x'00');
    INSERT INTO financial_scopes VALUES(1,'combined'),(2,'waiter');
    INSERT INTO user_permissions VALUES(1,'business_days.close'),(2,'orders.view'),(2,'orders.change');
    INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'); INSERT INTO order_waiter_ownership SELECT id,2,2,1,'open' FROM orders WHERE id NOT IN (SELECT order_id FROM order_waiter_ownership);
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,100,'one'),(2,2,1,1,200,'two');`);
  let actor=1,handlers={}; const session={currentUserId:()=>actor,authenticatedUserId:()=>actor};
  for(const register of [registerBusinessDays,registerPayments])register({handle:(name,fn)=>handlers[name]=fn},()=>true,db,session);
  const day=req=>handlers['arra:business-days']({},req),pay=req=>{actor=2;try{return handlers['arra:payment']({},req);}finally{actor=1;}};
  assert.equal(pay({billId:1,method:'cash',account:'A'}).ok,true);
  const old=day({action:'shiftList'}).data, oldShift=old.shifts[0];
  assert.equal(day({action:'close',dayId:old.dayId}).ok,true);
  assert.equal(pay({billId:2,method:'cash',account:'B'}).ok,true);
  const current=day({action:'shiftList'}).data;
  assert.notEqual(current.dayId,old.dayId); assert.equal(current.shifts[0].total,200);
  assert.equal(day({action:'shiftClose',shiftId:oldShift.id}).data.replayed,true);
  assert.equal(day({action:'shiftList'}).data.shifts[0].id,current.shifts[0].id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM restaurant_shifts').get().n,2);
  assert.deepEqual(db.prepare('SELECT business_day_id FROM payment_business_days ORDER BY payment_id').all().map(x=>x.business_day_id),[old.dayId,current.dayId]);
  await new Promise(resolve=>setImmediate(resolve));
});

test('competing payment and close requests reconcile against their original targets', async t => {
  const {Worker}=require('node:worker_threads');
  for (const closeAction of ['shiftClose','close']) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-shift-race-')); let db=openDatabase(dir);
    db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'owner',x'00',x'00'),(2,'waiter',x'00',x'00');
      INSERT INTO financial_scopes VALUES(1,'combined'),(2,'waiter');
      INSERT INTO user_permissions VALUES(1,'business_days.close'),(2,'orders.view'),(2,'orders.change');
      INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample');
      INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'); INSERT INTO order_waiter_ownership SELECT id,2,2,1,'open' FROM orders WHERE id NOT IN (SELECT order_id FROM order_waiter_ownership);
      INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,100,'one'),(2,2,1,1,200,'two');`);
    let handlers={},actor=1;const session={currentUserId:()=>actor,authenticatedUserId:()=>actor};
    for(const register of [registerBusinessDays,registerPayments])register({handle:(name,fn)=>handlers[name]=fn},()=>true,db,session);
    const day=req=>handlers['arra:business-days']({},req),pay=req=>{actor=2;try{return handlers['arra:payment']({},req);}finally{actor=1;}};
    assert.equal(pay({billId:1,method:'cash',account:'A'}).ok,true);
    const old=day({action:'shiftList'}).data, shift=old.shifts[0];
    const closeReq=closeAction==='close'?{action:'close',dayId:old.dayId}:{action:'shiftClose',shiftId:shift.id};
    const paymentReq={billId:2,method:'cash',account:'B'};
    const shared=new SharedArrayBuffer(4);
    const code=`const {parentPort,workerData}=require('node:worker_threads');const db=require(workerData.database).openDatabase(workerData.dir);let fn;const session={currentUserId:()=>workerData.actor,authenticatedUserId:()=>workerData.actor};require(workerData.module)[workerData.register]({handle:(_,h)=>fn=h},()=>true,db,session);parentPort.postMessage('ready');Atomics.wait(new Int32Array(workerData.shared),0,0);const result=fn({},workerData.req);parentPort.postMessage(result);setImmediate(()=>db.close());`;
    const workers=[];
    async function start(module,register,id,req){
      const worker=new Worker(code,{eval:true,workerData:{dir,shared,database:require.resolve('../src/desktop/database'),module:require.resolve(module),register,actor:id,req}});
      workers.push(worker);
      const ready=new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject)});
      const result=new Promise((resolve,reject)=>{worker.on('message',m=>{if(m!=='ready')resolve(m)});worker.once('error',reject)});
      await ready;return {result};
    }
    // Open each connection before starting the other, then release both requests together.
    const w1=await start('../src/desktop/business-days','registerBusinessDays',1,closeReq);

    const w2=await start('../src/desktop/payments','registerPayments',2,paymentReq);
    Atomics.store(new Int32Array(shared),0,1); Atomics.notify(new Int32Array(shared),0,2);
    const [closed,paid]=await Promise.all([w1.result,w2.result]);
    await Promise.all(workers.map(w=>w.terminate()));
    if(!closed.ok) assert.equal(day(closeReq).ok,true);
    if(!paid.ok) assert.equal(pay(paymentReq).ok,true);
    assert.equal(pay(paymentReq).ok,true);
    if(closeAction==='shiftClose') assert.equal(day(closeReq).data.replayed,true);
    else assert.equal(day(closeReq).ok,false);
    assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n,2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM payment_business_days').get().n,2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM payment_shifts').get().n,2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM shift_closes WHERE shift_id=?').get(shift.id).n,1);
    const membership=db.prepare(`SELECT pd.business_day_id AS day, s.day_id AS shiftDay FROM payment_business_days pd JOIN payment_shifts ps ON ps.payment_id=pd.payment_id JOIN restaurant_shifts s ON s.id=ps.shift_id WHERE pd.payment_id=(SELECT id FROM payments WHERE bill_id=2)`).get();
    assert.equal(membership.day,membership.shiftDay);
    if(closeAction==='shiftClose') assert.equal(membership.day,old.dayId);
    const actualShift=db.prepare('SELECT count(*) AS count, COALESCE(sum(p.amount),0) AS total FROM payments p JOIN payment_shifts ps ON ps.payment_id=p.id WHERE ps.shift_id=?').get(shift.id);
    const savedShift=JSON.parse(db.prepare('SELECT snapshot FROM shift_closes WHERE shift_id=?').get(shift.id).snapshot);
    assert.equal(savedShift.A.count+savedShift.B.count,actualShift.count);
    assert.equal(savedShift.A.total+savedShift.B.total,actualShift.total);
    if(closeAction==='close') {
      const actualDay=db.prepare('SELECT count(*) AS count, COALESCE(sum(p.amount),0) AS total FROM payments p JOIN payment_business_days pd ON pd.payment_id=p.id WHERE pd.business_day_id=?').get(old.dayId);
      const savedDay=JSON.parse(db.prepare('SELECT snapshot FROM day_print_jobs WHERE day_id=?').get(old.dayId).snapshot);
      assert.equal(savedDay.records.length,actualDay.count);
      assert.equal(savedDay.total,actualDay.total);
    }
    await new Promise(resolve=>setImmediate(resolve));db.close();fs.rmSync(dir,{recursive:true,force:true});
  }
});


test('racing day and shift closes reconcile the original shift once', async t => {
  const {Worker}=require('node:worker_threads');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-two-closes-'));const db=openDatabase(dir);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'owner',x'00',x'00'); INSERT INTO financial_scopes VALUES(1,'combined'); INSERT INTO user_permissions VALUES(1,'business_days.close');");
  const {markService}=require('../src/desktop/shifts');db.exec('BEGIN IMMEDIATE');markService(db,Date.now());db.exec('COMMIT');
  let call;registerBusinessDays({handle:(_,fn)=>call=fn},()=>true,db,{currentUserId:()=>1,authenticatedUserId:()=>1});
  const initial=call({}, {action:'shiftList'}).data, shiftId=initial.shifts[0].id, dayId=initial.dayId;
  const shared=new SharedArrayBuffer(4),workers=[];
  const code=`const {parentPort,workerData}=require('node:worker_threads');const db=require(workerData.database).openDatabase(workerData.dir);let fn;require(workerData.days).registerBusinessDays({handle:(_,h)=>fn=h},()=>true,db,{currentUserId:()=>1,authenticatedUserId:()=>1});parentPort.postMessage('ready');Atomics.wait(new Int32Array(workerData.shared),0,0);parentPort.postMessage(fn({},workerData.req));setImmediate(()=>db.close());`;
  async function start(req){
    const w=new Worker(code,{eval:true,workerData:{dir,shared,req,database:require.resolve('../src/desktop/database'),days:require.resolve('../src/desktop/business-days')}});workers.push(w);
    const ready=new Promise((resolve,reject)=>{w.once('message',resolve);w.once('error',reject)});
    const result=new Promise((resolve,reject)=>{w.on('message',m=>{if(m!=='ready')resolve(m)});w.once('error',reject)});
    await ready;return {result};
  }
  const dayWorker=await start({action:'close',dayId}),shiftWorker=await start({action:'shiftClose',shiftId});
  Atomics.store(new Int32Array(shared),0,1);Atomics.notify(new Int32Array(shared),0,2);
  const [dayResult,shiftResult]=await Promise.all([dayWorker.result,shiftWorker.result]);await Promise.all(workers.map(w=>w.terminate()));
  if(!dayResult.ok)assert.equal(call({}, {action:'close',dayId}).ok,true);
  if(!shiftResult.ok)assert.equal(call({}, {action:'shiftClose',shiftId}).data.replayed,true);
  assert.equal(call({}, {action:'shiftClose',shiftId}).data.replayed,true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM shift_closes WHERE shift_id=?').get(shiftId).n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM business_days WHERE closed_at IS NULL').get().n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM day_print_jobs WHERE day_id=?').get(dayId).n,1);
  const before=db.prepare('SELECT count(*) AS n FROM restaurant_shifts').get().n;
  assert.equal(call({}, {action:'shiftClose',shiftId}).data.replayed,true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM restaurant_shifts').get().n,before);
  await new Promise(resolve=>setImmediate(resolve));
});
