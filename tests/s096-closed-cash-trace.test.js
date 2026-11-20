const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomInt, randomBytes, createHash } = require('node:crypto');
const { createStatefulPf700 } = require('./support/pf700-stateful-device');
const { authorizedDatabase } = require('./support/authorized-database');
const { openDatabase } = require('../src/desktop/database');
const { createBackup, restoreBackup } = require('../src/desktop/backup');
const { enroll } = require('../src/desktop/pf700-commissioning');
const { createWindowsPf700Checkout, probeIdentity } = require('../src/desktop/pf700-windows-checkout');
const { executePf700Checkout } = require('../src/desktop/pf700-checkout-protocol');
const { buildReceipt } = require('../src/desktop/fiscal-checkout');
const { seedArraMenu } = require('../src/desktop/arra-menu');
const { seedTables } = require('../src/desktop/tables');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerBills } = require('../src/desktop/bills');
const { registerPayments } = require('../src/desktop/payments');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const selection = { billId:1, method:'cash', account:'A' };
const finish = { ...selection, acknowledgedDocument:'0000002' };
const review = { action:'review', orderId:1 };

// Feed the app's probe, wire encoder, response validators and database callbacks
// through a stateful in-memory PF700. The sender can disappear after its final
// ACK, or pause there while another database connection settles the same bill.
function fixture(t, change = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-closed-trace-'));
  const directory = path.join(root, 'live');
  fs.mkdirSync(directory);
  const connections = new Set();
  const device = createStatefulPf700();
  const adapter = {
    deviceId:device.serial, mode:'device', domesticProduct:false, requireOrigins:true,
    acquireCashObservation() { throw Error('Unexpected device inquiry'); },
    async registerSale(receipt, hooks) {
      if (change.beforeWire) await change.beforeWire();
      const record = change.journal ? change.journal(hooks) : hooks;
      // Include a sequence wrap in every successful reference trace.
      const sequence = 0x7f;
      let probeId, responseHash;
      const identity = await probeIdentity({exchange(frame) {
        probeId = record.beforeCommand({command:90, sequence, requestHash:digest(frame)});
        const reply = device.exchange(frame);
        responseHash = digest(reply);
        return reply;
      }}, sequence, device.serial);
      assert.equal(identity.ok && identity.onsiteFirmware, true);
      record.afterCommand({id:probeId, responseHash, summary:{identityMatched:true, onsiteFirmware:true}});
      const result = await executePf700Checkout(change.wireReceipt?.(receipt) ?? receipt, {
        ...record, firstSequence:0x20, domesticProduct:false, onsiteFirmware:true, operatorNumber:1,
        operatorPassword:String(randomInt(100000,1000000)), tillNumber:1
      }, device.exchange);
      if (change.afterFinal) return change.afterFinal(result);
      throw Error('Inject sender exit before result persistence');
    }
  };
  function connect(profile, source = directory) {
    const db = openDatabase(source);
    connections.add(db);
    const handlers = {};
    const ipc = {handle:(channel,handler) => { handlers[channel] = handler; }};
    const session = {currentUserId:()=>1, authenticatedUserId:()=>1, identityGeneration:()=>1};
    registerOrderItems(ipc, ()=>true, db, session);
    registerBills(ipc, ()=>true, db, session, profile);
    registerPayments(ipc, ()=>true, db, session, null, profile);
    return { db, pay:r=>handlers['arra:payment']({}, r), bill:r=>handlers['arra:bill']({}, r),
      items:r=>handlers['arra:order-items']({}, r), close() { db.close(); connections.delete(db); } };
  }
  t.after(()=>{
    for (const db of connections) db.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('arra-closed-trace-'));
    fs.rmSync(root, {recursive:true, force:true});
  });
  const profile = change.windowsAdapter ? {...createWindowsPf700Checkout({
    expectedSerial:device.serial, domesticProduct:false, operatorNumber:1,
    operatorPassword:String(randomInt(100000,1000000)), tillNumber:1
  }, device.start), requireOrigins:true} : adapter;
  const sender = connect(profile);
  authorizedDatabase(sender.db);
  enroll(sender.db); seedTables(sender.db); seedArraMenu(sender.db);
  sender.db.exec(`INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO order_waiter_ownership VALUES(1,1,1,1,'open');
    INSERT INTO modifier_groups(id,product_id,name,required,active) VALUES('extra','arra-product-11-0','Size',0,1);
    INSERT INTO modifier_options(id,group_id,name,adjustment,active) VALUES('large','extra','Large',10,1)`);
  assert.ok(sender.items({action:'add',orderId:1,productId:'arra-product-11-0',optionIds:['large']}).ok);
  const itemId = sender.items({action:'list',orderId:1}).data.items[0].id;
  assert.ok(sender.items({action:'increment',orderId:1,itemId}).ok);
  assert.ok(sender.items({action:'add',orderId:1,productId:'arra-product-12-0'}).ok);
  assert.ok(sender.items({action:'send',orderId:1,requestId:'synthetic-send'}).ok);
  const fingerprint = sender.bill(review).data.fingerprint;
  assert.equal(sender.bill({action:'generate', orderId:1, fingerprint}).data.total, 340);
  if (change.savedReceipt) {
    const altered = change.savedReceipt(buildReceipt(sender.db, 1, 'cash', 340, profile));
    sender.db.prepare(`INSERT INTO pf700_cash_intents(bill_id,actor_id,device_id,receipt,created_at)
      VALUES(1,1,?,?,1)`).run(device.serial, JSON.stringify(altered));
  }
  const intentId = sender.pay({...selection, preparePhysicalCash:true}).data.intentId;
  return { root, directory, sender, device, connect, start:()=>sender.pay({...selection, physicalIntentId:intentId}) };
}

