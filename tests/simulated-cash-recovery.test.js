const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {openDatabase}=require('../src/desktop/database');
const {authorizedDatabase}=require('./support/authorized-database');
const {seedTables}=require('../src/desktop/tables');
const {seedArraMenu}=require('../src/desktop/arra-menu');
const {registerOrderItems}=require('../src/desktop/order-items');
const {registerBills}=require('../src/desktop/bills');
const {registerPayments}=require('../src/desktop/payments');
const {createTrainingPf700}=require('../src/desktop/training-pf700');

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-s096-training-'));
  let db=authorizedDatabase(openDatabase(dir)), adapter=createTrainingPf700(dir), actor=1;
  seedTables(db); seedArraMenu(db);
  db.exec(`INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO order_waiter_ownership VALUES(1,1,1,1,'open');`);
  const session={currentUserId:()=>actor,authenticatedUserId:()=>actor,identityGeneration:()=>actor};
  let handlers={};
  function register() {
    handlers={};const ipc={handle:(channel,fn)=>{handlers[channel]=fn;}};
    registerOrderItems(ipc,()=>true,db,session);registerBills(ipc,()=>true,db,session,adapter);
    registerPayments(ipc,()=>true,db,session,null,adapter);
  }
  register();
  const call=(channel,request)=>handlers[channel]({},request);
  const items=req=>call('arra:order-items',req), bills=req=>call('arra:bill',req), pay=req=>call('arra:payment',req);
  assert.equal(items({action:'add',orderId:1,productId:'arra-product-11-0',optionIds:[]}).ok,true);
  assert.equal(items({action:'send',orderId:1,requestId:'sample-send'}).ok,true);
  const reviewed=bills({action:'review',orderId:1});
  const generated=bills({action:'generate',orderId:1,fingerprint:reviewed.data.fingerprint});
  assert.equal(generated.ok,true);
  const billId=generated.data.id;
  const req={billId,method:'cash',account:'A'};
  t.after(()=>{db.close();if(dir.startsWith(path.join(os.tmpdir(),'arra-s096-training-')))fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,req,bills,pay,session,get db(){return db;},get adapter(){return adapter;},
    start(stage) {const prepared=pay({...req,prepareSimulatedCash:stage});assert.equal(prepared.ok,true);
      return pay({...req,simulateInterrupt:stage,intentId:prepared.data.intentId});},
    restart(next=createTrainingPf700(dir)){db.close();db=openDatabase(dir);adapter=next;register();},
    setAdapter(next){adapter=next;register();},switchActor(id){actor=id;}};
}
const count=(db,table)=>db.prepare('SELECT count(*) n FROM '+table).get().n;
const stages={before_open:'not_started',after_items:'open_unpaid',after_tender:'tendered',after_close:'closed'};

for(const [interruption,stage] of Object.entries(stages)) test('training recovery: '+interruption,async t=>{
  const f=fixture(t);
  assert.equal(f.bills({action:'review',orderId:1}).data.simulationRecoveryControls,true);
  assert.equal((await f.start(interruption)).fiscalStatus,'uncertain');
  assert.equal(count(f.db,'payments'),0);
  assert.equal(f.pay({...f.req,account:'B'}).fiscalStatus,'selection');
  assert.equal(f.pay({...f.req,method:'card'}).fiscalStatus,'selection');
  f.restart();
  const check={...f.req,checkSimulated:true}, finish={...f.req,finishSimulated:true};
  assert.deepEqual(f.pay(check),{ok:true,data:{stage}});
  assert.deepEqual(f.pay(check),{ok:true,data:{stage}});
  const result=f.pay(finish);assert.equal(result.ok,true);
  assert.equal(result.data.fiscal.status,'accepted');
  assert.deepEqual(f.pay(finish),result);
  f.restart();assert.deepEqual(f.pay(f.req),result);
  assert.equal(count(f.db,'payments'),1);assert.equal(count(f.db,'fiscal_checkout_attempts'),1);
  assert.equal(f.db.prepare('SELECT actor_id FROM payments').get().actor_id,1);
  assert.deepEqual({...f.db.prepare("SELECT count(*) n,min(actor_id) actor FROM application_audit WHERE action='recover' AND entity_type='simulated_fiscal_checkout'").get()},{n:1,actor:1});
  const device=new DatabaseSync(path.join(f.dir,'simulated-pf700.sqlite'),{readOnly:true});
  try {assert.equal(device.prepare('SELECT count(*) n FROM documents WHERE bill=?').get(f.req.billId).n,1);
    assert.deepEqual({...device.prepare('SELECT state,tenders FROM cash_recovery_evidence WHERE bill=?').get(f.req.billId)},{state:'closed',tenders:1});}
  finally {device.close();}
});

