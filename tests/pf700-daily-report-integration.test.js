const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomInt } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../src/desktop/database');
const { dataDirectory } = require('../src/desktop/sample-data-directory');
const { seedSampleIdentities } = require('../src/desktop/sample-accounts');
const { seedArraMenu } = require('../src/desktop/arra-menu');
const { seedTables } = require('../src/desktop/tables');
const { registerSession } = require('../src/desktop/session');
const { registerOrders } = require('../src/desktop/orders');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerBills } = require('../src/desktop/bills');
const { registerPayments } = require('../src/desktop/payments');
const { registerTransferCorrection } = require('../src/desktop/transfer-correction');
const { registerBusinessDays } = require('../src/desktop/business-days');
const { selectPf700Checkout } = require('../src/desktop/pf700-checkout-mode');

const espresso = 'arra-product-11-0', beer = 'arra-product-12-0';
const issue = dayId => ({ action: 'accountAFiscalClose', dayId, mode: 'simulation', confirmed: true });
const reconcile = dayId => ({ action: 'accountAFiscalReconcile', dayId, mode: 'simulation' });

function trainingRestaurant(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-z-integration-'));
  fs.writeFileSync(path.join(directory, 'SAMPLE-DATA-ONLY'), '');
  const args = ['--sample-data-directory=' + directory, '--pf700-offline-checkout'];
  const trusted = {}, handlers = new Map(), ipc = { handle: (name, handler) => handlers.set(name, handler) };
  const allowed = event => event === trusted;
  let db;
  function start() {
    const profile = dataDirectory(args, null);
    const adapter = selectPf700Checkout(args, profile, assert.fail, assert.fail);
    assert.equal(adapter.mode, 'simulation');
    db = openDatabase(profile);
    const session = registerSession(ipc, allowed, db);
    registerOrders(ipc, allowed, db, session);
    registerOrderItems(ipc, allowed, db, session);
    registerBills(ipc, allowed, db, session, adapter);
    registerPayments(ipc, allowed, db, session, null, adapter);
    registerTransferCorrection(ipc, allowed, db, session);
    registerBusinessDays(ipc, allowed, db, session, () => 'failed', adapter.dailyReport);
  }
  start();
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const roles = ['restaurant', 'owner-a', 'owner-b', 'combined'];
  const passwords = roles.map(() => randomBytes(20).toString('hex'));
  const pins = { waiter: String(randomInt(1000, 10000)), transfer: String(randomInt(100000, 1000000)) };
  seedSampleIdentities(db, passwords, pins.waiter, pins.transfer);
  seedArraMenu(db);
  seedTables(db);

  function call(channel, request) { return handlers.get('arra:' + channel)(trusted, request); }
  function signIn(role) {
    const account = Object.hasOwn(pins, role) ? 'restaurant' : role;
    assert.equal(call('sign-in', { username: 'sample-' + account, password: passwords[roles.indexOf(account)] }).ok, true);
    if (account === 'restaurant') assert.equal(call('identify-staff', { kind: role, pin: pins[role] }).ok, true);
  }
  async function checkout(products, method = 'cash', account = 'A', incrementFirst = false) {
    const order = call('open-order', { tableId: 1 });
    assert.equal(order.ok, true);
    const orderId = order.data.id;
    for (const productId of products) {
      assert.equal(call('order-items', { action: 'add', productId, orderId }).ok, true);
    }
    if (incrementFirst) {
      const itemId = call('order-items', { action:'list', orderId }).data.items[0].id;
      assert.equal(call('order-items', { action:'increment', orderId, itemId }).ok,true);
    }
    assert.equal(call('order-items', { action: 'send', orderId, requestId: 'send-' + orderId }).ok, true);
    const review = call('bill', { action: 'review', orderId });
    assert.equal(review.ok, true);
    const bill = call('bill', { action: 'generate', orderId, fingerprint: review.data.fingerprint });
    assert.equal(bill.ok, true);
    const prepared = method === 'card' ? await call('payment', {billId:bill.data.id,method,account,prepareSimulated:true}) : null;
    if (prepared) assert.equal(prepared.ok,true);
    const request = { billId: bill.data.id, method, account, ...(prepared ? {terminalApproved:true,intentId:prepared.data.intentId} : {}) };
    const payment = await call('payment', request);
    assert.equal(payment.ok, true);
    assert.deepEqual(await call('payment', request), payment);
    return payment.data;
  }
  const days = req => call('business-days', req);
  const activeDay = () => days({ action: 'list' }).data.days.find(day => day.closedAt === null).id;
  async function closeSharedDay() {
    const dayId = activeDay();
    assert.equal(days({ action: 'close', dayId }).ok, true);
    await new Promise(setImmediate);
    assert.notEqual(activeDay(), dayId);
    return dayId;
  }
  function device(run) {
    const memory = new DatabaseSync(path.join(directory, 'simulated-pf700.sqlite'));
    try { return run(memory); } finally { memory.close(); }
  }
  const reports = () => device(memory => memory.prepare('SELECT z,cash,card,taxA,taxV FROM documents WHERE z>1 ORDER BY z').all().map(r => ({ ...r })));
  return { call, days, signIn, checkout, activeDay, closeSharedDay, device, reports,
    get db() { return db; }, restart() { db.close(); start(); } };
}