function counts(db) {
  return ['fiscal_checkout_results','payments'].map(table=>db.prepare('SELECT count(*) n FROM ' + table).get().n);
}

function recoveryActors(db) {
  return db.prepare("SELECT actor_id FROM application_audit WHERE action='recover' AND entity_type='fiscal_checkout'")
    .all().map(row=>row.actor_id);
}

test('reopened bill projects the exact closed receipt and settles it once offline across two connections', async t => {
  const f = fixture(t);
  assert.equal((await f.start()).fiscalStatus, 'uncertain');
  f.sender.close();
  const one = f.connect(null), two = f.connect(null);
  const saved = one.bill(review).data;
  assert.equal(saved.fiscal.status, 'submitted');
  assert.equal(saved.fiscal.reference, '0000002');
  assert.deepEqual(saved.fiscal.evidence, {documentNumber:'0000002', fiscalReceiptCount:1, reversalCount:0});
  assert.equal(saved.fiscal.receipt.total, 340);
  assert.deepEqual(saved.fiscal.receipt.lines.map(i=>[i.quantity, i.taxRate, i.domesticProduct]),
    [[2,10,true], [1,18,false]]);
  assert.deepEqual(counts(one.db), [0,0], 'review is read-only');
  assert.equal(one.pay({...finish, acknowledgedDocument:'0000003'}).ok, false);
  assert.deepEqual(counts(one.db), [0,0]);
  const before = f.device.transcript.length;
  const first = one.pay(finish), repeated = two.pay(finish);
  assert.ok(first.ok);
  assert.equal(repeated.data.id, first.data.id);
  assert.deepEqual(counts(two.db), [1,1]);
  assert.equal(two.db.prepare('SELECT amount FROM payments').get().amount, 340);
  assert.equal(f.device.transcript.length, before);
  assert.equal(f.device.state.tenders, 1);
  assert.equal(f.device.state.closes, 1);
});

test('a delayed sender returns the original payment after another session finishes its validated trace', async t => {
  let ready, release;
  const ack = new Promise(resolve=>{ ready=resolve; });
  const resume = new Promise(resolve=>{ release=resolve; });
  const f = fixture(t, {async afterFinal(result) { ready(); await resume; return result; }});
  const original = f.start();
  await ack;
  const recovering = f.connect(null);
  const recovered = recovering.pay(finish);
  release();
  const returned = await original;
  assert.ok(recovered.ok && returned.ok);
  assert.equal(returned.data.id, recovered.data.id);
  assert.deepEqual(counts(f.sender.db), [1,1]);
  assert.deepEqual(recoveryActors(f.sender.db), [1]);
  assert.equal(f.device.state.tenders, 1);
  assert.equal(f.device.state.closes, 1);
});