test('acknowledgement interruption finishes locally once after restart',async t=>{
  const f=fixture(t);
  assert.equal((await f.start('after_ack')).fiscalStatus,'submitted');
  assert.equal(count(f.db,'payments'),0);f.restart();
  const result=await f.pay(f.req);assert.equal(result.ok,true);
  assert.deepEqual(await f.pay(f.req),result);assert.equal(count(f.db,'payments'),1);
});

test('missing and mismatched device evidence never resolves or changes tender',async t=>{
  const f=fixture(t);assert.equal((await f.start('after_items')).fiscalStatus,'uncertain');
  const device=new DatabaseSync(path.join(f.dir,'simulated-pf700.sqlite'));
  const saved=JSON.parse(device.prepare('SELECT snapshot FROM cash_recovery_evidence').get().snapshot);
  saved.lines[0].name='Different item with the same price';
  device.prepare('UPDATE cash_recovery_evidence SET snapshot=?').run(JSON.stringify(saved));device.close();f.restart();
  assert.equal(f.pay({...f.req,checkSimulated:true}).fiscalStatus,'uncertain');
  assert.equal(f.pay({...f.req,finishSimulated:true}).fiscalStatus,'uncertain');
  assert.equal(f.pay({...f.req,account:'B'}).fiscalStatus,'selection');
  assert.equal(count(f.db,'payments'),0);
});

test('missing device record while first writer is delayed never proves a sale did not start',async t=>{
  const f=fixture(t),training=f.adapter;let release,entered;
  const ready=new Promise(resolve=>{entered=resolve;});
  f.setAdapter({...training,async registerSale(receipt,context){entered();await new Promise(r=>{release=r;});return training.registerSale(receipt,context);}});
  const pending=f.start('before_open');await ready;
  const other=openDatabase(f.dir);let handle;
  registerPayments({handle:(_,fn)=>{handle=fn;}},()=>true,other,f.session,null,training);
  try {
    assert.equal(handle({},{...f.req,checkSimulated:true}).fiscalStatus,'uncertain');
    assert.equal(handle({},{...f.req,finishSimulated:true}).fiscalStatus,'uncertain');
    assert.equal(count(f.db,'payments'),0);release();
    assert.equal((await pending).fiscalStatus,'uncertain');
    assert.deepEqual(handle({},{...f.req,checkSimulated:true}),{ok:true,data:{stage:'not_started'}});
    assert.equal(handle({},{...f.req,finishSimulated:true}).ok,true);
    assert.equal(count(f.db,'payments'),1);
  } finally {other.close();}
});

test('missing separate printer evidence and a changed nonce remain unresolved across restart',async t=>{
  const f=fixture(t);assert.equal((await f.start('after_tender')).fiscalStatus,'uncertain');
  const file=path.join(f.dir,'simulated-pf700.sqlite'), held=path.join(f.dir,'held-simulated-pf700.sqlite');
  fs.renameSync(file,held);f.restart();
  assert.equal(f.pay({...f.req,checkSimulated:true}).fiscalStatus,'uncertain');
  assert.equal(f.pay({...f.req,finishSimulated:true}).fiscalStatus,'uncertain');
  fs.renameSync(held,file);
  const device=new DatabaseSync(file);device.prepare('UPDATE cash_recovery_evidence SET attempt=?').run('a'.repeat(64));device.close();f.restart();
  assert.equal(f.pay({...f.req,checkSimulated:true}).fiscalStatus,'uncertain');
  assert.equal(f.pay({...f.req,finishSimulated:true}).fiscalStatus,'uncertain');
  assert.equal(count(f.db,'payments'),0);
});

