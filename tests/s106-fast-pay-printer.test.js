const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { createFastPayPrinterAccess, ledgerDirectory } = require('../src/desktop/fast-pay-printer-access');
const { registerFastPayments } = require('../src/desktop/fast-pay-service');
const { createPf700PrinterControl } = require('../src/desktop/pf700-printer-control');
const { createStatefulPf700 } = require('./support/pf700-stateful-device');
const { authorizedDatabase } = require('./support/authorized-database');

function localProfile(t) {
  const previous = process.env.LOCALAPPDATA;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-slip-queue-'));
  process.env.LOCALAPPDATA = root;
  t.after(() => {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    fs.rmSync(root, {recursive:true, force:true});
  });
  return root;
}

async function until(condition) {
  const end = Date.now() + 5000;
  while (!condition()) {
    assert.ok(Date.now() < end, 'Timed out waiting for the receipt worker');
    await delay(10);
  }
}

function emptyReply(frame) {
  const body=Buffer.concat([Buffer.from([43,frame[2],frame[3],4]),Buffer.from('888080e1809a','hex'),Buffer.from([5])]);
  const sum=body.reduce((a,b)=>a+b,0);
  return Buffer.concat([Buffer.from([1]),body,Buffer.from([12,8,4,0].map(x=>48+(sum>>x&15))),Buffer.from([3])]);
}
test('a periodic report with a delayed reply leaves queued sales waiting until the printer is available', async t => {
  const root = localProfile(t);
  const db = authorizedDatabase(require('../src/desktop/database').openDatabase(path.join(root, 'pos')));
  require('../src/desktop/pf700-commissioning').enroll(db);
  require('../src/desktop/tables').seedTables(db);
  require('../src/desktop/arra-menu').seedArraMenu(db);
  db.exec("INSERT OR IGNORE INTO menu_product_fiscal_origin VALUES('arra-product-11-0',1)");
  const printer = createStatefulPf700();
  const cashCommands = [];
  let loseReply;
  const cash = createPf700PrinterControl({
    expectedSerial:printer.serial, printerWait:createFastPayPrinterAccess(),
    openPipe:async () => ({
      async exchange(frame) {
        cashCommands.push(frame[3]);
        if (frame[3] === 90) return printer.exchange(frame);
        return new Promise(resolve => { loseReply = () => resolve(emptyReply(frame)); });
      },
      close:async () => {}
    })
  });
  const slip = cash.printPeriodicReport({command:95,data:'0001,0002'}, () => true);
  await until(() => loseReply);

  // This adapter uses a different access instance, as in a second POS process.
  const printerWait = createFastPayPrinterAccess();
  const warnings = [];
  printerWait.subscribe(waiting => warnings.push(waiting));
  const sales = [];
  const adapter = {
    mode:'device', deviceId:printer.serial, domesticProduct:false, requireOrigins:true, fastPayVersion:1,
    printerWait, canRegister:() => true,
    async registerSale(receipt, context) {
      sales.push(receipt.billId);
      const previousDocumentNumber = String(sales.length).padStart(7, '0');
      const documentNumber = String(sales.length + 1).padStart(7, '0');
      context.beforeOpen({previousDocumentNumber});
      return {status:'accepted', reference:documentNumber, evidence:{documentNumber, fiscalReceiptCount:sales.length, reversalCount:0}};
    }
  };
  const handlers = {}, ipc = {handle(name, fn) { handlers[name] = fn; }};
  const session = {currentUserId:() => 1, authenticatedUserId:() => 1, identityGeneration:() => 1};
  const start = () => registerFastPayments(ipc, () => true, db, session, null, adapter);
  let worker = start();
  require('../src/desktop/bills').registerBills(ipc, () => true, db, session, adapter);
  require('../src/desktop/order-items').registerOrderItems(ipc, () => true, db, session);
  const call = (channel, request) => {
    const response = handlers['arra:' + channel]({}, request);
    assert.equal(response.ok, true, response.error);
    return response.data;
  };
  try {
    await delay(20); // Startup while another process holds the printer, with no sale waiting.
    assert.deepEqual(warnings, []);
    db.exec("INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1000,'open'); INSERT INTO order_waiter_ownership VALUES(1,1,1,1,'open')");
    call('order-items', {action:'add', orderId:1, productId:'arra-product-11-0'});
    call('order-items', {action:'send', orderId:1, requestId:'synthetic-send-1'});
    const review = call('bill', {action:'review', orderId:1});
    const bill = call('bill', {action:'generate', orderId:1, fingerprint:review.fingerprint});
    const pay = {billId:bill.id, method:'cash', account:'A', fastPay:true};
    assert.equal(call('payment', pay).receiptStatus, 'queued');
    await until(() => printerWait.isWaiting());
    assert.equal(call('payment', pay).receiptStatus, 'queued');
    db.exec("INSERT INTO orders(id,table_id,opened_at,status) VALUES(2,2,1001,'open'); INSERT INTO order_waiter_ownership VALUES(2,1,1,1,'open')");
    call('order-items', {action:'add', orderId:2, productId:'arra-product-11-0'});
    call('order-items', {action:'send', orderId:2, requestId:'synthetic-send-2'});
    const secondReview = call('bill', {action:'review', orderId:2});
    const secondBill = call('bill', {action:'generate', orderId:2, fingerprint:secondReview.fingerprint});
    assert.equal(call('payment', {billId:secondBill.id, method:'cash', account:'A', fastPay:true}).receiptStatus, 'queued');
    assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n, 2);
    assert.equal(db.prepare('SELECT count(*) n FROM fast_pay_v1_claims').get().n, 0);
    assert.deepEqual(fs.readdirSync(ledgerDirectory()).filter(name => /\.(used|order)$/.test(name)), []);
    assert.deepEqual(sales, []);

    worker.stop();
    await until(() => !printerWait.isWaiting());
    worker = start();
    await until(() => printerWait.isWaiting());
    loseReply();
    assert.equal(await slip, 'accepted');
    await until(() => db.prepare("SELECT count(*) n FROM fast_pay_v1_status WHERE receipt_status='acknowledged'").get().n === 2);
    assert.deepEqual(cashCommands, [90, 95]);
    assert.deepEqual(sales, [bill.id, secondBill.id]);
    assert.deepEqual(warnings, [true, false, true, false]);
    assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n, 2);
  } finally {
    worker.stop();
    loseReply();
    await slip;
    db.close();
  }
});


test('a periodic report waiting for the printer stops if authorization expires', async t => {
  localProfile(t);
  const selling=await createFastPayPrinterAccess().acquire(()=>true);
  const printerWait=createFastPayPrinterAccess(); let authorized=true, opened=0;
  const control=createPf700PrinterControl({expectedSerial:'SYNTHETIC01',printerWait,openPipe:async()=>{opened++; throw Error('Unexpected open');}});
  try {
    const result=control.printPeriodicReport({command:95,data:'0001,0002'},()=>authorized);
    assert.equal(printerWait.isWaiting(),true); authorized=false;
    assert.equal(await result,'failed'); assert.equal(opened,0);
  } finally {selling.close();}
});