test('ordinary live receipt completion creates only the payment record audit', async t => {
  const f = fixture(t, {afterFinal:result=>result});
  assert.ok((await f.start()).ok);
  assert.deepEqual(counts(f.sender.db), [1,1]);
  assert.deepEqual(recoveryActors(f.sender.db), []);
  assert.equal(f.sender.db.prepare("SELECT count(*) n FROM application_audit WHERE action='record' AND entity_type='payment'").get().n, 1);
});

for (const savedResult of [false,true]) {
  test('separate Cash A invocation audits recovery once with ' + (savedResult ? 'a saved result' : 'only the final ACK'), async t => {
    const f = fixture(t, savedResult ? {afterFinal:result=>result} : {});
    if (savedResult) f.sender.db.exec(`CREATE TEMP TRIGGER interrupt_payment BEFORE INSERT ON payments
      BEGIN SELECT RAISE(ABORT,'synthetic interruption'); END`);
    assert.equal((await f.start()).ok, false);
    assert.deepEqual(counts(f.sender.db), [Number(savedResult),0]);
    f.sender.close();
    const separate = f.connect(null);
    const request = savedResult ? {...selection, physicalIntentId:1} : selection;
    assert.equal(separate.pay(request).ok, true);
    assert.equal(separate.pay(request).ok, true);
    assert.deepEqual(recoveryActors(separate.db), [1]);
    assert.deepEqual(counts(separate.db), [1,1]);
    assert.equal(f.device.state.tenders, 1);
  });
}

test('real Windows checkout adapter ACKs reconstruct after the final result insert fails', {skip:process.platform!=='win32'}, async t => {
  const f = fixture(t, {windowsAdapter:true});
  f.sender.db.exec(`CREATE TEMP TRIGGER crash_before_result BEFORE INSERT ON fiscal_checkout_results
    BEGIN SELECT RAISE(ABORT,'synthetic interruption'); END`);
  assert.equal((await f.start()).fiscalStatus, 'uncertain');
  f.sender.close();
  const restarted = f.connect(null);
  assert.equal(restarted.bill(review).data.fiscal.status, 'submitted');
  assert.equal(restarted.pay(finish).ok, true);
  assert.deepEqual(counts(restarted.db), [1,1]);
  assert.equal(f.device.state.tenders, 1);
  assert.equal(f.device.state.closes, 1);
});

test('restoring a reservation without OPEN cannot prove no sale occurred on the same printer', async t => {
  let reserved, release;
  const atReservation = new Promise(resolve=>{ reserved=resolve; });
  const startWire = new Promise(resolve=>{ release=resolve; });
  const f = fixture(t, {async beforeWire() { reserved(); await startWire; }});
  const original = f.start();
  await atReservation;
  const backup = path.join(f.root, 'snapshot.arra');
  const passphrase = randomBytes(24).toString('hex');
  try {
    await createBackup(f.directory, backup, passphrase);
  } finally {
    release();
  }
  await original;
  assert.equal(f.device.state.closes, 1);
  assert.equal(f.sender.bill(review).data.fiscal.status, 'submitted');
  const restored = path.join(f.root, 'restored');
  fs.mkdirSync(restored);
  restoreBackup(backup, restored, passphrase);
  const recovered = f.connect(null, restored);
  assert.equal(recovered.db.prepare('SELECT count(*) n FROM pf700_cash_dispatches').get().n, 1);
  assert.equal(recovered.db.prepare('SELECT count(*) n FROM pf700_command_intents').get().n, 0);
  assert.equal(recovered.bill(review).data.fiscal.status, 'uncertain');
  assert.equal(recovered.pay({...selection, releasePhysicalCash:true}).fiscalStatus, 'uncertain');
  assert.equal(recovered.pay(finish).fiscalStatus, 'uncertain');
  assert.deepEqual(counts(recovered.db), [0,0]);
  assert.equal(f.device.state.tenders, 1);
});

