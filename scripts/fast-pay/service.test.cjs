// Run against either the extracted new kit or the original RC2 app plus the
// exact two helper exports used by the kit builder. No real profile is opened.
const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {setTimeout:delay} = require('node:timers/promises');
const {authorizedDatabase} = require('../../tests/support/authorized-database');
const root = path.join(__dirname,'../..');
const work = fs.mkdtempSync(path.join(os.tmpdir(),'arra-fast-pay-service-'));
const source = process.env.ARRA_FAST_PAY_APP || path.join(root,'build/reader-rc2-final-qa/program/resources/app');
const desktop = path.join(work,'desktop');
const localData = process.env.LOCALAPPDATA;
let load;
let openingTime = 1000;

before(() => {
  process.env.LOCALAPPDATA = work;
  fs.cpSync(path.join(source,'src/desktop'),desktop,{recursive:true});
  if (!fs.existsSync(path.join(desktop,'fast-pay-service.js'))) {
    assert.equal(require(path.join(source,'package.json')).version,'1.0.10');
    for (const [file,helper] of [['payments','recordPayment'],['fiscal-checkout','acceptedOutcome']]) {
      fs.appendFileSync(path.join(desktop,file+'.js'),'\nmodule.exports.'+helper+'='+helper+';\n');
    }
    fs.copyFileSync(path.join(__dirname,'service.js'),path.join(desktop,'fast-pay-service.js'));
  }
  load = file => require(path.join(desktop,file));
});
after(() => {
  if (localData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = localData;
  fs.rmSync(work,{recursive:true,force:true});
});

const pay = (id,method='cash') => ({billId:id,method,account:'A',fastPay:true});
const goodAdapter = {mode:'device',deviceId:'SYNTHETIC01',domesticProduct:false,requireOrigins:true,fastPayVersion:1,
  canRegister:() => true, registerSale:() => ({status:'failed'})};
function service(db,adapter = goodAdapter) {
  const handlers = {};
  const ipc = {handle(channel,fn) { handlers[channel]=fn; }};
  const trusted = {};
  let actor = 1;
  const session = {currentUserId:() => actor,authenticatedUserId:() => actor,identityGeneration:() => actor};
  const worker = load('fast-pay-service').registerFastPayments(ipc,event => event === trusted,db,session,null,adapter);
  load('bills').registerBills(ipc,() => true,db,session,adapter);
  load('order-items').registerOrderItems(ipc,() => true,db,session);
  return {worker, setActor(id) { actor=id; }, pay:(request,event=trusted) => handlers['arra:payment'](event,request),
    send:(channel,request) => handlers[channel](trusted,request)};
}
function fixture(t,adapter = goodAdapter,beforeTrial = () => {}) {
  const directory = fs.mkdtempSync(path.join(work,'synthetic-'));
  const db = authorizedDatabase(load('database').openDatabase(directory));
  load('pf700-commissioning').enroll(db);
  load('tables').seedTables(db);
  load('arra-menu').seedArraMenu(db);
  db.exec("INSERT OR IGNORE INTO menu_product_fiscal_origin VALUES('arra-product-11-0',1)");
  beforeTrial(db);
  const active = service(db,adapter);
  t.after(() => { active.worker?.stop(); db.close(); });
  function bill(id) {
    db.prepare("INSERT INTO orders(id,table_id,opened_at,status) VALUES(?,?,?,'open')").run(id,id,++openingTime);
    db.prepare("INSERT INTO order_waiter_ownership VALUES(?,1,1,1,'open')").run(id);
    const add = active.send('arra:order-items',{action:'add',orderId:id,productId:'arra-product-11-0'});
    assert.equal(add.ok,true,JSON.stringify(add));
    assert.ok(active.send('arra:order-items',{action:'send',orderId:id,requestId:'synthetic-send-'+id}).ok);
    const review = active.send('arra:bill',{action:'review',orderId:id});
    const result = active.send('arra:bill',{action:'generate',orderId:id,fingerprint:review.data.fingerprint});
    assert.equal(result.data.id,id);
  }
  return {...active,db,directory,bill};
}
async function until(check) {
  const end = Date.now()+4000;
  while (!check()) { assert.ok(Date.now()<end,'Timed out waiting for background receipt'); await delay(10); }
}
function status(db,id) {
  return db.prepare('SELECT receipt_status FROM fast_pay_v1_status WHERE bill_id=?').get(id)?.receipt_status;
}
function ack(receipt,context,number) {
  context.beforeOpen({previousDocumentNumber:String(number-1).padStart(7,'0')});
  const reference = String(number).padStart(7,'0');
  return {status:'accepted',reference,evidence:{documentNumber:reference,fiscalReceiptCount:number,reversalCount:0,
    ...(receipt.method==='card'?{debitAmountMinor:receipt.total*100}:{})}};
}

test('cash and card commit before printer I/O; replay, shifts, audit and full verified Z coverage',async t => {
  let count = 0, release;
  const first = new Promise(resolve => { release=resolve; });
  const f = fixture(t,{...goodAdapter,async registerSale(receipt,context) {
    count++;
    if (count===1) await first;
    return ack(receipt,context,count);
  }});
  f.bill(1); f.bill(2); f.bill(3);
  const cash = f.pay(pay(1)), card = f.pay(pay(2,'card'));
  assert.equal(cash.data.receiptStatus,'queued');
  assert.equal(card.data.receiptStatus,'queued');
  assert.equal(count,0);
  assert.deepEqual(f.pay(pay(1)),cash);
  assert.equal(f.pay(pay(1,'card')).ok,false);
  assert.equal(f.pay({billId:3,method:'cash',account:'B'}).ok,true);
  assert.equal(f.db.prepare("SELECT count(*) n FROM orders WHERE status='completed'").get().n,3);
  assert.equal(f.db.prepare('SELECT count(*) n FROM payment_shifts').get().n,3);
  assert.equal(f.db.prepare("SELECT count(*) n FROM application_audit WHERE entity_type='payment'").get().n,3);
  await until(() => count===1);
  const second = new DatabaseSync(path.join(f.directory,'arra.sqlite'));
  const other = service(second,{...goodAdapter,registerSale() { assert.fail('second worker must wait'); }});
  t.after(() => {other.worker.stop(); second.close();});
  assert.equal(other.pay(pay(1)).data.id,cash.data.id);
  await delay(25);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fast_pay_v1_claims').get().n,1);
  release();
  await until(() => status(f.db,2)==='acknowledged');
  assert.equal(count,2);
  assert.equal(status(f.db,1),'acknowledged');
  assert.equal(status(f.db,3),undefined);
  const records = f.db.prepare("SELECT id AS paymentId,bill_id AS billId,method,amount,account FROM payments WHERE account='A'").all();
  const report = {count:2,cash:records[0].amount,card:records[1].amount,total:records[0].amount+records[1].amount,records};
  assert.equal(load('fiscal-daily-report').describe(f.db,1,report,false,goodAdapter).status,'ready');
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('first trial startup freezes previously generated unpaid RC2 bills even without a journal and never recaptures new bills',t => {
  const f = fixture(t,goodAdapter,db => db.exec(`
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO order_waiter_ownership VALUES(1,1,1,1,'open');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,50,'old-fixture')
  `));
  assert.equal(f.pay(pay(1)).fiscalStatus,'blocked');
  assert.equal(f.pay({billId:1,method:'cash',account:'B'}).fiscalStatus,'blocked');
  f.bill(2);
  f.worker.stop();
  const restarted = service(f.db);
  t.after(() => restarted.worker.stop());
  assert.equal(restarted.pay(pay(2)).ok,true);
  assert.equal(restarted.pay(pay(1,'card')).fiscalStatus,'blocked');
  assert.equal(f.db.prepare('SELECT count(*) n FROM fast_pay_v1_legacy_bills').get().n,1);
  assert.throws(() => f.db.exec('DELETE FROM fast_pay_v1_legacy_bills'));
});

test('older unresolved fiscal attempt holds its own bill; distinct new bill can print without rewriting old history',async t => {
  let calls = 0;
  const f = fixture(t,{...goodAdapter,registerSale(receipt,context) { calls++; return ack(receipt,context,2); }});
  f.bill(1); f.bill(2);
  f.db.prepare("INSERT INTO fiscal_checkout_sales VALUES(1,1,'device',?,'cash','{}',1)").run(goodAdapter.deviceId);
  f.db.exec('INSERT INTO fiscal_checkout_attempts VALUES(1,1,1)');
  assert.equal(f.pay(pay(1)).fiscalStatus,'blocked');
  assert.equal(f.pay(pay(2)).ok,true);
  await until(() => status(f.db,2)==='acknowledged');
  assert.equal(calls,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_checkout_results').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_checkout_attempts').get().n,1);
  assert.equal(f.db.prepare("SELECT status FROM orders WHERE id=1").get().status,'open');
  assert.equal(f.db.prepare('SELECT count(*) n FROM payments WHERE bill_id=1').get().n,0);
  assert.equal(f.db.prepare('SELECT document_number n FROM fast_pay_v1_status WHERE bill_id=2').get().n,'0000002');
});

test('restart drains never-attempted jobs only; ambiguous, unplugged and incomplete acknowledgements remain paid',async t => {
  const f = fixture(t);
  for (let id=1;id<=4;id++) { f.bill(id); assert.equal(f.pay(pay(id,id===3?'card':'cash')).ok,true); }
  f.worker.stop();
  const filename = path.join(f.directory,'arra.sqlite');
  const db = new DatabaseSync(filename);
  const calls = [];
  const restarted = service(db,{...goodAdapter,registerSale(receipt,context) {
    calls.push(receipt.billId);
    if (receipt.billId===1) throw Error('synthetic disconnect');
    if (receipt.billId===2) {context.beforeOpen({previousDocumentNumber:'0000030'}); return {status:'uncertain'};}
    if (receipt.billId===3) {
      const result=ack(receipt,context,32); delete result.evidence.debitAmountMinor; return result;
    }
    return ack(receipt,context,32);
  }});
  t.after(() => { restarted.worker.stop(); db.close(); });
  await until(() => status(db,4)==='acknowledged');
  assert.deepEqual(calls,[1,2,3,4]);
  for (const id of [1,2,3]) assert.equal(status(db,id),'unconfirmed');
  restarted.worker.stop();
  const again = service(db,{...goodAdapter,registerSale() { calls.push(-1); }});
  t.after(() => again.worker.stop());
  assert.equal(again.pay(pay(2)).ok,true);
  await delay(40);
  assert.deepEqual(calls,[1,2,3,4]);
  assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,4);
  assert.throws(() => db.exec('DELETE FROM fast_pay_v1_claims'));
});

test('malformed/direct requests, wrong waiter, disabled card, historical replay and outbox failure', t => {
  const f = fixture(t,{...goodAdapter,canRegister:r=>r.method==='cash'});
  f.bill(1); f.bill(2);
  assert.equal(f.pay(pay(1),{}).ok,false);
  for (const req of [{...pay(1),amount:9},{...pay(1,'card'),account:'B'}, {...pay(1),preparePhysicalCash:true},
    {billId:1,method:'card',account:'A',preparePhysicalCard:true},{billId:1,method:'cash',account:'A'}]) assert.equal(f.pay(req).ok,false);
  f.setActor(2); assert.equal(f.pay(pay(1)).error,'Access denied'); f.setActor(1);
  assert.equal(f.pay(pay(1,'card')).fiscalStatus,'scope');
  f.db.exec("CREATE TRIGGER inject_failure BEFORE INSERT ON fast_pay_v1_jobs BEGIN SELECT RAISE(ABORT,'fixture'); END");
  assert.equal(f.pay(pay(1)).ok,false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,0);
  assert.equal(f.db.prepare("SELECT status FROM orders WHERE id=1").get().status,'open');
  f.db.exec('DROP TRIGGER inject_failure');
  const total = f.db.prepare('SELECT total FROM bills WHERE id=2').get().total;
  f.db.prepare("INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(2,1,2,?,'cash','A')").run(total);
  f.db.exec("UPDATE orders SET status='completed' WHERE id=2");
  assert.equal(f.pay(pay(2)).data.receiptStatus,'previously-paid');
  assert.equal(f.db.prepare('SELECT count(*) n FROM fast_pay_v1_jobs').get().n,0);
});

test('post-payment and pre-payment backups of the same order cannot resend or change its tender',async t => {
  let attempts = 0;
  const adapter = {...goodAdapter,registerSale(receipt,context) {attempts++; return ack(receipt,context,1);}};
  const f = fixture(t,adapter);
  f.bill(1);
  const before = path.join(f.directory,'before-payment.db'), queued = path.join(f.directory,'before-dispatch.db');
  f.db.prepare('VACUUM INTO ?').run(before);
  assert.equal(f.pay(pay(1,'card')).ok,true);
  f.db.prepare('VACUUM INTO ?').run(queued);
  await until(() => status(f.db,1)==='acknowledged');
  f.worker.stop();
  for (const [backup,alreadyPaid] of [[queued,true],[before,false]]) {
    const db = new DatabaseSync(backup), restored = service(db,adapter);
    try {
      if (alreadyPaid) {
        await until(() => status(db,1)==='unconfirmed');
        assert.equal(restored.pay(pay(1,'card')).ok,true);
        assert.equal(restored.pay(pay(1)).ok,false);
      } else {
        assert.equal(restored.pay(pay(1,'card')).fiscalStatus,'blocked');
        assert.equal(restored.pay(pay(1)).fiscalStatus,'blocked');
        assert.equal(restored.pay({billId:1,method:'cash',account:'B'}).fiscalStatus,'blocked');
        assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n,0);
      }
      assert.equal(attempts,1);
    } finally { restored.worker.stop(); db.close(); }
  }
});

