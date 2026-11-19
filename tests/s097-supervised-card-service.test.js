const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { openDatabase } = require('../src/desktop/database');
const { authorizedDatabase } = require('./support/authorized-database');
const { historicalDatabase } = require('./support/historical-database');
const { enroll, cardTrialLedger } = require('../src/desktop/pf700-commissioning');
const { registerPayments } = require('../src/desktop/payments');
const { registerBills } = require('../src/desktop/bills');
const { registerBusinessDays } = require('../src/desktop/business-days');
const { createBackup, restoreBackup } = require('../src/desktop/backup');
const { seedArraMenu } = require('../src/desktop/arra-menu');
const { seedTables } = require('../src/desktop/tables');

const serial = 'SYNTHETIC01';
const card = {billId:1,method:'card',account:'A'};
const prepare = {...card,preparePhysicalCard:true};
const approve = {...card,physicalCardIntentId:1,confirmPhysicalCard:true};
const dispatch = {...card,physicalCardIntentId:1};
const cashB = {...card,method:'cash',account:'B'};
const settle = {...card,acknowledgedDocument:'0000012'};
function accept(receipt, context) {
  context.beforeOpen({previousDocumentNumber:'0000011'});
  return {status:'accepted',reference:settle.acknowledgedDocument,evidence:{documentNumber:settle.acknowledgedDocument,
    fiscalReceiptCount:1,reversalCount:0,debitAmountMinor:receipt.total * 100}};
}