test('training checkout, authenticated Combined close and restart preserve each day, both tenders and both VAT groups', async t => {
  const start = new Date(2026, 10, 19, 18);
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const f = trainingRestaurant(t);
  f.signIn('waiter');
  const cash = await f.checkout([espresso, beer]);
  assert.deepEqual(cash.fiscal.receipt.lines.map(l => [l.unitPrice, l.taxGroup, l.taxRate]), [[70, 'В', 10], [180, 'А', 18]]);
  const card = await f.checkout([beer], 'card');
  assert.equal(card.fiscal.receipt.total, 180);
  await f.checkout([espresso], 'cash', 'B');
  f.signIn('combined');
  assert.equal((await f.days(issue(f.activeDay()))).ok, false);
  const firstDay = await f.closeSharedDay();
  const nextDay = f.activeDay();
  for (const role of ['owner-a', 'owner-b', 'waiter']) {
    f.signIn(role);
    assert.equal(f.days({ action: 'accountAList' }).ok, false);
    assert.equal((await f.days(issue(firstDay))).ok, false);
  }
  assert.deepEqual(f.reports(), []);
  f.signIn('combined');
  const first = f.days({ action: 'accountAList' }).data.days[0];
  assert.deepEqual([first.id, first.count, first.cash, first.card, first.total, first.fiscal.status],
    [firstDay, 2, 250, 180, 430, 'ready']);
  assert.equal((await f.days({ ...issue(firstDay), mode: 'device' })).ok, false);
  const [one, two] = await Promise.all([f.days(issue(firstDay)), f.days(issue(firstDay))]);
  assert.deepEqual(one, { ok: true });
  assert.deepEqual(two, { ok: false, error: 'pending' });
  assert.equal(f.activeDay(), nextDay);
  const firstTotals = { z: 2, cash: 250, card: 180, taxA: 360, taxV: 70 };
  assert.deepEqual(f.reports(), [firstTotals]);
  f.restart();
  assert.equal(f.days({ action: 'accountAList' }).ok, false);
  f.signIn('combined');
  assert.equal((await f.days(issue(firstDay))).ok, true);
  assert.deepEqual(f.reports(), [firstTotals]);
  assert.deepEqual(f.days({ action: 'accountAList' }).data.days[0].fiscal,
    { mode: 'simulation', status: 'complete', reportNumber: '0002' });

  f.signIn('waiter');
  await f.checkout([espresso], 'card');
  f.signIn('combined');
  assert.equal(await f.closeSharedDay(), nextDay);
  assert.deepEqual(await f.days(issue(nextDay)), { ok: false, error: 'preflight' });
  assert.deepEqual(f.reports(), [firstTotals]);
  t.mock.timers.setTime(new Date(2026, 10, 20, 18).getTime());
  assert.deepEqual(await f.days(issue(nextDay)), { ok: true });
  assert.deepEqual(f.reports(), [firstTotals, { z: 3, cash: 0, card: 70, taxA: 0, taxV: 70 }]);
  const history = f.days({ action: 'accountAList' }).data.days;
  assert.deepEqual(history.map(d => [d.id, d.total, d.fiscal.reportNumber]), [[nextDay, 70, '0003'], [firstDay, 430, '0002']]);
  assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n, 4);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('tender or VAT disagreement blocks before issue, and an interrupted POS confirmation recovers exactly once', async t => {
  const f = trainingRestaurant(t);
  f.signIn('waiter');
  await f.checkout([espresso, beer]);
  f.signIn('combined');
  const dayId = await f.closeSharedDay();
  // Disagree on tender without changing the gross amount, count or document number.
  f.device(db => db.exec('UPDATE documents SET cash=0,card=250 WHERE bill IS NOT NULL'));
  assert.deepEqual(await f.days(issue(dayId)), { ok: false, error: 'preflight' });
  assert.deepEqual(f.reports(), []);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_daily_reports').get().n, 0);
  f.device(db => db.exec('UPDATE documents SET cash=250,card=0,taxA=70,taxV=180 WHERE bill IS NOT NULL'));
  assert.deepEqual(await f.days(issue(dayId)), { ok: false, error: 'preflight' });
  assert.deepEqual(f.reports(), []);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_daily_reports').get().n, 0);
  f.device(db => db.exec('UPDATE documents SET taxA=180,taxV=70 WHERE bill IS NOT NULL'));
  f.db.exec("CREATE TEMP TRIGGER fail_confirmation BEFORE INSERT ON fiscal_daily_confirmations BEGIN SELECT RAISE(ABORT,'test interruption'); END");
  assert.deepEqual(await f.days(issue(dayId)), { ok: false, error: 'uncertain' });
  const onlyReport = [{ z: 2, cash: 250, card: 0, taxA: 180, taxV: 70 }];
  assert.deepEqual(f.reports(), onlyReport);
  assert.equal(f.db.prepare('SELECT count(*) n FROM account_a_closes').get().n, 0);
  f.restart();
  f.signIn('combined');
  assert.deepEqual(await f.days(issue(dayId)), { ok: false, error: 'uncertain' });
  assert.deepEqual(await f.days(reconcile(dayId)), { ok: true });
  assert.deepEqual(await f.days(reconcile(dayId)), { ok: true });
  assert.deepEqual(f.reports(), onlyReport);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_daily_confirmations').get().n, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM account_a_closes').get().n, 1);
});

