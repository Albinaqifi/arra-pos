const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { openDatabase } = require('../src/desktop/database');
const { authorizedDatabase } = require('./support/authorized-database');
const { seedTables } = require('../src/desktop/tables');
const { registerPayments } = require('../src/desktop/payments');
const { seedMenu } = require('../src/desktop/menu');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerPrintJobs } = require('../src/desktop/print-jobs');
const { registerBills } = require('../src/desktop/bills');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-independent-payment-'));
  const db = authorizedDatabase(openDatabase(dir));
  seedTables(db);
  db.exec("INSERT INTO orders (id,table_id,opened_at,status) VALUES (1,1,1,'open'); INSERT INTO bills (id,order_id,actor_id,generated_at,total,fingerprint) VALUES (1,1,1,1,735,'snapshot');");
  let call;
  registerPayments({ handle(_channel, fn) { call = fn; } }, () => true, db, { currentUserId: () => 1 });
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, db, call: request => call({}, request) };
}

test('failure closing order rolls back payment and preserves bill, then retry succeeds', t => {
  const { db, call } = setup(t);
  const request = { billId: 1, method: 'cash', account: 'B' };
  db.exec("CREATE TRIGGER fail_close BEFORE UPDATE OF status ON orders BEGIN SELECT RAISE(ABORT, 'close failed'); END");
  assert.equal(call(request).ok, false);
  assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM application_audit WHERE entity_type='payment'").get().n, 0);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=1').get().status, 'open');
  assert.equal(db.prepare('SELECT total FROM bills WHERE id=1').get().total, 735);
  db.exec('DROP TRIGGER fail_close');
  assert.equal(call(request).ok, true);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=1').get().status, 'completed');
  assert.equal(db.prepare('SELECT total FROM bills WHERE id=1').get().total, 735);
  assert.equal(db.prepare('SELECT amount FROM payments WHERE bill_id=1').get().amount, 735);
});

test('simultaneous separate connections and subsequent retries cannot duplicate payment', async t => {
  const { dir, db, call } = setup(t);
  const shared = new SharedArrayBuffer(4);
  const workerCode = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { openDatabase } = require(workerData.database);
    const { registerPayments } = require(workerData.payments);
    const db = openDatabase(workerData.dir);
    let call; registerPayments({handle(_c, fn) {call = fn;}}, () => true, db, {currentUserId: () => 1});
    parentPort.postMessage('ready');
    Atomics.wait(new Int32Array(workerData.shared), 0, 0);
    const result = call({}, {billId: 1, method: 'card', account: 'A'});
    db.close(); parentPort.postMessage(result);
  `;
  function start() {
    const worker = new Worker(workerCode, { eval: true, workerData: { dir, shared, database: require.resolve('../src/desktop/database'), payments: require.resolve('../src/desktop/payments') } });
    let readyResolve, resultResolve, reject;
    const ready = new Promise((resolve, fail) => { readyResolve = resolve; reject = fail; });
    const result = new Promise((resolve, fail) => { resultResolve = resolve; worker.on('error', fail); });
    worker.on('error', reject);
    worker.on('message', message => message === 'ready' ? readyResolve() : resultResolve(message));
    return { ready, result };
  }
  const workers = [start(), start()];
  await Promise.all(workers.map(w => w.ready));
  Atomics.store(new Int32Array(shared), 0, 1); Atomics.notify(new Int32Array(shared), 0, 2);
  const results = await Promise.all(workers.map(w => w.result));
  assert.ok(results.some(r => r.ok));
  const request = { billId: 1, method: 'card', account: 'A' };
  assert.equal(call(request).ok, true);
  assert.equal(call(request).ok, true);
  assert.equal(db.prepare('SELECT count(*) n FROM payments WHERE bill_id=1').get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM application_audit WHERE entity_type='payment'").get().n, 1);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=1').get().status, 'completed');
});

test('failed simulated preparation printing does not prevent payment or erase history', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-payment-print-'));
  const db = authorizedDatabase(openDatabase(dir));
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  seedTables(db); seedMenu(db);
  db.exec("INSERT INTO orders (id,table_id,opened_at,status) VALUES (1,1,1,'open')");
  const session = { currentUserId: () => 1 }, handlers = {};
  const ipc = { handle(channel, callback) { handlers[channel] = callback; } };
  for (const register of [registerOrderItems, registerPrintJobs, registerBills, registerPayments]) register(ipc, () => true, db, session);
  const orders = request => handlers['arra:order-items']({}, request);
  const jobs = request => handlers['arra:print-jobs']({}, request);
  const bills = request => handlers['arra:bill']({}, request);
  const payment = request => handlers['arra:payment']({}, request);
  assert.equal(jobs({ action: 'simulate', destination: 'kitchen', result: 'failed' }).ok, true);
  assert.equal(orders({ action: 'add', orderId: 1, productId: 'qebapa' }).ok, true);
  assert.equal(orders({ action: 'send', orderId: 1, requestId: 'sample-send' }).ok, true);
  assert.equal(jobs({ action: 'list' }).data.jobs[0].result, 'failed');
  const preview = bills({ action: 'review', orderId: 1 });
  assert.equal(preview.ok, true);
  const bill = bills({ action: 'generate', orderId: 1, fingerprint: preview.data.fingerprint });
  assert.equal(bill.ok, true);
  assert.equal(payment({ billId: bill.data.id, method: 'cash', account: 'A' }).ok, true);
  assert.equal(db.prepare('SELECT count(*) n FROM bill_lines').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM order_items').get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM print_attempts WHERE result='failed'").get().n, 1);
  assert.equal(db.prepare("SELECT status FROM orders WHERE id=1").get().status, 'completed');
});