function setup(t, register = accept) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'arra-s097-service-'));
  const originalLocal = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
  const directory = path.join(root,'db');
  let db = authorizedDatabase(historicalDatabase(50).openDatabase(directory));
  seedTables(db); seedArraMenu(db); enroll(db);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'test-waiter',x'00',x'00');
    INSERT INTO financial_scopes VALUES(2,'waiter');
    INSERT INTO user_permissions VALUES(2,'orders.view'),(2,'orders.change');
    INSERT INTO local_users(id,username,salt,password_hash) VALUES(3,'test-close',x'00',x'00');
    INSERT INTO financial_scopes VALUES(3,'combined');
    INSERT INTO user_permissions VALUES(3,'business_days.close');
    INSERT INTO menu_product_fiscal_origin VALUES('arra-product-11-0',1),('arra-product-12-0',0);
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open');
    INSERT INTO order_waiter_ownership VALUES(1,1,1,1,'open'),(2,1,1,1,'open');
    INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,status) VALUES
      (1,1,'arra-product-11-0','Sample one',70,2,'sent'),(2,1,'arra-product-12-0','Sample two',180,1,'sent'),
      (3,2,'arra-product-12-0','Sample two',180,1,'sent');`);
  db.close(); db = openDatabase(directory);
  t.after(() => {
    db.close();
    if (originalLocal === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = originalLocal;
    fs.rmSync(root,{recursive:true,force:true});
  });
  let actor = 1, generation = 0, calls = 0;
  const ledger = cardTrialLedger();
  const adapter = {mode:'device',deviceId:serial,domesticProduct:false,requireOrigins:true,supervisedCardTrial:true,
    readCardTrial:ledger.read,cardTrialAvailable:()=>ledger.read()===null,
    claimCardTrial:token=>ledger.claim(serial,token),recordCardOutcome:(token,status)=>ledger.outcome(serial,token,status),
    cardDispatchAvailable:token=>ledger.read()?.token===token && ledger.read().outcome==='approved' && !ledger.read().dispatched,
    claimCardDispatch:token=>ledger.dispatch(serial,token),canRegister:receipt=>receipt.method==='card',
    registerSale:(receipt,context)=>{calls++;return register(receipt,context);}};
  let handlers;
  function connect(profile) {
    handlers = {};
    const ipc = {handle:(name,fn)=>{handlers[name]=fn;}};
    const session = {currentUserId:()=>actor,authenticatedUserId:()=>actor,identityGeneration:()=>generation};
    registerPayments(ipc,event=>event===true,db,session,null,profile);
    registerBills(ipc,event=>event===true,db,session,profile);
    registerBusinessDays(ipc,event=>event===true,db,session);
  }
  connect(adapter);
  const review = (orderId=1)=>handlers['arra:bill'](true,{action:'review',orderId}).data;
  for (const orderId of [1,2]) {
    const generated = handlers['arra:bill'](true,{action:'generate',orderId,fingerprint:review(orderId).fingerprint});
    assert.equal(generated.data.id,orderId);
  }
  return {root,directory,ledger,adapter,get db(){return db;},get calls(){return calls;},review,
    pay:(request,event=true)=>handlers['arra:payment'](event,request), day:request=>handlers['arra:business-days'](true,request),
    actor(value){actor=value;generation++;},restart(profile=adapter,dir=directory){db.close();db=openDatabase(dir);connect(profile);}};
}

test('the terminal invitation is unique, bound to the owner and recoverable as approval after restart',async t=>{
  const f=setup(t);
  f.restart(null);
  assert.equal(f.review().physicalCardUnavailable,true);
  assert.equal(f.pay(card).ok,false);
  f.restart();
  assert.equal(f.review().physicalCardAvailable,true);
  assert.equal(f.pay(prepare,false).error,'Invalid request');
  f.actor(2);
  assert.equal(f.pay(prepare).error,'Access denied');
  f.actor(1);
  assert.equal(f.pay(dispatch).ok,false);
  assert.equal(f.pay({...card,account:'B',preparePhysicalCard:true}).ok,false);
  const first=f.pay(prepare);
  assert.equal(first.ok,true);
  assert.equal(first.data.intentId,1);
  assert.match(first.data.declineToken,/^[0-9a-f]{64}$/);
  assert.equal(f.pay(prepare).fiscalStatus,'terminalUnknown');
  assert.equal(f.pay({...prepare,billId:2}).fiscalStatus,'scope');
  assert.equal(f.pay(dispatch).fiscalStatus,'terminalUnknown');
  assert.deepEqual(f.review().physicalCardIntent,{id:1,status:'prepared',profileMatches:true,canDispatch:false});
  assert.equal(f.calls,0);
  f.actor(3);assert.equal(f.day({action:'close',dayId:1}).error,'checkout-unresolved');f.actor(1);
  f.restart(null);
  assert.equal(f.pay(cashB).fiscalStatus,'selection');
  assert.equal(f.review().physicalCardIntent.profileMatches,false);
  assert.equal(f.pay(approve).fiscalStatus,'profile');
  f.restart();
  assert.equal(f.pay({...dispatch,declineToken:first.data.declineToken}).fiscalStatus,'terminalUnknown');
  assert.equal(f.pay(approve).ok,true);
  assert.equal(f.pay(approve).ok,true);
  assert.equal(f.pay({...dispatch,declineToken:first.data.declineToken}).ok,false);
  assert.equal(f.pay(card).fiscalStatus,'selection');
  assert.equal(f.calls,0);
  assert.equal(f.review().physicalCardIntent.canDispatch,true);
  const paid=await f.pay(dispatch);
  assert.equal(paid.ok,true);
  assert.equal(paid.data.fiscal.evidence.debitAmountMinor,32000);
  assert.deepEqual(paid.data.fiscal.receipt.lines.map(x=>[x.quantity,x.unitPrice,x.taxGroup,x.taxRate,x.domesticProduct]),
    [[2,70,'В',10,true],[1,180,'А',18,false]]);
  assert.deepEqual(await f.pay(dispatch),paid);
  f.restart(null);
  assert.deepEqual(f.pay(settle),paid);
  assert.equal(f.calls,1);
  assert.deepEqual({...f.db.prepare('SELECT bill_id,actor_id,method,account,amount FROM payments').get()},
    {bill_id:1,actor_id:1,method:'card',account:'A',amount:320});
  f.actor(3);assert.equal(f.day({action:'close',dayId:1}).ok,true);
  const summary=f.day({action:'accountAList'}).data.days[0];
  assert.deepEqual([summary.count,summary.cash,summary.card,summary.total],[1,0,320,320]);
});

test('only a fresh, confirmed negative result releases the bill; the device trial remains consumed',t=>{
  const f=setup(t);
  const first=f.pay(prepare);
  assert.equal(f.pay({...dispatch,declineToken:'1'.repeat(64)}).fiscalStatus,'terminalUnknown');
  assert.equal(f.pay({...dispatch,declineToken:first.data.declineToken}).ok,true);
  assert.equal(f.pay(approve).ok,false);
  assert.equal(f.pay(dispatch).ok,false);
  assert.equal(f.review().physicalCardIntent,undefined);
  assert.equal(f.pay({...prepare,billId:2}).fiscalStatus,'scope');
  assert.equal(f.pay(cashB).ok,true);
  assert.equal(f.calls,0);
  assert.deepEqual({...f.db.prepare('SELECT method,account,amount FROM payments').get()},{method:'cash',account:'B',amount:320});
});

test('a lost terminal or fiscal response cannot be released, charged or sent again',async t=>{
  let finish;
  const f=setup(t,(_receipt,ctx)=>{
    ctx.beforeOpen({previousDocumentNumber:'0000011'});
    return new Promise(resolve=>{finish=resolve;});
  });
  assert.equal(f.pay(prepare).ok,true);assert.equal(f.pay(approve).ok,true);
  const pending=f.pay(dispatch);
  assert.equal((await f.pay(dispatch)).fiscalStatus,'pending');
  finish({status:'uncertain'});
  assert.equal((await pending).fiscalStatus,'uncertain');
  f.restart();
  for (const request of [dispatch,card,cashB,settle,{...card,prepareSimulated:true},prepare])
    assert.equal((await f.pay(request)).ok,false);
  assert.equal(f.review().fiscal.status,'uncertain');
  assert.equal(f.review().physicalCardIntent.status,'approved');
  assert.equal(f.calls,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payments').get().n,0);
  assert.throws(()=>f.db.prepare("INSERT INTO payments(bill_id,actor_id,method,account,paid_at,amount) VALUES(1,1,'cash','B',10,320)").run());
});

for (const result of ['failed','missing-debit','wrong-debit']) test('no second dispatch after '+result,async t=>{
  const f=setup(t,(receipt,ctx)=>{
    if (result==='failed') return {status:'failed'};
    const reply=accept(receipt,ctx);
    if (result==='missing-debit') delete reply.evidence.debitAmountMinor;
    else reply.evidence.debitAmountMinor++;
    return reply;
  });
  assert.equal(f.pay(prepare).ok,true);assert.equal(f.pay(approve).ok,true);
  assert.equal((await f.pay(dispatch)).ok,false);
  f.restart();assert.equal((await f.pay(dispatch)).ok,false);
  assert.equal(f.pay(cashB).ok,false);
  assert.equal(f.calls,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM payments').get().n,0);
});

test('the saved matching debit acknowledgement can finish locally without another printer request',async t=>{
  const f=setup(t);
  f.pay(prepare);f.pay(approve);
  f.db.exec("CREATE TRIGGER test_interrupt BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT,'interrupted'); END;");
  assert.equal((await f.pay(dispatch)).fiscalStatus,'submitted');
  f.db.exec('DROP TRIGGER test_interrupt');f.restart(null);
  assert.equal(f.pay({...settle,acknowledgedDocument:'0000011'}).fiscalStatus,'uncertain');
  assert.equal(f.pay(cashB).ok,false);
  assert.equal(f.review().fiscal.status,'submitted');
  assert.equal(f.pay(settle).ok,true);
  assert.equal(f.pay(settle).ok,true);
  assert.equal(f.calls,1);
  assert.deepEqual(f.db.prepare("SELECT actor_id FROM application_audit WHERE action='recover' AND entity_type='fiscal_checkout'").all()
    .map(r=>r.actor_id),[1]);
});

test('stale pre-trial, pre-approval and pre-dispatch backups cannot invite payment, dispatch, change tender or close a period',async t=>{
  const f=setup(t), phrase=randomBytes(24).toString('hex');
  const snapshots=[];
  for (const [name,next] of [['before',prepare],['prepared',approve],['approved',dispatch]]) {
    const backup=path.join(f.root,name+'.enc'),destination=path.join(f.root,name);
    await createBackup(f.directory,backup,phrase);
    fs.mkdirSync(destination);restoreBackup(backup,destination,phrase);
    snapshots.push(destination);
    assert.equal((await f.pay(next)).ok,true);
  }
  for (const destination of snapshots) for (const profile of [null,f.adapter]) {
    f.restart(profile,destination);
    assert.equal(f.review().physicalCardHold,true);
    for (const req of [prepare,approve,dispatch,card,cashB,{...cashB,account:'A',preparePhysicalCash:true}])
      assert.equal((await f.pay(req)).fiscalStatus,'cardTrialHold');
    f.actor(3);assert.equal(f.day({action:'close',dayId:1}).error,'checkout-unresolved');f.actor(1);
  }
  assert.equal(f.calls,1);
});