test('pending Z defers hardware; saved queue starts automatically after Z reconciliation', async t => {
  let attempts = 0;
  const f = fixture(t,{...goodAdapter,registerSale(receipt,context) { attempts++; return ack(receipt,context,1); }});
  f.db.prepare(`INSERT INTO fiscal_daily_reports(day_id,actor_id,mode,device_id,expected,previous_closure,
    previous_document,device_date,started_at) VALUES(1,1,'device',?,'{}',1,'0000001','201126',1)`).run(goodAdapter.deviceId);
  f.bill(1);
  assert.equal(f.pay(pay(1)).ok,true);
  await delay(100);
  assert.equal(attempts,0);
  assert.equal(status(f.db,1),'queued');
  f.db.exec('INSERT INTO fiscal_daily_nonissuances VALUES(1,1,1)');
  await until(() => status(f.db,1)==='acknowledged');
  assert.equal(attempts,1);
});

test('invalid baseline or duplicate document remains unconfirmed and the next new receipt proceeds',async t => {
  const f = fixture(t,{...goodAdapter,registerSale(receipt,context) {
    if (receipt.billId===2) {
      const bad=ack(receipt,context,8);
      bad.reference='0000010'; bad.evidence.documentNumber=bad.reference;
      return bad;
    }
    return ack(receipt,context,receipt.billId===4?2:1);
  }});
  for (let id=1;id<=4;id++) { f.bill(id); assert.ok(f.pay(pay(id)).ok); }
  await until(() => status(f.db,4)==='acknowledged');
  assert.deepEqual([1,2,3,4].map(id=>status(f.db,id)),['acknowledged','unconfirmed','unconfirmed','acknowledged']);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_checkout_verified_results').get().n,2);
});
