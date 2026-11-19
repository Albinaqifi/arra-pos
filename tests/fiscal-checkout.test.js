const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { authorizedDatabase } = require('./support/authorized-database');
const { historicalDatabase } = require('./support/historical-database');
const { seedTables } = require('../src/desktop/tables');
const { seedArraMenu } = require('../src/desktop/arra-menu');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerBills } = require('../src/desktop/bills');
const { registerPayments } = require('../src/desktop/payments');
const { createOfflineFiscalCheckout, offlineCheckoutRequested } = require('../src/desktop/fiscal-checkout');

function setup(t, adapter = createOfflineFiscalCheckout()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-fiscal-checkout-'));
  let db = authorizedDatabase(openDatabase(directory));
  seedTables(db); seedArraMenu(db);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'other',x'00',x'00');
    INSERT INTO financial_scopes VALUES(2,'waiter');
    INSERT INTO user_permissions VALUES(2,'orders.change'),(2,'orders.view');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'),(3,3,1,'open');
    INSERT INTO order_waiter_ownership SELECT id,1,1,1,'open' FROM orders;
    INSERT INTO modifier_groups(id,product_id,name,required,active) VALUES('extra','arra-product-11-0','Size',0,1);
    INSERT INTO modifier_options(id,group_id,name,adjustment,active) VALUES('large','extra','Large',10,1);`);
  let actor = 1, generation = 0;
  const session = { currentUserId: () => actor, authenticatedUserId: () => actor, identityGeneration: () => generation };
  const trusted = {}, handlers = {}, ipc = { handle: (channel, fn) => { handlers[channel] = fn; } };
  const allowed = event => trusted === event;
  function register() {
    registerOrderItems(ipc, allowed, db, session);
    registerBills(ipc, allowed, db, session, adapter);
    registerPayments(ipc, allowed, db, session, null, adapter);
  }
  register();
  const call = (channel, req) => handlers[channel](trusted, req);
  const items = req => call('arra:order-items', req);
  const bills = req => call('arra:bill', req);
  const generate = (orderId = 1) => {
    assert.equal(items({action:'add',orderId,productId:'arra-product-11-0',optionIds:['large']}).ok, true);
    const itemId = items({action:'list',orderId}).data.items[0].id;
    assert.equal(items({action:'increment',orderId,itemId}).ok, true);
    assert.equal(items({action:'add',orderId,productId:'arra-product-12-0'}).ok, true);
    assert.equal(items({action:'send',orderId,requestId:'send-' + orderId}).ok, true);
    const review = bills({action:'review',orderId});
    const result = bills({action:'generate',orderId,fingerprint:review.data.fingerprint});
    assert.equal(result.ok, true);
    assert.equal(result.data.total, 340);
    return result.data.id;
  };
  t.after(() => { db.close(); fs.rmSync(directory,{recursive:true,force:true}); });
  return {
    get db() { return db; }, generate, bills, session, adapter, directory,
    pay: req => {
      if (req.terminalApproved && adapter?.mode === 'simulation') {
        let intent = db.prepare('SELECT id FROM simulated_card_open_intents WHERE bill_id=?').get(req.billId);
        if (!intent) {
          intent = db.prepare(`SELECT i.id FROM simulated_card_intents i JOIN simulated_card_intent_results r ON r.intent_id=i.id
            WHERE i.bill_id=? AND r.status='approved' ORDER BY i.id DESC LIMIT 1`).get(req.billId);
        }
        if (!intent) {
          const prepared=call('arra:payment',{billId:req.billId,method:'card',account:'A',prepareSimulated:true});
          if (prepared.ok) intent={id:prepared.data.intentId};
        }
        if (intent) req={...req,intentId:intent.id};
      }
      return call('arra:payment', req);
    },
    direct: req => call('arra:payment', req),
    untrusted: req => handlers['arra:payment']({},req),
    switchUser(id) { actor = id; generation++; },
    restart(nextAdapter = adapter) { db.close(); db = openDatabase(directory); adapter = nextAdapter; register(); }
  };
}

const count = (db, table) => db.prepare('SELECT count(*) AS n FROM ' + table).get().n;
const payment = (billId, method = 'cash', account = 'A') => ({billId, method, account,
  ...(method === 'card' && account === 'A' ? {terminalApproved:true,intentId:1} : {})});

test('prepared terminal intent survives a lost approval request and forbids alternate tender or decline', async t => {
  const f=setup(t), id=f.generate();
  const prepare={billId:id,method:'card',account:'A',prepareSimulated:true};
  assert.equal(f.untrusted(prepare).ok,false);
  const first=f.pay(prepare); assert.equal(first.ok,true);
  assert.deepEqual(f.pay(prepare),first);
  const intentId=first.data.intentId;
  f.restart();
  assert.equal(f.bills({action:'review',orderId:1}).data.simulatedCardIntent.id,intentId);
  assert.equal(f.pay(payment(id,'cash','B')).fiscalStatus,'selection');
  assert.equal(f.pay({billId:id,method:'card',account:'A',terminalDeclined:true,intentId}).ok,false);
  assert.equal(f.direct({billId:id,method:'card',account:'A',terminalApproved:true,intentId:intentId+1}).fiscalStatus,'approvalRequired');
  assert.equal(count(f.db,'payments'),0);
  assert.equal(count(f.db,'fiscal_checkout_attempts'),0);
  const accepted=await f.pay({billId:id,method:'card',account:'A',terminalApproved:true,intentId});
  assert.equal(accepted.ok,true);
  assert.equal(count(f.db,'payments'),1);
});

test('simulated approval survives preflight failure and restart without permitting a different payment', async t => {
  const f = setup(t);
  f.db.exec("DELETE FROM menu_product_fiscal_tax WHERE product_id='arra-product-11-0'");
  const id = f.generate();
  assert.equal(f.pay({billId:id,method:'card',account:'A'}).fiscalStatus,'approvalRequired');
  assert.equal(count(f.db,'simulated_card_approvals'),0);
  assert.equal(f.pay(payment(id,'card')).fiscalStatus,'unmapped');
  assert.equal(count(f.db,'simulated_card_approvals'),1);
  assert.equal(count(f.db,'fiscal_checkout_attempts'),0);
  f.restart();
  assert.equal(f.bills({action:'review',orderId:1}).data.simulatedCardApproval,true);
  assert.equal(f.pay(payment(id,'cash','B')).fiscalStatus,'selection');
  assert.equal(f.pay(payment(id,'cash')).fiscalStatus,'selection');
  assert.equal(f.pay({billId:id,method:'card',account:'A'}).fiscalStatus,'unmapped');
  f.restart(null);
  assert.equal(f.pay({billId:id,method:'card',account:'A'}).fiscalStatus,'profile');
  assert.equal(count(f.db,'payments'),0);
});

test('physical card requests are rejected before the adapter, including a permissive adapter', async t => {
  let calls = 0;
  const adapter = {mode:'device',deviceId:'sample-PF700',domesticProduct:false,
    canRegister:()=>true, registerSale:()=>{ calls++; return {status:'failed'}; }};
  const f = setup(t,adapter);
  const id = f.generate();
  assert.equal(f.untrusted(payment(id,'card')).ok,false);
  assert.equal(f.pay(payment(id,'card','B')).ok,false);
  assert.equal(f.pay(payment(id,'card')).fiscalStatus,'cardDisabled');
  f.restart(adapter);
  assert.equal(f.pay(payment(id,'card')).fiscalStatus,'cardDisabled');
  assert.equal(calls,0);
  assert.equal(count(f.db,'fiscal_checkout_sales'),0);
  assert.equal(count(f.db,'payments'),0);
  assert.equal((await f.pay(payment(id))).fiscalStatus,'failed');
  assert.equal(calls,1);
});

test('training card tender and Account A total match one payment across replay and restart', async t => {
  const f = setup(t);
  const makeAdapter = () => require('../src/desktop/training-pf700').createTrainingPf700(f.directory);
  f.db.exec("INSERT INTO menu_product_fiscal_origin VALUES('arra-product-11-0',1),('arra-product-12-0',0)");
  f.restart(makeAdapter());
  const id = f.generate(), req = payment(id,'card');
  const first = await f.pay(req);
  assert.equal(first.ok,true);
  assert.deepEqual(first.data.fiscal.receipt.lines.map(l => [l.taxGroup,l.taxRate]),[['В',10],['А',18]]);
  assert.deepEqual(await f.pay(req),first);
  f.restart(makeAdapter());
  assert.deepEqual(await f.pay(req),first);
  const { DatabaseSync } = require('node:sqlite');
  const device = new DatabaseSync(path.join(f.directory,'simulated-pf700.sqlite'),{readOnly:true});
  try {
    const sales = device.prepare('SELECT bill,cash,card,taxA,taxV FROM documents WHERE bill IS NOT NULL').all();
    assert.equal(sales.length,1);
    assert.deepEqual({...sales[0]},{bill:id,cash:0,card:340,taxA:180,taxV:160});
  } finally { device.close(); }
  const day = f.db.prepare('SELECT business_day_id AS id FROM payment_business_days').get().id;
  const total = require('../src/desktop/account-a-bills').report(f.db,day);
  assert.deepEqual([total.cash,total.card,total.total,total.records.length],[0,340,340,1]);
  assert.equal(count(f.db,'payments'),1);
});

test('lost training reply is recovered from exact simulated evidence after restart without another sale', async t => {
  const f = setup(t);
  const training = require('../src/desktop/training-pf700').createTrainingPf700(f.directory);
  let calls = 0;
  const lost = {...training, async registerSale(receipt,context) {
    calls++; await training.registerSale(receipt,context); throw Error('Lost simulated reply');
  }};
  f.db.exec("INSERT INTO menu_product_fiscal_origin VALUES('arra-product-11-0',1),('arra-product-12-0',0)");
  f.restart(lost);
  const id=f.generate(), req=payment(id,'card');
  assert.equal((await f.pay(req)).fiscalStatus,'uncertain');
  assert.equal(count(f.db,'payments'),0);
  f.restart(training);
  assert.equal(f.pay(req).fiscalStatus,'uncertain');
  const recovery = {billId:id,method:'card',account:'A',recoverSimulated:true};
  assert.equal(f.untrusted(recovery).ok,false);
  const result = await f.pay(recovery);
  assert.equal(result.ok,true);
  assert.equal(result.data.fiscal.receipt.total,340);
  assert.equal(result.data.fiscal.receipt.method,'card');
  assert.deepEqual(await f.pay(recovery),result);
  f.restart(training);
  assert.deepEqual(await f.pay(req),result);
  assert.equal(calls,1);
  assert.equal(count(f.db,'fiscal_checkout_attempts'),1);
  assert.equal(count(f.db,'payments'),1);
  const { DatabaseSync } = require('node:sqlite');
  const device = new DatabaseSync(path.join(f.directory,'simulated-pf700.sqlite'),{readOnly:true});
  try { assert.equal(device.prepare('SELECT count(*) n FROM documents WHERE bill=?').get(id).n,1); }
  finally { device.close(); }
  const day=f.db.prepare('SELECT business_day_id AS id FROM payment_business_days').get().id;
  assert.equal(require('../src/desktop/account-a-bills').report(f.db,day).card,340);
});

test('another connection can match an issued training receipt while the original reply is pending', async t => {
  const f=setup(t);
  const training=require('../src/desktop/training-pf700').createTrainingPf700(f.directory);
  let release, issued, calls=0;
  const issuedSignal=new Promise(resolve=>{ issued=resolve; });
  const adapter={...training, async registerSale(receipt,context) {
    calls++; const result=await training.registerSale(receipt,context); issued();
    await new Promise(resolve=>{release=resolve;}); return result;
  }};
  f.db.exec("INSERT INTO menu_product_fiscal_origin VALUES('arra-product-11-0',1),('arra-product-12-0',0)");
  f.restart(adapter);
  const id=f.generate(), req=payment(id,'card');
  const pending=f.pay(req);
  await issuedSignal;
  const other=openDatabase(f.directory);
  try {
    let pay;
    registerPayments({handle:(_,fn)=>{pay=fn;}},()=>true,other,f.session,null,training);
    const recovered=pay({}, {billId:id,method:'card',account:'A',recoverSimulated:true});
    assert.equal(recovered.ok,true);
    release();
    assert.equal((await pending).fiscalStatus,'uncertain');
    assert.deepEqual(await f.pay(req),recovered);
    assert.equal(count(f.db,'payments'),1);
    assert.equal(count(f.db,'fiscal_checkout_attempts'),1);
    assert.equal(calls,1);
  } finally { if (release) release(); other.close(); }
});

test('ordinary checkout connects generated cash/card A bills to the in-memory PF700 and preserves cash B', async t => {
  const f = setup(t);
  for (const [orderId, method] of [[1,'cash'],[2,'card']]) {
    const billId = f.generate(orderId);
    const req = payment(billId,method);
    if (orderId === 1) {
      assert.equal(f.bills({action:'review',orderId}).data.fiscalMode, 'simulation');
      // New menu values cannot change this bill's prices or fiscal groups.
      f.db.exec("UPDATE menu_products SET price=999 WHERE id='arra-product-11-0'; UPDATE menu_product_fiscal_tax SET tax_group='А' WHERE product_id='arra-product-11-0'");
      assert.deepEqual(f.bills({action:'review',orderId}).data.lines.map(l => [l.taxGroup,l.taxRate]),
        [['В',10],['А',18]]);
    }
    const first = await f.pay(req);
    assert.equal(first.ok, true);
    const { fiscal } = first.data;
    assert.deepEqual([fiscal.status,fiscal.reference,fiscal.receipt.method,fiscal.receipt.currency,fiscal.receipt.total],
      ['accepted','SIM-'+billId,method,'MKD',340]);
    assert.deepEqual(fiscal.receipt.lines.map(l => [l.quantity,l.unitPrice,l.taxGroup,l.taxRate]),
      [[2,80,'В',10],[1,180,'А',18]]);
    assert.deepEqual(fiscal.receipt.lines[0].modifiers,[{groupName:'Size',optionName:'Large',adjustment:10}]);
    assert.deepEqual(f.bills({action:'review',orderId}).data.fiscal, fiscal);
    assert.deepEqual(await f.pay(req), first);
    if (orderId === 1) f.db.exec("UPDATE menu_products SET price=70 WHERE id='arra-product-11-0'; UPDATE menu_product_fiscal_tax SET tax_group='В' WHERE product_id='arra-product-11-0'");
  }
  assert.equal(f.pay(payment(f.generate(3),'cash','B')).ok, true);
  for (const table of ['fiscal_checkout_sales','fiscal_checkout_attempts','fiscal_checkout_results']) assert.equal(count(f.db,table),2);
  assert.equal(count(f.db,'payments'),3);
  assert.equal(count(f.db,'test_print_attempts'),0);
  f.restart();
  assert.equal(f.bills({action:'review',orderId:1}).data.fiscal.status,'accepted');
  assert.equal(f.pay(payment(1)).data.fiscal.reference,'SIM-1');
});

test('outstanding sale blocks duplicate and conflicting requests while other cash B bills still settle', async t => {
  let finish, calls = 0;
  const f = setup(t, {mode:'simulation',registerSale: () => {
    calls++;
    return new Promise(resolve => { finish = resolve; });
  }});
  const req = payment(f.generate(),'card');
  const second = f.generate(2);
  const submission = f.pay(req);
  assert.equal(f.db.isTransaction,false);
  assert.equal(f.pay(req).fiscalStatus,'pending');
  assert.equal(f.bills({action:'review',orderId:1}).data.fiscal.status,'pending');
  assert.equal(f.pay(payment(req.billId,'cash','B')).fiscalStatus,'selection');
  assert.equal(f.pay(payment(second)).fiscalStatus,'blocked');
  assert.equal(f.pay(payment(second,'cash','B')).ok,true);
  const parallel = openDatabase(f.directory);
  try {
    let pay;
    registerPayments({handle:(_,fn)=>{pay=fn;}},()=>true,parallel,f.session,null,f.adapter);
    assert.equal(pay({},req).fiscalStatus,'uncertain');
  } finally { parallel.close(); }
  assert.equal(calls,1);
  finish({status:'uncertain'});
  assert.equal((await submission).fiscalStatus,'uncertain');
  f.restart(null); // Ordinary launch must not bypass a saved reservation.
  assert.equal(f.pay(req).fiscalStatus,'uncertain');
  assert.equal(f.pay(payment(req.billId,'cash','B')).fiscalStatus,'selection');
  assert.equal(f.bills({action:'review',orderId:1}).data.fiscal.status,'uncertain');
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=1').get().status,'open');
  assert.equal(f.db.prepare('SELECT count(*) n FROM test_print_jobs WHERE bill_id=1').get().n,0);
  assert.throws(() => f.db.prepare("INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,340,'card','A')").run());
  assert.equal(count(f.db,'fiscal_checkout_attempts'),1);
});

test('definite pre-sale failure permits the same selection and accepted output survives POS rollback', async t => {
  let calls = 0;
  const f = setup(t,{mode:'simulation',registerSale:receipt => ++calls === 1 ?
    {status:'failed'} : {status:'accepted',reference:'SIM-'+receipt.billId}});
  const req = payment(f.generate());
  assert.equal((await f.pay(req)).fiscalStatus,'failed');
  assert.equal(f.pay(payment(1,'cash','B')).fiscalStatus,'selection');
  f.db.exec("CREATE TRIGGER reject_test_payment BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT,'test'); END;");
  assert.equal((await f.pay(req)).fiscalStatus,'submitted');
  assert.equal(count(f.db,'payments'),0);
  assert.equal(count(f.db,'test_print_jobs'),0);
  assert.equal(f.bills({action:'review',orderId:1}).data.fiscal.status,'submitted');
  f.restart();
  f.db.exec('DROP TRIGGER reject_test_payment');
  assert.equal(f.pay(req).ok,true);
  assert.equal(f.pay(req).ok,true);
  assert.equal(calls,2);
  assert.equal(count(f.db,'fiscal_checkout_attempts'),2);
  assert.equal(count(f.db,'payments'),1);
  for (const table of ['fiscal_checkout_sales','fiscal_checkout_attempts','fiscal_checkout_results']) {
    assert.throws(() => f.db.exec('DELETE FROM '+table));
    assert.throws(() => f.db.exec('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table));
  }
});

test('trusted identity gates preparation, replays, receipt reads and responses after an identity change', async t => {
  let finish;
  const f = setup(t,{mode:'simulation',registerSale:() => new Promise(resolve => { finish = resolve; })});
  const req = payment(f.generate());
  assert.equal(f.untrusted(req).ok,false);
  assert.equal(f.pay({...req, taxGroup:'А'}).ok,false);
  assert.equal(f.pay({...req, mode:'hardware'}).ok,false);
  assert.equal(f.pay(payment(1,'card','B')).ok,false);
  f.switchUser(2);
  assert.equal(f.pay(req).error,'Access denied');
  assert.equal(f.bills({action:'review',orderId:1}).ok,false);
  assert.equal(count(f.db,'fiscal_checkout_attempts'),0);
  f.switchUser(1);
  const response = f.pay(req);
  f.switchUser(2);
  finish({status:'accepted',reference:'SIM-1'});
  assert.deepEqual(await response,{ok:false,error:'Access denied'});
  assert.equal(count(f.db,'payments'),0);
  assert.equal(f.bills({action:'review',orderId:1}).ok,false);
  f.switchUser(1);
  assert.equal(f.pay(req).ok,true);
  assert.equal(count(f.db,'fiscal_checkout_attempts'),1);
  assert.equal(count(f.db,'payments'),1);
});

test('unmapped bills, invalid profile options and live adapter types fail before dispatch', t => {
  let calls = 0;
  const f = setup(t,{mode:'simulation',registerSale:()=>{calls++;}});
  f.db.exec("DELETE FROM menu_product_fiscal_tax WHERE product_id='arra-product-11-0'");
  assert.equal(f.pay(payment(f.generate())).fiscalStatus,'unmapped');
  assert.equal(count(f.db,'fiscal_checkout_attempts'),0);
  assert.equal(calls,0);
  assert.equal(offlineCheckoutRequested(['--sample-data-directory=X']),false);
  assert.equal(offlineCheckoutRequested(['--sample-data-directory=X','--pf700-offline-checkout']),true);
  for (const args of [['--pf700-offline-checkout'],['--sample-data-directory=X','--pf700-offline-checkout=live']]) {
    assert.throws(() => offlineCheckoutRequested(args));
  }
  assert.throws(() => registerPayments({},()=>true,f.db,f.session,null,{mode:'hardware',registerSale(){}}));
});

test('lost acknowledgement storage leaves an open bill, no payment and a permanent no-resend reservation', async t => {
  let calls = 0;
  const f = setup(t,{mode:'simulation',registerSale:receipt => {
    calls++;
    return {status:'accepted',reference:'SIM-'+receipt.billId};
  }});
  const req = payment(f.generate(),'card');
  f.db.exec("CREATE TRIGGER reject_ack BEFORE INSERT ON fiscal_checkout_results BEGIN SELECT RAISE(ABORT,'test'); END;");
  assert.equal((await f.pay(req)).fiscalStatus,'uncertain');
  f.db.exec('DROP TRIGGER reject_ack');
  f.restart();
  assert.equal(f.pay(req).fiscalStatus,'uncertain');
  assert.equal(calls,1);
  assert.equal(count(f.db,'payments'),0);
  assert.equal(count(f.db,'test_print_jobs'),0);
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=1').get().status,'open');
});

test('upgrade retains a paid A bill, corrected B payment and original jobs without retroactive fiscal sales', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'arra-fiscal-upgrade-'));
  let db = authorizedDatabase(historicalDatabase(43).openDatabase(directory));
  t.after(() => { db.close(); fs.rmSync(directory,{recursive:true,force:true}); });
  seedTables(db);
  db.exec(`INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open');
    INSERT INTO order_waiter_ownership SELECT id,1,1,1,'open' FROM orders;
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,70,'one'),(2,2,1,1,180,'two');
    INSERT INTO payments(id,bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,2,70,'card','A'),(2,2,1,2,180,'cash','B');
    UPDATE orders SET status='completed';
    INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(2,1,3,'Sample correction');
  `);
  require('../src/desktop/test-printing').createBillJob(db,1);
  const history = () => ['payments','payment_account_corrections','test_print_jobs'].map(table => db.prepare('SELECT * FROM '+table+' ORDER BY id').all());
  const before = history();
  db.close(); db = openDatabase(directory);
  let pay, calls = 0;
  registerPayments({handle:(_,fn)=>{pay=fn;}},()=>true,db,{currentUserId:()=>1,authenticatedUserId:()=>1},null,
    {mode:'simulation',registerSale:()=>{calls++;}});
  assert.deepEqual(pay({},payment(1,'card')), {ok:true,data:{id:1}});
  assert.deepEqual(pay({},payment(2,'cash','B')), {ok:true,data:{id:2}});
  assert.equal(pay({},payment(2)).ok,false);
  assert.deepEqual(history(),before);
  assert.equal(calls,0);
  assert.equal(count(db,'fiscal_checkout_sales'),0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('device-mode test double retains only validated evidence and cannot switch device or mode to retry', async t => {
  let calls = 0;
  const evidence = {documentNumber:'0000123',fiscalReceiptCount:3,reversalCount:0};
  const adapter = {mode:'device', deviceId:'sample-PF700', domesticProduct:false, registerSale:(_receipt,context) => {
    if (++calls === 1) return {status:'failed'};
    context.beforeOpen({previousDocumentNumber:'0000122'});
    return {status:'accepted',reference:'0000123',evidence:{...evidence,unexpected:'discard'}};
  }};
  const f = setup(t,adapter);
  const req = payment(f.generate(),'cash');
  assert.equal(f.bills({action:'review',orderId:1}).data.fiscalMode,'device');
  assert.equal(f.bills({action:'review',orderId:1}).data.fiscalDomesticProduct,false);
  assert.equal((await f.pay(req)).fiscalStatus,'failed');
  for (const different of [null,createOfflineFiscalCheckout(),{...adapter,deviceId:'another-PF700'},{...adapter,domesticProduct:true}]) {
    f.restart(different);
    assert.equal(f.pay(req).fiscalStatus,'profile');
    assert.equal(count(f.db,'fiscal_checkout_attempts'),1);
  }
  f.restart(adapter);
  f.db.exec("CREATE TRIGGER fail_commit BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT,'test'); END");
  assert.equal((await f.pay(req)).fiscalStatus,'submitted');
  const acknowledgement = f.bills({action:'review',orderId:1}).data.fiscal;
  assert.equal(acknowledgement.status,'submitted');
  assert.equal(acknowledgement.mode,'device');
  assert.equal(acknowledgement.deviceId,'sample-PF700');
  assert.equal(acknowledgement.receipt.domesticProduct,false);
  assert.deepEqual(acknowledgement.evidence,evidence);
  assert.equal(acknowledgement.reference,evidence.documentNumber);
  f.db.exec('DROP TRIGGER fail_commit');
  f.restart(null);
  const reconciled = f.pay(req).data.fiscal;
  assert.deepEqual(reconciled,{...acknowledgement,status:'accepted'});
  assert.equal(calls,2);
  assert.equal(count(f.db,'payments'),1);
});

test('invalid or simulated receipts from a device adapter remain uncertain and cannot complete the bill', async t => {
  const f = setup(t,{mode:'device',deviceId:'sample-PF700',domesticProduct:false,registerSale:() => ({
    status:'accepted',reference:'SIM-1',evidence:{documentNumber:'0000012',fiscalReceiptCount:5,reversalCount:1}
  })});
  const req = payment(f.generate(),'cash');
  assert.equal((await f.pay(req)).fiscalStatus,'uncertain');
  assert.equal(f.pay(req).fiscalStatus,'uncertain');
  assert.equal(count(f.db,'fiscal_checkout_results'),0);
  assert.equal(count(f.db,'payments'),0);
  assert.equal(count(f.db,'test_print_jobs'),0);
});

test('commissioning policy rejects an unsupported trial before freezing tender or reserving a sale', async t => {
  let calls = 0;
  const adapter = {mode:'device',deviceId:'sample-PF700',domesticProduct:false,
    canRegister: receipt => receipt.method === 'cash' && receipt.lines.length === 1 && receipt.lines[0].quantity === 1,
    registerSale: () => { calls++; return {status:'failed'}; }};
  const f = setup(t,adapter);
  const mixed = f.generate();
  assert.equal(f.pay(payment(mixed)).fiscalStatus,'scope');
  f.db.exec(`INSERT INTO order_items(order_id,product_id,name,unit_price,quantity,status)
    VALUES(2,'arra-product-11-0','Espresso',70,1,'sent')`);
  const review = f.bills({action:'review',orderId:2});
  const bill = f.bills({action:'generate',orderId:2,fingerprint:review.data.fingerprint}).data.id;
  assert.equal(f.pay(payment(bill,'card')).fiscalStatus,'cardDisabled');
  assert.equal(count(f.db,'fiscal_checkout_sales'),0);
  assert.equal(count(f.db,'fiscal_checkout_attempts'),0);
  assert.equal(calls,0);
  assert.equal((await f.pay(payment(bill))).fiscalStatus,'failed');
  assert.equal(calls,1);
});

test('one supervised receipt consumes the device allowance across connections and restart before local settlement', async t => {
  let finish, calls = 0;
  const makeAdapter = () => ({mode:'device',deviceId:'sample-PF700',domesticProduct:false,registerSale:(_receipt,context) => {
    calls++;
    context.beforeOpen({previousDocumentNumber:'0000122'});
    return new Promise(resolve => { finish = resolve; });
  }});
  const f = setup(t,makeAdapter());
  const first = payment(f.generate()), second = payment(f.generate(2));
  f.db.exec("CREATE TRIGGER fail_settlement BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT,'test'); END");
  const submitted = f.pay(first);
  const parallel = openDatabase(f.directory);
  try {
    let pay;
    registerPayments({handle:(_,fn)=>{pay=fn;}},()=>true,parallel,f.session,null,makeAdapter());
    assert.equal(pay({},second).fiscalStatus,'blocked');
    finish({status:'accepted',reference:'0000123',evidence:{documentNumber:'0000123',fiscalReceiptCount:1,reversalCount:0}});
    assert.equal((await submitted).fiscalStatus,'submitted');
    assert.equal(pay({},second).fiscalStatus,'scope');
    assert.equal(count(parallel,'payments'),0);
  } finally { parallel.close(); }
  f.restart(makeAdapter());
  assert.equal(f.pay(second).fiscalStatus,'scope');
  assert.equal(count(f.db,'fiscal_checkout_sales'),1);
  assert.equal(count(f.db,'fiscal_checkout_attempts'),1);
  f.db.exec('DROP TRIGGER fail_settlement');
  f.restart(null);
  assert.equal(f.pay(first).data.fiscal.reference,'0000123');
  f.restart(makeAdapter());
  assert.equal(f.pay(second).fiscalStatus,'scope');
  assert.equal(f.pay(first).data.fiscal.status,'accepted');
  assert.equal(count(f.db,'payments'),1);
  assert.equal(calls,1);
});

test('lost close reply retains the pre-open candidate through restart and rejects mismatched saved outcomes', async t => {
  let calls = 0;
  const f = setup(t,{mode:'device',deviceId:'sample-PF700',domesticProduct:false,registerSale:(_receipt,context) => {
    calls++;
    context.beforeOpen({previousDocumentNumber:'0001229'});
    throw Error('Lost close response');
  }});
  const req = payment(f.generate());
  assert.equal((await f.pay(req)).fiscalStatus,'uncertain');
  f.restart();
  const read = () => f.bills({action:'review',orderId:1}).data.fiscal;
  assert.deepEqual(read().baseline,{deviceId:'sample-PF700',previousDocumentNumber:'0001229',expectedDocumentNumber:'0001230'});
  assert.equal(read().reference,null);
  assert.throws(() => f.db.exec("UPDATE fiscal_checkout_baselines SET previous_document='0000122'"));
  const insert = () => f.db.prepare('INSERT INTO fiscal_checkout_results VALUES(1,?,?,?,?,1)');
  const evidence = JSON.stringify({documentNumber:'0001230',fiscalReceiptCount:5,reversalCount:0});
  for (const [source,reference,proof] of [['device-other','0001230',evidence],['simulation','SIM-1',null],
    ['device-sample-PF700','0001230',null],['device-sample-PF700','0001231',evidence],
    ['device-sample-PF700','0001230',JSON.stringify({documentNumber:'0001230',fiscalReceiptCount:-1,reversalCount:0})]]) {
    assert.throws(() => insert().run('accepted',source,reference,proof),/Unverified fiscal checkout outcome/);
  }
  // Emulate damaged persisted evidence from outside the application. All read
  // and payment paths must still verify it after restart.
  f.db.exec('DROP TRIGGER fiscal_checkout_result_guard');
  insert().run('accepted','device-other','0001230',evidence);
  f.restart();
  assert.equal(read().status,'uncertain');
  assert.equal(read().reference,null);
  assert.equal(f.pay(req).fiscalStatus,'uncertain');
  const nextBill = f.generate(2);
  f.restart(null);
  assert.equal(f.pay(payment(nextBill)).fiscalStatus,'blocked');
  f.restart(createOfflineFiscalCheckout());
  assert.equal(f.pay(payment(nextBill)).fiscalStatus,'blocked');
  assert.throws(() => f.db.exec("INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,340,'cash','A')"));
  assert.equal(count(f.db,'payments'),0);
  assert.equal(calls,1);
});

test('unsupported PF700 descriptions are rejected before reserving or freezing the tender', t => {
  const f = setup(t);
  f.db.prepare("UPDATE menu_products SET name=? WHERE id='arra-product-11-0'").run('Q'.repeat(55));
  const billId = f.generate();
  assert.equal(f.pay(payment(billId)).fiscalStatus,'unavailable');
  assert.equal(count(f.db,'fiscal_checkout_sales'),0);
  assert.equal(count(f.db,'fiscal_checkout_attempts'),0);
  assert.equal(f.pay(payment(billId,'cash','B')).ok,true);
});

test('a bill exceeding the PF700 limit leaves the fiscal journal empty and the cash selection open', async t => {
  for (const mode of ['device', 'simulation']) {
    let calls = 0;
    const f = setup(t, {
      mode, ...(mode === 'device' ? { deviceId: 'sample-PF700', domesticProduct: false } : {}),
      registerSale() { calls++; return { status: 'failed' }; }
    });
    f.db.exec("INSERT INTO order_items(order_id,product_id,name,unit_price,quantity,status) VALUES(1,'arra-product-11-0','Sample item',10000000,1,'sent')");
    const review = f.bills({ action: 'review', orderId: 1 });
    const bill = f.bills({ action: 'generate', orderId: 1, fingerprint: review.data.fingerprint }).data;
    assert.equal(bill.total, 10_000_000);
    assert.equal((await f.pay(payment(bill.id))).fiscalStatus, 'unavailable');
    for (const table of ['fiscal_checkout_sales','fiscal_checkout_attempts','fiscal_checkout_results','fiscal_checkout_baselines','payments']) {
      assert.equal(count(f.db, table), 0);
    }
    assert.equal((await f.pay(payment(bill.id, 'cash', 'B'))).ok, true);
    assert.equal(count(f.db, 'payments'), 1);
    assert.equal(calls, 0);
  }
});

test('device attempt holds its original financial period until settled and pre-open failure releases it', async t => {
  let finish;
  const f = setup(t,{mode:'device',deviceId:'sample-PF700',domesticProduct:false,registerSale:(_receipt,context) =>
    new Promise(resolve => { finish = success => {
      if (success) context.beforeOpen({previousDocumentNumber:'0000001'});
      resolve(success ? {status:'accepted',reference:'0000002',
        evidence:{documentNumber:'0000002',fiscalReceiptCount:2,reversalCount:0}} : {status:'failed'});
    }; })});
  const req = payment(f.generate());
  f.db.exec("UPDATE financial_scopes SET scope='combined' WHERE user_id=2; INSERT INTO user_permissions VALUES(2,'business_days.close')");
  let close;
  require('../src/desktop/business-days').registerBusinessDays({handle:(_,fn)=>{close=fn;}},()=>true,f.db,
    {currentUserId:()=>2,authenticatedUserId:()=>2});
  const day = f.db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id;
  const shifts = () => f.db.prepare('SELECT max(id) AS id FROM restaurant_shifts').get().id;
  const closeShift = () => close({}, {action:'shiftClose',shiftId:shifts()});
  const closeDay = () => close({}, {action:'close',dayId:day});
  const blocked = {ok:false,error:'checkout-unresolved'};

  const first = f.pay(req);
  assert.deepEqual(closeDay(),blocked);
  assert.deepEqual(closeShift(),blocked);
  f.db.exec("UPDATE financial_scopes SET scope='B' WHERE user_id=2; INSERT INTO user_permissions VALUES(2,'employees.view')");
  assert.deepEqual(closeDay(),{ok:false,error:'period-blocked'});
  assert.deepEqual(closeShift(),{ok:false,error:'period-blocked'});
  f.db.exec("UPDATE financial_scopes SET scope='combined' WHERE user_id=2");
  finish(false);
  assert.equal((await first).fiscalStatus,'failed');
  assert.equal(closeShift().ok,true);
  const shift = shifts();

  const retry = f.pay(req);
  f.db.exec("CREATE TRIGGER reject_settle BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT,'test'); END");
  finish(true);
  assert.equal((await retry).fiscalStatus,'submitted');
  // An idle successor may have no reportable shift yet; the day itself still
  // cannot close across a registered receipt awaiting its local payment.
  assert.deepEqual(closeDay(),blocked);
  assert.equal(count(f.db,'day_print_jobs'),0);
  f.db.exec('DROP TRIGGER reject_settle');
  assert.equal(f.pay(req).ok,true);
  assert.equal(f.db.prepare('SELECT shift_id FROM payment_shifts').get().shift_id,shift);
  assert.equal(f.db.prepare('SELECT business_day_id FROM payment_business_days').get().business_day_id,day);
  assert.equal(closeShift().ok,true);
  assert.equal(closeDay().ok,true);
  await new Promise(setImmediate);
});

test('commissioned database rejects ordinary and simulated A, including a saved simulated acknowledgement', async t => {
  const f = setup(t);
  const req = payment(f.generate());
  const fresh = payment(f.generate(2));
  f.db.exec("CREATE TRIGGER reject_settle BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT,'test'); END");
  assert.equal((await f.pay(req)).fiscalStatus,'submitted');
  f.db.exec('DROP TRIGGER reject_settle');
  require('../src/desktop/pf700-commissioning').enroll(f.db);
  for (const profile of [null,createOfflineFiscalCheckout()]) {
    f.restart(profile);
    assert.equal(f.pay(fresh).fiscalStatus,'profile');
    assert.equal(f.pay(req).fiscalStatus,'profile');
    assert.equal(count(f.db,'payments'),0);
  }
  let calls = 0;
  f.restart({mode:'device',deviceId:'sample-PF700',domesticProduct:false,registerSale:()=>{
    calls++; return {status:'failed'};
  }});
  assert.equal(f.pay(req).fiscalStatus,'profile');
  assert.equal(calls,0);
  assert.equal((await f.pay(fresh)).fiscalStatus,'failed');
  assert.equal(calls,1);
});

test('supervised local-product mark survives retry and rejects conflicting instructions before a device attempt', async t => {
  const marks = [];
  const adapter = {mode:'device',deviceId:'sample-PF700',domesticProduct:true,registerSale:(snapshot,context)=>{
    marks.push(snapshot.domesticProduct);
    if (marks.length === 1) return {status:'failed'};
    context.beforeOpen({previousDocumentNumber:'0001000'});
    return {status:'accepted',reference:'0001001',evidence:{documentNumber:'0001001',fiscalReceiptCount:1,reversalCount:0}};
  }};
  const f = setup(t,adapter);
  require('../src/desktop/pf700-commissioning').enroll(f.db);
  f.db.exec(`INSERT INTO order_items(order_id,product_id,name,unit_price,quantity,status)
    VALUES(1,'arra-product-11-0','Espresso',70,1,'sent')`);
  const bill = f.bills({action:'review',orderId:1}).data;
  assert.equal(bill.fiscalDomesticProduct,true);
  const req = payment(f.bills({action:'generate',orderId:1,fingerprint:bill.fingerprint}).data.id);
  assert.equal((await f.pay(req)).fiscalStatus,'failed');
  f.restart({...adapter,domesticProduct:false});
  assert.equal(f.pay(req).fiscalStatus,'profile');
  const saved = f.bills({action:'review',orderId:1}).data;
  assert.equal(saved.fiscal.receipt.domesticProduct,true);
  assert.equal(saved.fiscalDomesticProduct,false);
  assert.equal(count(f.db,'fiscal_checkout_attempts'),1);
  f.restart(adapter);
  assert.equal((await f.pay(req)).ok,true);
  assert.deepEqual(marks,[true,true]);
  // Emulate an external edit to a completed receipt. A saved POS payment
  // remains historical, but no successful fiscal acknowledgement can be shown.
  f.db.exec("DROP TRIGGER fiscal_checkout_results_no_update; UPDATE fiscal_checkout_results SET reference='0001999' WHERE status='accepted'");
  f.restart();
  assert.equal(f.bills({action:'review',orderId:1}).data.fiscal.status,'uncertain');
  assert.equal(f.pay(req).fiscalStatus,'uncertain');
  assert.equal(count(f.db,'payments'),1);
  assert.deepEqual(marks,[true,true]);
});

test('routine device checkout preserves trial history, requires item origins, and records successive mixed bills once', async t => {
  let calls = 0;
  const makeAdapter = routine => ({mode:'device', deviceId:'sample-PF700', domesticProduct:false,
    ...(routine ? {requireOrigins:true} : {}),
    registerSale: async (receipt, context) => {
      calls++; const previousDocumentNumber = String(calls - 1).padStart(7,'0');
      context.beforeOpen({previousDocumentNumber});
      const documentNumber = String(calls).padStart(7,'0');
      return {status:'accepted', reference:documentNumber, evidence:{documentNumber,fiscalReceiptCount:calls,reversalCount:0}};
    }});
  const f = setup(t, makeAdapter(false));
  const first = f.generate(1);
  const trial = await f.pay(payment(first));
  assert.equal(trial.ok,true);
  f.restart(makeAdapter(true));
  const missing = f.generate(2);
  assert.equal((await f.pay(payment(missing))).fiscalStatus,'origin');
  assert.equal(calls,1);
  assert.equal(count(f.db,'payments'),1);
  f.db.exec("INSERT INTO menu_product_fiscal_origin VALUES('arra-product-11-0',1),('arra-product-12-0',0)");
  f.db.exec("INSERT INTO orders(id,table_id,opened_at,status) VALUES(4,4,1,'open'); INSERT INTO order_waiter_ownership VALUES(4,1,1,1,'open')");
  const mixed = f.generate(3);
  f.db.exec("UPDATE menu_product_fiscal_origin SET domestic=0 WHERE product_id='arra-product-11-0'");
  const receipt = await f.pay(payment(mixed));
  assert.equal(receipt.ok,true);
  assert.deepEqual(receipt.data.fiscal.receipt.lines.map(l => [l.quantity,l.unitPrice,l.taxRate,l.domesticProduct]), [[2,80,10,true],[1,180,18,false]]);
  assert.deepEqual(await f.pay(payment(mixed)),receipt);
  f.restart(makeAdapter(true));
  assert.deepEqual(await f.pay(payment(mixed)),receipt);
  assert.equal(calls,2);
  assert.equal(count(f.db,'payments'),2);
  assert.equal(f.bills({action:'review',orderId:1}).data.fiscal.reference,trial.data.fiscal.reference);
});

test('routine unavailable printer leaves bill unpaid and permits same-selection retry', async t => {
  let calls=0;
  const adapter = {mode:'device',deviceId:'sample-PF700',domesticProduct:false,requireOrigins:true,registerSale:async()=>{calls++;return {status:'failed'};}};
  const f=setup(t,adapter);
  f.db.exec("INSERT INTO menu_product_fiscal_origin VALUES('arra-product-11-0',1),('arra-product-12-0',0)");
  const bill=f.generate();
  assert.equal((await f.pay(payment(bill))).fiscalStatus,'failed');
  assert.equal((await f.pay(payment(bill))).fiscalStatus,'failed');
  assert.equal(calls,2); assert.equal(count(f.db,'payments'),0);
});

test('routine retries only a definitively failed single-item trial using its original mark', async t => {
  const {selectPf700Checkout} = require('../src/desktop/pf700-checkout-mode');
  const {enroll,deviceTrial} = require('../src/desktop/pf700-commissioning');
  const oldLocal = process.env.LOCALAPPDATA;
  t.after(() => { if (oldLocal === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = oldLocal; });
  for (const originalMark of [false,true]) {
    await t.test(String(originalMark), async t => {
      const f=setup(t,{mode:'device',deviceId:'SYNTHETIC01',domesticProduct:originalMark,
        registerSale:async()=>({status:'failed'})});
      enroll(f.db);
      f.db.exec(`INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,status)
        VALUES(1,1,'arra-product-11-0','Espresso',70,1,'sent');
        INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,70,'old');
        INSERT INTO bill_lines(bill_id,item_id,name,unit_price,quantity,modifiers) VALUES(1,1,'Espresso',70,1,'[]')`);
      assert.equal((await f.pay(payment(1))).fiscalStatus,'failed');
      process.env.LOCALAPPDATA=f.directory;
      deviceTrial('SYNTHETIC01').claim();
      let calls=0;
      const adapter=selectPf700Checkout(['--pf700-routine-checkout'],f.directory,
        ()=>({expectedSerial:'SYNTHETIC01',dataDirectory:f.directory,domesticProduct:false}),
        profile=>({mode:'device',deviceId:'SYNTHETIC01',domesticProduct:false,registerSale:async (receipt,context)=>{
          assert.equal(profile.allowLegacyOrigin,true);
          assert.equal(receipt.domesticProduct,originalMark);
          calls++;
          if (calls===1) return {status:'failed'};
          context.beforeOpen({previousDocumentNumber:'0000041'});
          return {status:'accepted',reference:'0000042',evidence:{documentNumber:'0000042',fiscalReceiptCount:2,reversalCount:0}};
        }}));
      f.restart(adapter);
      assert.equal((await f.pay(payment(1))).fiscalStatus,'failed');
      assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,0);
      const result=await f.pay(payment(1)); assert.equal(result.ok,true);
      assert.equal(result.data.fiscal.receipt.domesticProduct,originalMark);
      assert.deepEqual(await f.pay(payment(1)),result);
      f.restart(adapter); assert.deepEqual(await f.pay(payment(1)),result);
      assert.equal(calls,2);
      assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_checkout_attempts').get().n,3);
      assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,1);
      assert.equal(adapter.canRegister(result.data.fiscal.receipt,null),false);
      assert.equal(adapter.canRegister(result.data.fiscal.receipt,{status:'uncertain',mode:'device',deviceId:'SYNTHETIC01'}),false);
    });
  }
});
