const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createHash, randomInt } = require('node:crypto');
const { migrate } = require('../../src/desktop/database');
const { enroll } = require('../../src/desktop/pf700-commissioning');
const { seedTables } = require('../../src/desktop/tables');
const { seedArraMenu } = require('../../src/desktop/arra-menu');
const { registerOrderItems } = require('../../src/desktop/order-items');
const { registerBills } = require('../../src/desktop/bills');
const { registerPayments } = require('../../src/desktop/payments');
const { buildReceipt } = require('../../src/desktop/fiscal-checkout');
const { probeIdentity } = require('../../src/desktop/pf700-windows-checkout');
const { executePf700Checkout } = require('../../src/desktop/pf700-checkout-protocol');
const { createStatefulPf700 } = require('./pf700-stateful-device');
const { authorizedDatabase } = require('./authorized-database');

const digest = data => createHash('sha256').update(data).digest('hex');

// Full local sale on an in-memory PF700, including a wrapped sequence and
// one close intent. Only the delivery or receipt of that last command varies.
async function lostClose(t, fault, {otherTax = false, reverse = false, imported = false, filename = ':memory:', originalPayer = 1} = {}) {
  const db = new DatabaseSync(filename);
  t.after(() => db.close());
  migrate(db);
  authorizedDatabase(db);
  enroll(db);
  seedTables(db);
  seedArraMenu(db);
  const device = createStatefulPf700();
  device.state.document = 29;
  if (fault !== 'afterTrace') device.fault(56, fault);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'other-fixture',x'00',x'00');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,2,'open');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,0,'unused');
    INSERT INTO order_waiter_ownership VALUES(2,1,1,1,'open');
    UPDATE menu_product_fiscal_origin SET domestic=1 WHERE product_id IN ('arra-product-11-0','arra-product-11-1')`);
  const profile = {
    mode:'device', deviceId:device.serial, domesticProduct:false, requireOrigins:true,
    async registerSale(receipt, journal) {
      let probeId, probeHash;
      const identity = await probeIdentity({exchange(frame) {
        probeId = journal.beforeCommand({sequence:127, command:90, requestHash:digest(frame)});
        const reply = device.exchange(frame);
        probeHash = digest(reply);
        return reply;
      }}, 127, device.serial);
      assert.ok(identity.ok && identity.onsiteFirmware);
      journal.afterCommand({id:probeId, responseHash:probeHash, summary:{identityMatched:true, onsiteFirmware:true}});
      const result = await executePf700Checkout(receipt, { ...journal, firstSequence:32, domesticProduct:false, onsiteFirmware:true,
        operatorNumber:1, operatorPassword:String(randomInt(100000,1000000)), tillNumber:1 }, device.exchange);
      if (fault === 'afterTrace') throw Error('Fixture interrupted before the accepted result was saved');
      return result;
    }
  };
  if (otherTax) db.exec("UPDATE menu_product_fiscal_tax SET tax_group='А' WHERE product_id='arra-product-11-0'");
  if (imported) db.exec("UPDATE menu_product_fiscal_origin SET domestic=0 WHERE product_id='arra-product-11-0'");
  const handlers = {};
  const ipc = {handle(channel, handler) { handlers[channel] = handler; }};
  const session = {currentUserId:() => 1, authenticatedUserId:() => 1, identityGeneration:() => 0};
  registerOrderItems(ipc, () => true, db, session);
  registerBills(ipc, () => true, db, session, profile);
  registerPayments(ipc, () => true, db, session, null, profile);
  const products = ['arra-product-11-0','arra-product-11-1'];
  for (const productId of reverse ? products.reverse() : products) {
    assert.ok(handlers['arra:order-items']({}, {action:'add', orderId:2, productId}).ok);
  }
  assert.ok(handlers['arra:order-items']({}, {action:'send', orderId:2, requestId:'synthetic-send'}).ok);
  const {fingerprint} = handlers['arra:bill']({}, {action:'review', orderId:2}).data;
  assert.equal(handlers['arra:bill']({}, {action:'generate', orderId:2, fingerprint}).data.id, 2);
  const selection = {billId:2, method:'cash', account:'A'};
  // Exercise a saved selection with a different historical payer from the
  // current owner, without changing waiter-ownership rules or historical rows.
  if (originalPayer !== 1) db.prepare(`INSERT INTO pf700_cash_intents(bill_id,actor_id,device_id,receipt,created_at)
    VALUES(2,?,?,?,?)`).run(originalPayer,device.serial,JSON.stringify(buildReceipt(db,2,'cash',150,profile)),Date.now());
  const {intentId} = handlers['arra:payment']({}, {...selection, preparePhysicalCash:true}).data;
  assert.equal((await handlers['arra:payment']({}, {...selection, physicalIntentId:intentId})).fiscalStatus, 'uncertain');
  return {db, device};
}

module.exports = { lostClose };
