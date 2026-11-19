// End-to-end synthetic tests of the real device-mode adapter and trusted
// payment boundary. The fake never opens a serial port or records real data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const { openDatabase } = require('../src/desktop/database');
const { authorizedDatabase } = require('./support/authorized-database');
const { createStatefulPf700 } = require('./support/pf700-stateful-device');
const { createWindowsPf700Checkout } = require('../src/desktop/pf700-windows-checkout');
const { enroll } = require('../src/desktop/pf700-commissioning');
const { seedTables } = require('../src/desktop/tables');
const { seedArraMenu } = require('../src/desktop/arra-menu');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerBills } = require('../src/desktop/bills');
const { registerPayments } = require('../src/desktop/payments');

const windows = { skip: process.platform !== 'win32' };
function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-s096-stateful-'));
  const checked = path.resolve(directory);
  assert.equal(path.dirname(checked), path.resolve(os.tmpdir()));
  assert.ok(path.basename(checked).startsWith('arra-s096-stateful-'));
  const device = createStatefulPf700(options);
  const config = { expectedSerial:device.serial, operatorNumber:2, tillNumber:1,
    operatorPassword:String(randomInt(100000,1000000)), domesticProduct:false };
  let actor = 1, generation = 0, db = authorizedDatabase(openDatabase(checked));
  enroll(db); seedTables(db); seedArraMenu(db);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'sample-other',x'00',x'00');
    INSERT INTO financial_scopes VALUES(2,'waiter');
    INSERT INTO user_permissions VALUES(2,'orders.view'),(2,'orders.change');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO order_waiter_ownership VALUES(1,1,1,1,'open');`);
  const trusted = {}, handlers = {}, ipc = {handle:(channel,fn)=>{handlers[channel]=fn;}};
  const session = {currentUserId:()=>actor,authenticatedUserId:()=>actor,identityGeneration:()=>generation};
  function register() {
    const adapter = createWindowsPf700Checkout(config,device.start);
    registerOrderItems(ipc,event=>event===trusted,db,session);
    registerBills(ipc,event=>event===trusted,db,session,adapter);
    registerPayments(ipc,event=>event===trusted,db,session,null,adapter);
  }
  register();
  const items=request=>handlers['arra:order-items'](trusted,request);
  const bills=request=>handlers['arra:bill'](trusted,request);
  const pay=request=>handlers['arra:payment'](trusted,request);
  assert.equal(items({action:'add',orderId:1,productId:'arra-product-11-0'}).ok,true);
  assert.equal(items({action:'send',orderId:1,requestId:'synthetic-send'}).ok,true);
  const view=bills({action:'review',orderId:1});
  const generated=bills({action:'generate',orderId:1,fingerprint:view.data.fingerprint});
  assert.equal(generated.ok,true);
  const req={billId:generated.data.id,method:'cash',account:'A'};
  t.after(()=>{db.close();fs.rmSync(checked,{recursive:true,force:true});});
  return { device, config, req, pay, bills, get db(){return db;},
    openOtherConnection() {return openDatabase(checked);},
    untrusted:request=>handlers['arra:payment']({},request),
    switchActor(value) {actor=value;generation++;},
    restart() {db.close();db=openDatabase(checked);register();} };
}

test('daily report and cash preparation exclude each other across database connections', windows, t => {
  for (const reportFirst of [true,false]) {
    const f=fixture(t), other=f.openOtherConnection();
    try {
      const dayId=other.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id;
      const reserveReport=()=>other.prepare(`INSERT INTO fiscal_daily_reports
        (day_id,actor_id,mode,device_id,expected,previous_closure,previous_document,device_date,started_at)
        VALUES(?,1,'device',?,'{}',0,'0000001','010120',1)`).run(dayId,f.device.serial);
      if (reportFirst) {
        reserveReport();
        const result=f.pay({...f.req,preparePhysicalCash:true});
        assert.equal(result.fiscalStatus,'blocked');
        assert.equal(f.db.prepare('SELECT count(*) n FROM pf700_cash_open_intents').get().n,0);
        assert.throws(()=>f.db.prepare("INSERT INTO pf700_cash_intents(bill_id,actor_id,device_id,receipt,created_at) VALUES(?,1,?,'{}',1)")
          .run(f.req.billId,f.device.serial),/Invalid PF700 cash intent/);
        const closeId=other.prepare("INSERT INTO account_a_closes(day_id,actor_id,closed_at,snapshot) VALUES(?,1,1,'{}')").run(dayId).lastInsertRowid;
        other.prepare("INSERT INTO fiscal_daily_confirmations(day_id,close_id,actor_id,report_number,document_number,confirmed_at) VALUES(?,?,1,'0001','0000002',1)").run(dayId,closeId);
        assert.equal(other.prepare('SELECT count(*) n FROM fiscal_daily_confirmations').get().n,1);
      } else {
        assert.equal(f.pay({...f.req,preparePhysicalCash:true}).ok,true);
        assert.throws(reserveReport,/Resolve current checkout/);
        assert.equal(other.prepare('SELECT count(*) n FROM fiscal_daily_reports').get().n,0);
      }
      assert.equal(f.device.transcript.length,0);
    } finally {other.close();}
  }
});

for (const [command,mode] of [[48,'before'],[48,'after'],[49,'before'],[49,'after'],
  [53,'before'],[53,'after'],[56,'before'],[56,'after']]) {
  test(`trusted device checkout holds after command ${command} ${mode} execution across restart`, windows, async t => {
    const f=fixture(t);
    const prepared=f.pay({...f.req,preparePhysicalCash:true});
    assert.equal(prepared.ok,true);
    assert.equal(f.device.transcript.length,0,'preparation never probes the printer');
    f.device.fault(command,mode);
    const start={...f.req,physicalIntentId:prepared.data.intentId};
    assert.equal((await f.pay(start)).fiscalStatus,'uncertain');
    const last=f.device.transcript.at(-1);
    assert.equal(last.command,command);
    assert.equal(last.effect,mode === 'before'?'dropped-before':'executed-reply-lost');
    const originalCalls=f.device.transcript.length;
    const ledger=f.db.prepare(`SELECT c.command,c.sequence,c.request_hash AS requestHash,a.response_hash AS responseHash
      FROM pf700_command_intents c LEFT JOIN pf700_command_acks a ON a.command_id=c.id ORDER BY c.id`).all();
    assert.deepEqual(ledger.map(({command,sequence})=>({command,sequence})),
      f.device.transcript.map(({command,sequence})=>({command,sequence})));
    assert.equal(ledger.at(-1).responseHash,null,'lost reply stays unacknowledged');
    assert.ok(ledger.slice(0,-1).every(row=>/^[a-f0-9]{64}$/.test(row.responseHash)));
    assert.ok(ledger.every(row=>row.command === 48 ? row.requestHash === null : /^[a-f0-9]{64}$/.test(row.requestHash)));
    f.restart();
    assert.equal(f.pay({...f.req,releasePhysicalCash:true}).fiscalStatus,'uncertain');
    assert.equal((await f.pay(start)).fiscalStatus,'uncertain');
    assert.equal(f.pay({...f.req,account:'B'}).fiscalStatus,'selection');
    assert.equal(f.pay({...f.req,method:'card'}).fiscalStatus,'selection');
    assert.equal(f.untrusted(start).ok,false);
    f.switchActor(2);
    assert.equal(f.pay({...f.req,releasePhysicalCash:true}).ok,false);
    f.switchActor(1);
    assert.equal(f.device.transcript.length,originalCalls,'no retry or inquiry reaches the printer');
    assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_checkout_attempts').get().n,1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM pf700_cash_open_intents').get().n,1);
  });
}

test('released pre-dispatch intent cannot be revived by a delayed start request', windows, async t => {
  const f=fixture(t);
  const prepared=f.pay({...f.req,preparePhysicalCash:true});
  assert.equal(prepared.ok,true);
  assert.equal(f.pay({...f.req,releasePhysicalCash:true}).ok,true);
  f.restart();
  assert.equal((await f.pay({...f.req,physicalIntentId:prepared.data.intentId})).ok,false);
  assert.equal(f.device.transcript.length,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,0);
});

test('supported legacy printer completes once with a semantically checked subtotal in the ledger', windows, async t => {
  const f=fixture(t,{legacy:true});
  const prepared=f.pay({...f.req,preparePhysicalCash:true});
  assert.equal(prepared.ok,true);
  const result=await f.pay({...f.req,physicalIntentId:prepared.data.intentId});
  assert.equal(result.ok,true);
  assert.equal(result.data.fiscal.status,'accepted');
  assert.deepEqual(f.device.transcript.map(row=>row.command),[90,74,76,97,113,48,49,51,103,53,76,56,76,113]);
  const totals=f.db.prepare(`SELECT a.summary FROM pf700_command_intents c JOIN pf700_command_acks a ON a.command_id=c.id WHERE c.command=51`).get();
  assert.deepEqual(JSON.parse(totals.summary),{subtotalMatched:true});
  const open=f.db.prepare(`SELECT c.request_hash AS requestHash,a.summary FROM pf700_command_intents c JOIN pf700_command_acks a ON a.command_id=c.id WHERE c.command=48`).get();
  assert.equal(open.requestHash,null);
  assert.deepEqual(JSON.parse(open.summary),{fiscalReceiptCount:0,reversalCount:0});
  assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,1);
  assert.equal(f.device.state.tenders,1); assert.equal(f.device.state.closes,1);
  const before=f.device.transcript.length; f.restart();
  assert.equal((await f.pay(f.req)).ok,true);
  assert.equal(f.device.transcript.length,before,'repeating an acknowledged checkout does not write the printer');
  assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,1);
});