// Alter recorded facts on the way into this synthetic ledger. The actual
// append-only schema and device-mode payment guards remain in force.
function modifyJournal(transform) {
  return hooks => {
    let current, index = 0;
    return { ...hooks,
      beforeCommand(request) {
        current = request.command;
        const altered = transform('request', current, ++index, request) ?? request;
        return hooks.beforeCommand(altered);
      },
      afterCommand(ack) {
        const altered = transform('ack', current, index, ack);
        if (altered !== false) hooks.afterCommand(altered ?? ack);
      }
    };
  };
}

for (const [condition, change] of [
  ['saved modifiers differing from the bill despite an identical wire total', {savedReceipt:r=>({...r,lines:r.lines.map(line=>({...line,modifiers:[]}))})}],
  ['different item with the same amount and VAT', {wireReceipt:r=>({...r,lines:r.lines.map((line,i)=>i ? line : {...line,name:'Test replacement'})})}],
  ['reversed item order', {wireReceipt:r=>({...r,lines:[...r.lines].reverse()})}],
  ['different domestic mark', {wireReceipt:r=>({...r,lines:r.lines.map(line=>({...line,domesticProduct:!line.domesticProduct}))})}],
  ['lost final document ACK', {journal:modifyJournal((kind,command,index)=>kind==='ack' && command===113 && index>5 ? false : undefined)}],
  ['unverified printer identity', {journal:modifyJournal((kind,cmd,i,ack)=>kind==='ack' && cmd===90 ? {...ack,summary:{identityMatched:false,onsiteFirmware:true}} : undefined)}],
  ['wrong tender request', {journal:modifyJournal((kind,cmd,i,r)=>kind==='request' && cmd===53 ? {...r,requestHash:'a'.repeat(64)} : undefined)}],
  ['unpaid state after tender', {journal:modifyJournal((kind,cmd,i,a)=>kind==='ack' && a.summary?.state==='open_paid' ? {...a,summary:{...a.summary,state:'open_unpaid'}} : undefined)}],
  ['mismatched close counter', {journal:modifyJournal((kind,cmd,i,a)=>kind==='ack' && cmd===56 ? {...a,summary:{...a.summary,fiscalReceiptCount:2}} : undefined)}],
  ['mismatched final document', {journal:modifyJournal((kind,cmd,i,a)=>kind==='ack' && cmd===113 && i>5 ? {...a,summary:{documentNumber:'0000003'}} : undefined)}],
  ['out-of-sequence command', {journal:modifyJournal((kind,cmd,i,r)=>kind==='request' && cmd===97 ? {...r,sequence:r.sequence===0x7f?0x20:r.sequence+1} : undefined)}],
  ['extra journal command after final ACK', {journal:hooks=>{
    let reads = 0, last;
    return {...hooks, beforeCommand(r) { last=r; return hooks.beforeCommand(r); },
      afterCommand(a) {
        hooks.afterCommand(a);
        if (last.command === 113 && ++reads === 2) {
          const id = hooks.beforeCommand(last);
          hooks.afterCommand({...a,id});
        }
      }};
  }}]
]) {
  test(condition + ' holds the sale after restart', async t => {
    const f = fixture(t, change);
    assert.equal((await f.start()).fiscalStatus, 'uncertain');
    f.sender.close();
    const recovered = f.connect(null);
    assert.equal(recovered.bill(review).data.fiscal.status, 'uncertain');
    assert.equal(recovered.pay(finish).ok, false);
    assert.equal(recovered.pay({...selection, method:'card'}).ok, false);
    assert.equal(recovered.pay({...selection, account:'B'}).ok, false);
    assert.deepEqual(counts(recovered.db), [0,0]);
    assert.equal(f.device.state.tenders, 1);
    assert.equal(f.device.state.closes, 1);
  });
}
