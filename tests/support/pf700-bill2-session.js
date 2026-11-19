const { registerBills } = require('../../src/desktop/bills');
const { registerPayments } = require('../../src/desktop/payments');
const { createBill2JournalRecovery } = require('../../src/desktop/pf700-bill2-journal');

function recoverySession(db, directory, pin, actor = 1) {
  const session = {currentUserId:() => actor, authenticatedUserId:() => actor, identityGeneration:() => 0};
  const handlers = {};
  const ipc = {handle(name, handler) { handlers[name] = handler; }};
  const writes = [];
  const unexpected = () => { writes.push('printer'); throw Error('Unexpected printer access'); };
  const adapter = {mode:'device', deviceId:'SYNTHETIC01', domesticProduct:false, requireOrigins:true,
    registerSale:unexpected, acquireCashObservation:unexpected};
  const recovery = pin && createBill2JournalRecovery(directory,pin);
  registerBills(ipc, () => true, db, session, adapter, recovery);
  registerPayments(ipc, () => true, db, session, unexpected, adapter, recovery);
  return {review:() => handlers['arra:bill']({}, {action:'review',orderId:2}),
    pay:request => handlers['arra:payment']({}, request), writes};
}

const finish = {billId:2,method:'cash',account:'A',acknowledgedDocument:'0000030'};
module.exports = { recoverySession, finish };

// Both independent sessions must reach the waiter review before either can
// finish. SQLite, not the renderer or an in-process JS lock, elects the writer.
const { parentPort, workerData } = require('node:worker_threads');
if (parentPort && workerData?.bill2Race) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(workerData.filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  const session = recoverySession(db,workerData.directory,workerData.pin);
  parentPort.postMessage(session.review().data.fiscal.status);
  parentPort.once('message', () => {
    const result = session.pay(finish);
    db.close();
    parentPort.postMessage({result,writes:session.writes});
  });
}
