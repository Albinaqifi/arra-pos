// Separate-process view of the stateful service fixture after a lost reply.
// Only the temporary database and bill ID cross the restart boundary.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const { openDatabase } = require('../../src/desktop/database');
const { createWindowsPf700Checkout } = require('../../src/desktop/pf700-windows-checkout');
const { registerBills } = require('../../src/desktop/bills');
const { registerPayments } = require('../../src/desktop/payments');

async function inspect(directory, billId) {
  const root = fs.realpathSync(directory);
  assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('arra-s096-stateful-'));
  assert.ok(Number.isSafeInteger(billId) && billId > 0);
  const db = openDatabase(root);
  try {
    let transportStarts = 0;
    const adapter = createWindowsPf700Checkout({
      expectedSerial:'SYNTHETIC01', operatorNumber:2, tillNumber:1, domesticProduct:false,
      operatorPassword:String(randomInt(100000,1000000))
    }, () => { transportStarts++; throw Error('Unexpected transport access'); });
    const handlers = {};
    const ipc = {handle(channel, handler) { handlers[channel] = handler; }};
    const session = {currentUserId:()=>1,authenticatedUserId:()=>1,identityGeneration:()=>0};
    registerBills(ipc,()=>true,db,session,adapter);
    registerPayments(ipc,()=>true,db,session,null,adapter);
    const {orderId} = db.prepare('SELECT order_id AS orderId FROM bills WHERE id=?').get(billId);
    const {data:bill} = handlers['arra:bill']({}, {action:'review',orderId});
    const {receipt,baseline,reference,status} = bill.fiscal;
    const inspection = await handlers['arra:payment']({}, {
      billId,method:'cash',account:'A',inspectPhysicalCash:true,checkedNoOtherActivity:true
    });
    const latest = db.prepare(`SELECT c.command,a.command_id FROM pf700_command_intents c
      LEFT JOIN pf700_command_acks a ON a.command_id=c.id ORDER BY c.id DESC LIMIT 1`).get();
    return {
      item:receipt.lines[0].name, total:receipt.total, method:receipt.method, account:receipt.account,
      receiptStatus:status, previousDocument:baseline.previousDocumentNumber,
      expectedDocument:baseline.expectedDocumentNumber, confirmedDocument:reference,
      canInspect:Boolean(bill.canInspectPhysicalCash), inspection:inspection.fiscalStatus, transportStarts,
      lastCommand:latest.command, lastAcknowledged:latest.command_id !== null,
      seals:db.prepare('SELECT count(*) n FROM pf700_command_seals').get().n,
      payments:db.prepare('SELECT count(*) n FROM payments').get().n
    };
  } finally { db.close(); }
}

inspect(process.argv[2], Number(process.argv[3])).then(result => process.stdout.write(JSON.stringify(result)));
