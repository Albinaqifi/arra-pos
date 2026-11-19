const { createHash } = require('node:crypto');
const { hasPermissions } = require('./permissions');
const { ownsOrder } = require('./order-ownership');
const { recordAudit } = require('./audit');
const { markService } = require('./shifts');
const { readFiscalCheckout } = require('./fiscal-checkout');
const { isCommissioned } = require('./pf700-commissioning');
const CHANNEL = 'arra:bill';

function snapshot(db, orderId) {
  const order = db.prepare("SELECT id, table_id AS tableId FROM orders WHERE id=? AND status='open' AND retired_empty = 0").get(orderId);
  if (!order) throw Error('Order unavailable');
  if (db.prepare("SELECT 1 FROM order_items WHERE order_id=? AND status='pending'").get(orderId)) throw Error('Send or remove new items before billing');
  const items = db.prepare(`SELECT i.id, i.name, i.unit_price AS unitPrice, i.quantity,
    COALESCE((SELECT SUM(c.quantity) FROM sent_item_corrections c WHERE c.item_id=i.id),0) AS corrected
    FROM order_items i WHERE i.order_id=? AND i.status='sent' ORDER BY i.id`).all(orderId);
  let total = 0;
  const lines = [];
  for (const item of items) {
    const quantity = item.quantity - item.corrected;
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw Error('Invalid corrections');
    if (!quantity) continue;
    const amount = item.unitPrice * quantity;
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(total + amount)) throw Error('Total too large');
    total += amount;
    const modifiers = db.prepare('SELECT group_name AS groupName, option_name AS optionName, adjustment FROM order_item_modifiers WHERE item_id=? ORDER BY rowid').all(item.id);
    lines.push({ itemId: item.id, name: item.name, unitPrice: item.unitPrice, quantity, modifiers });
  }
  if (!lines.length) throw Error('No eligible items');
  const data = { orderId, tableId: order.tableId, lines, total };
  return { ...data, fingerprint: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
}
function attachFiscalPreview(db, bill, adapter) {
  require('./supervised-card').attachPreview(db,bill,adapter);
  if (!adapter) return;
  bill.fiscalMode = adapter.mode;
  if (adapter.mode === 'simulation' && adapter.simulationRecoveryControls === true && !isCommissioned(db)) bill.simulationRecoveryControls = true;
  if (adapter.mode === 'device') {
    bill.fiscalDomesticProduct = adapter.domesticProduct;
    if (!adapter.supervisedCardTrial) bill.physicalCashControls = true;
  }
  if (adapter.requireOrigins) bill.fiscalRequiresOrigins = true;
  const groups = new Map(db.prepare(`SELECT t.item_id, t.tax_group FROM order_item_fiscal_tax t
    JOIN order_items i ON i.id=t.item_id WHERE i.order_id=?`).all(bill.orderId).map(row => [row.item_id, row.tax_group]));
  const origins = adapter.requireOrigins ? new Map(db.prepare(`SELECT o.item_id,o.domestic FROM order_item_fiscal_origin o
    JOIN order_items i ON i.id=o.item_id WHERE i.order_id=?`).all(bill.orderId).map(row => [row.item_id, !!row.domestic])) : null;
  for (const line of bill.lines) {
    if (origins?.has(line.itemId)) line.domesticProduct = origins.get(line.itemId);
    const group = groups.get(line.itemId);
    if (group) Object.assign(line, { taxGroup: group, taxRate: group === 'А' ? 18 : 10 });
  }
}

function registerBills(ipcMain, isAllowedSender, db, session, fiscalCheckout = null) {
  ipcMain.handle(CHANNEL, (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype ||
      !['review','generate'].includes(request.action) || !Number.isSafeInteger(request.orderId) || request.orderId <= 0 ||
      Reflect.ownKeys(request).length !== (request.action === 'review' ? 2 : 3) || !Object.hasOwn(request,'action') || !Object.hasOwn(request,'orderId') ||
      (request.action === 'generate' && (typeof request.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(request.fingerprint)))) return { ok: false, error: 'Invalid request' };
    if (!hasPermissions(db, session, 'orders.view', 'orders.change')) return { ok: false, error: 'Access denied' };
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!ownsOrder(db, session, request.orderId)) { db.exec('ROLLBACK'); return { ok:false, error:'Access denied' }; }
        const existing = db.prepare('SELECT id, fingerprint FROM bills WHERE order_id=?').get(request.orderId);
        if (existing) {
          if (request.action === 'generate' && existing.fingerprint !== request.fingerprint) throw Error('Bill already generated');
          const bill = db.prepare('SELECT id, order_id AS orderId, total, generated_at AS generatedAt, fingerprint FROM bills WHERE id=?').get(existing.id);
          bill.lines = db.prepare('SELECT item_id AS itemId, name, unit_price AS unitPrice, quantity, modifiers FROM bill_lines WHERE bill_id=? ORDER BY id').all(existing.id).map(l => ({ ...l, modifiers: JSON.parse(l.modifiers) }));
          const fiscal = readFiscalCheckout(db, bill.id);
          if (fiscal) bill.fiscal = fiscal;
          attachFiscalPreview(db, bill, fiscalCheckout);
          if (db.prepare('SELECT 1 FROM simulated_card_approvals WHERE bill_id=?').get(bill.id)) bill.simulatedCardApproval = true;
          const intent = db.prepare('SELECT id FROM simulated_card_open_intents WHERE bill_id=?').get(bill.id);
          if (intent) bill.simulatedCardIntent = {id:intent.id};
          const cashIntent = db.prepare('SELECT id,interruption FROM simulated_cash_open_intents WHERE bill_id=?').get(bill.id);
          if (cashIntent) bill.simulatedCashIntent = cashIntent;
          const physicalCash = db.prepare('SELECT id,device_id AS deviceId FROM pf700_cash_open_intents WHERE bill_id=?').get(bill.id);
          if (physicalCash) bill.physicalCashIntent = {id:physicalCash.id,profileMatches:fiscalCheckout?.mode==='device' && fiscalCheckout.deviceId===physicalCash.deviceId};
          if (require('./pf700-recovery-observation').candidate(db,bill.id,fiscalCheckout)) bill.canInspectPhysicalCash = true;
          db.exec('COMMIT'); return { ok: true, data: bill };
        }
        const data = snapshot(db, request.orderId);
        attachFiscalPreview(db, data, fiscalCheckout);
        if (request.action === 'generate') {
          if (data.fingerprint !== request.fingerprint) throw Error('Order changed; review the bill again');
          const generatedAt = Date.now();
          const id = db.prepare('INSERT INTO bills (order_id, actor_id, generated_at, total, fingerprint) VALUES (?, ?, ?, ?, ?)').run(request.orderId, session.currentUserId(), generatedAt, data.total, data.fingerprint).lastInsertRowid;
          markService(db, generatedAt);
          for (const line of data.lines) db.prepare('INSERT INTO bill_lines (bill_id, item_id, name, unit_price, quantity, modifiers) VALUES (?, ?, ?, ?, ?, ?)').run(id, line.itemId, line.name, line.unitPrice, line.quantity, JSON.stringify(line.modifiers));
          recordAudit(db, session.currentUserId(), 'generate', 'bill', id, request.orderId, {});
          data.id = id;
        }
        db.exec('COMMIT'); return { ok: true, data };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (error) { return { ok: false, error: ['Send or remove new items before billing','No eligible items','Order changed; review the bill again','Bill already generated'].includes(error.message) ? error.message : 'Could not prepare bill' }; }
  });
}
module.exports = { CHANNEL, registerBills };
