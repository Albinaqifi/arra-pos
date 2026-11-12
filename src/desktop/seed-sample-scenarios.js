// Populate a fresh marked development database using the same services as the app.
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('./database');
const { registerOrders } = require('./orders');
const { registerOrderItems } = require('./order-items');
const { registerBills } = require('./bills');
const { registerPayments } = require('./payments');
const { registerTransferCorrection } = require('./transfer-correction');

function seedScenarios(db) {
  const waiter = db.prepare("SELECT id FROM local_users WHERE username='sample-waiter' AND active=1").get();
  const manager = db.prepare('SELECT tm.user_id AS id FROM transfer_managers tm JOIN local_users u ON u.id=tm.user_id WHERE u.active=1 AND u.pin_hash IS NOT NULL').get();
  if (!waiter || !manager || db.prepare('SELECT 1 FROM orders LIMIT 1').get() || db.prepare('SELECT 1 FROM payments LIMIT 1').get()) throw Error('Requires fresh sample accounts, a sample transfer manager, and no existing orders or payments');
  for (let id = 1; id <= 7; id++) if (!db.prepare('SELECT 1 FROM dining_tables WHERE id=? AND active=1').get(id)) throw Error('Seed sample tables first');
  for (const id of ['qebapa', 'shopska', 'espresso', 'cola', 'baklava']) if (!db.prepare('SELECT 1 FROM menu_products WHERE id=? AND active=1').get(id)) throw Error('Seed sample menu first');
  let actor = waiter.id;
  const session = { currentUserId: () => actor, authenticatedUserId: () => waiter.id };
  const handlers = {}, ipc = { handle: (channel, fn) => { handlers[channel] = fn; } };
  for (const register of [registerOrders, registerOrderItems, registerBills, registerPayments, registerTransferCorrection]) register(ipc, () => true, db, session);
  function call(channel, request) {
    const result = handlers[channel]({}, request);
    if (!result.ok) throw Error(result.error || 'Sample operation failed');
    return result.data;
  }
  function order(table, products, send = true) {
    const id = call('arra:open-order', { tableId: table }).id;
    for (const productId of products) call('arra:order-items', { action: 'add', orderId: id, productId });
    if (send) call('arra:order-items', { action: 'send', orderId: id, requestId: 'sample-scenario-send-' + table });
    return id;
  }
  function bill(id) {
    const review = call('arra:bill', { action: 'review', orderId: id });
    return call('arra:bill', { action: 'generate', orderId: id, fingerprint: review.fingerprint });
  }
  function paid(table, products, method, account) {
    const b = bill(order(table, products));
    return call('arra:payment', { billId: b.id, method, account }).id;
  }
  paid(1, ['qebapa', 'cola'], 'cash', 'A');
  paid(2, ['shopska', 'espresso'], 'cash', 'B');
  paid(3, ['qebapa', 'baklava'], 'card', 'A');
  const transferred = paid(4, ['baklava', 'cola'], 'cash', 'B');
  actor = manager.id;
  call('arra:transfer-correction', { action: 'correct', paymentId: transferred, reason: 'Sample B to A transfer' });
  actor = waiter.id;
  bill(order(5, ['shopska', 'cola'])); // Generated but unpaid.
  order(6, ['qebapa', 'espresso'], false); // Open, unsent items.
  const corrected = order(7, ['qebapa', 'cola']);
  const item = call('arra:order-items', { action: 'list', orderId: corrected }).items.find(x => x.productId === 'qebapa');
  call('arra:order-items', { action: 'correct', orderId: corrected, itemId: item.id, quantity: 1, reason: 'Sample cancelled item', requestId: 'sample-scenario-cancel-7' });
  return { paidBills: 4, unpaidBills: 1, openOrders: 2 };
}

if (require.main === module) {
  const directory = process.argv[2];
  if (process.argv.length !== 3 || !path.isAbsolute(directory) || !fs.existsSync(path.join(directory, 'SAMPLE-DATA-ONLY')) || !fs.existsSync(path.join(directory, 'arra.sqlite'))) {
    console.error('Usage: node src/desktop/seed-sample-scenarios.js <absolute sample directory>');
    process.exitCode = 1;
  } else {
    let db;
    try {
      db = openDatabase(directory); seedScenarios(db);
      console.log('Sample scenarios created: tables 1–4 paid (cash A, cash B, card A, B-to-A transfer); table 5 unpaid bill; table 6 pending order; table 7 sent item cancelled by correction.');
    } catch (error) {
      console.error('Sample scenario setup failed: ' + error.message + '. If setup partially ran, create a fresh sample database; no existing data was deleted.');
      process.exitCode = 1;
    } finally { if (db) db.close(); }
  }
}
module.exports = { seedScenarios };