test('a second connection completes once while original simulated reply is delayed',async t=>{
  const f=fixture(t),training=f.adapter;let release,issued;
  const ready=new Promise(resolve=>{issued=resolve;});
  f.setAdapter({...training,async registerSale(receipt,context){const result=await training.registerSale(receipt,context);issued();await new Promise(r=>{release=r;});return result;}});
  const pending=f.start('after_items');await ready;
  const other=openDatabase(f.dir);let handle;
  registerPayments({handle:(_,fn)=>{handle=fn;}},()=>true,other,f.session,null,training);
  try {
    assert.deepEqual(handle({},{...f.req,checkSimulated:true}),{ok:true,data:{stage:'open_unpaid'}});
    assert.equal(handle({},{...f.req,finishSimulated:true}).ok,true);
    release();assert.equal((await pending).fiscalStatus,'uncertain');
    assert.equal(count(f.db,'payments'),1);
  } finally {other.close();}
});

test('direct requests reject malformed or physical-profile training controls',async t=>{
  const f=fixture(t);
  assert.equal(f.pay({...f.req,simulateInterrupt:'invalid'}).ok,false);
  assert.equal(f.pay({...f.req,account:'B',checkSimulated:true}).ok,false);
  let calls=0;f.setAdapter({mode:'device',deviceId:'SAMPLE',domesticProduct:false,registerSale:()=>{calls++;return {status:'failed'};}});
  assert.equal(f.pay({...f.req,prepareSimulatedCash:'after_items'}).fiscalStatus,'profile');
  assert.equal(f.pay({...f.req,checkSimulated:true}).fiscalStatus,'profile');
  assert.equal(calls,0);assert.equal(count(f.db,'fiscal_checkout_attempts'),0);
});

test('untrusted callers and commissioned profiles cannot trigger sample failures',async t=>{
  const f=fixture(t);let handle;
  registerPayments({handle:(_,fn)=>{handle=fn;}},()=>false,f.db,f.session,null,f.adapter);
  assert.equal(handle({},{...f.req,prepareSimulatedCash:'after_items'}).ok,false);
  require('../src/desktop/pf700-commissioning').enroll(f.db);
  assert.equal(f.bills({action:'review',orderId:1}).data.simulationRecoveryControls,undefined);
  assert.equal(f.pay({...f.req,prepareSimulatedCash:'after_items'}).fiscalStatus,'profile');
  assert.equal(f.pay({...f.req,checkSimulated:true}).fiscalStatus,'profile');
  assert.equal(count(f.db,'fiscal_checkout_attempts'),0);
});

test('lost finish response can be checked without recording a second payment',async t=>{
  const f=fixture(t);assert.equal((await f.start('after_items')).fiscalStatus,'uncertain');
  assert.equal(f.pay({...f.req,finishSimulated:true}).ok,true);
  const checked=f.pay({...f.req,checkSimulated:true});
  assert.equal(checked.ok,true);assert.equal(checked.data.fiscal.status,'accepted');
  assert.equal(count(f.db,'payments'),1);
});

test('prepared intent survives restart and forbids alternate tender or interruption',async t=>{
  const f=fixture(t),prepare={...f.req,prepareSimulatedCash:'after_items'};
  const first=f.pay(prepare);assert.equal(first.ok,true);
  assert.deepEqual(f.pay(prepare),first);f.restart();
  assert.deepEqual({...f.bills({action:'review',orderId:1}).data.simulatedCashIntent},
    {id:first.data.intentId,interruption:'after_items'});
  assert.equal(f.pay({...f.req,account:'B'}).fiscalStatus,'selection');
  assert.equal(f.pay({...f.req,method:'card'}).fiscalStatus,'selection');
  assert.equal(f.pay({...f.req,prepareSimulatedCash:'after_close'}).fiscalStatus,'selection');
  assert.equal(f.pay({...f.req,simulateInterrupt:'after_close',intentId:first.data.intentId}).fiscalStatus,'selection');
  assert.throws(()=>f.db.exec("INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,1,'cash','B')"));
  assert.throws(()=>f.db.exec("INSERT INTO simulated_card_intents(bill_id,actor_id,amount,created_at) VALUES(1,1,1,1)"));
  assert.equal((await f.pay({...f.req,simulateInterrupt:'after_items',intentId:first.data.intentId})).fiscalStatus,'uncertain');
  assert.equal(f.pay({...f.req,finishSimulated:true}).ok,true);
  assert.equal(count(f.db,'payments'),1);
});