test('a transfer into A stays in the shared-day totals and prevents issuing a fiscal report without a matching receipt', async t => {
  const f = trainingRestaurant(t);
  f.signIn('waiter');
  await f.checkout([espresso]);
  const cashB = await f.checkout([espresso], 'cash', 'B');
  f.signIn('transfer');
  assert.equal(f.call('transfer-correction', { action: 'correct', paymentId: cashB.id, reason: 'Sample correction' }).ok, true);
  f.signIn('combined');
  const dayId = await f.closeSharedDay();
  const summary = f.days({ action: 'accountAList' }).data.days[0];
  assert.deepEqual([summary.count, summary.cash, summary.fiscal.reason], [2, 140, 'coverage']);
  assert.deepEqual(await f.days(issue(dayId)), { ok: false, error: 'coverage' });
  assert.deepEqual(f.reports(), []);
});

test('offline training registers successive Cash A bills with a mixed quantity and VAT', async t => {
  const f=trainingRestaurant(t); f.signIn('waiter');
  const first=await f.checkout([espresso,beer],'cash','A',true);
  assert.equal(first.fiscal.receipt.total,320);
  assert.deepEqual(first.fiscal.receipt.lines.map(l=>[l.quantity,l.unitPrice,l.taxRate,l.domesticProduct]),[[2,70,10,true],[1,180,18,false]]);
  const second=await f.checkout([espresso]);
  assert.equal(second.fiscal.receipt.total,70);
  assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,2);
  assert.equal(f.device(db=>db.prepare('SELECT count(*) n FROM documents WHERE bill IS NOT NULL').get().n),2);
  f.restart();
  assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,2);
  assert.equal(f.device(db=>db.prepare('SELECT count(*) n FROM documents WHERE bill IS NOT NULL').get().n),2);
});
test('document warning permits a verified simulated Z but never overrides cash or tax mismatches', async t => {
  const f=trainingRestaurant(t); f.signIn('waiter'); await f.checkout([espresso,beer]);
  f.device(db=>{db.exec(`UPDATE documents SET doc=120 WHERE bill IS NOT NULL;
    PRAGMA ignore_check_constraints=ON;
    INSERT INTO documents(doc,bill,z,stamp,cash,card,taxA,taxV) VALUES(121,NULL,NULL,NULL,0,0,0,0);
    PRAGMA ignore_check_constraints=OFF;`);});
  f.signIn('combined'); const dayId=await f.closeSharedDay();
  assert.equal((await f.days({...issue(dayId),warningDocument:'0000121'})).ok,false);
  f.device(db=>db.exec('UPDATE documents SET cash=0,card=250 WHERE bill IS NOT NULL'));
  assert.deepEqual(await f.days(issue(dayId)),{ok:false,error:'preflight'});
  f.device(db=>db.exec('UPDATE documents SET cash=250,card=0,taxA=70,taxV=180 WHERE bill IS NOT NULL'));
  assert.deepEqual(await f.days(issue(dayId)),{ok:false,error:'preflight'});
  f.device(db=>db.exec('UPDATE documents SET taxA=180,taxV=70 WHERE bill IS NOT NULL'));
  assert.deepEqual(await f.days(issue(dayId)),{ok:false,error:'document-warning',saleDocument:'0000120',printerDocument:'0000121'});
  assert.deepEqual(f.reports(),[]);
  f.device(db=>db.exec('UPDATE documents SET cash=0,card=250 WHERE bill IS NOT NULL'));
  assert.deepEqual(await f.days({...issue(dayId),warningDocument:'0000121'}),{ok:false,error:'preflight'});
  assert.deepEqual(f.reports(),[]);
  f.device(db=>db.exec('UPDATE documents SET cash=250,card=0 WHERE bill IS NOT NULL'));
  assert.equal((await f.days(issue(dayId))).error,'document-warning');
  assert.deepEqual(await f.days({...issue(dayId),warningDocument:'0000121'}),{ok:true});
  assert.deepEqual(f.reports(),[{z:2,cash:250,card:0,taxA:180,taxV:70}]);
  assert.equal(f.db.prepare('SELECT document_number FROM fiscal_daily_confirmations').get().document_number,'0000122');
  assert.equal(f.days({action:'accountAList'}).data.days.find(d=>d.id===dayId).fiscal.status,'complete');
});
test('warning close with interrupted confirmation recovers using the printer document baseline',async t=>{
  const f=trainingRestaurant(t); f.signIn('waiter'); await f.checkout([espresso]);
  f.device(db=>db.exec(`UPDATE documents SET doc=120 WHERE bill IS NOT NULL; PRAGMA ignore_check_constraints=ON;
    INSERT INTO documents(doc,bill,z,stamp,cash,card,taxA,taxV) VALUES(121,NULL,NULL,NULL,0,0,0,0);
    PRAGMA ignore_check_constraints=OFF;`));
  f.signIn('combined'); const dayId=await f.closeSharedDay();
  assert.equal((await f.days(issue(dayId))).error,'document-warning');
  f.db.exec("CREATE TEMP TRIGGER fail_warning_confirm BEFORE INSERT ON fiscal_daily_confirmations BEGIN SELECT RAISE(ABORT,'test interruption'); END");
  assert.equal((await f.days({...issue(dayId),warningDocument:'0000121'})).error,'uncertain');
  assert.equal(f.reports().length,1); f.restart(); f.signIn('combined');
  assert.deepEqual(await f.days(reconcile(dayId)),{ok:true});
  assert.equal(f.db.prepare('SELECT document_number FROM fiscal_daily_confirmations').get().document_number,'0000122');
  assert.equal(f.reports().length,1);
});
