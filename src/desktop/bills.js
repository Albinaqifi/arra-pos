const { createHash } = require('node:crypto');
const { hasPermissions } = require('./permissions');
const { recordAudit } = require('./audit');
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
function registerBills(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype ||
      !['review','generate'].includes(request.action) || !Number.isSafeInteger(request.orderId) || request.orderId <= 0 ||
      Reflect.ownKeys(request).length !== (request.action === 'review' ? 2 : 3) || !Object.hasOwn(request,'action') || !Object.hasOwn(request,'orderId') ||
      (request.action === 'generate' && (typeof request.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(request.fingerprint)))) return { ok: false, error: 'Invalid request' };
    if (!hasPermissions(db, session, 'orders.view', 'orders.change')) return { ok: false, error: 'Access denied' };
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = db.prepare('SELECT id, fingerprint FROM bills WHERE order_id=?').get(request.orderId);
        if (existing) {
          if (request.action === 'generate' && existing.fingerprint !== request.fingerprint) throw Error('Bill already generated');
          const bill = db.prepare('SELECT id, order_id AS orderId, total, generated_at AS generatedAt, fingerprint FROM bills WHERE id=?').get(existing.id);
          bill.lines = db.prepare('SELECT item_id AS itemId, name, unit_price AS unitPrice, quantity, modifiers FROM bill_lines WHERE bill_id=? ORDER BY id').all(existing.id).map(l => ({ ...l, modifiers: JSON.parse(l.modifiers) }));
          db.exec('COMMIT'); return { ok: true, data: bill };
        }
        const data = snapshot(db, request.orderId);
        if (request.action === 'generate') {
          if (data.fingerprint !== request.fingerprint) throw Error('Order changed; review the bill again');
          const id = db.prepare('INSERT INTO bills (order_id, actor_id, generated_at, total, fingerprint) VALUES (?, ?, ?, ?, ?)').run(request.orderId, session.currentUserId(), Date.now(), data.total, data.fingerprint).lastInsertRowid;
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
