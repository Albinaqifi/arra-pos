const { hasPermissions } = require('./permissions');
const { recordAudit } = require('./audit');
const CHANNEL = 'arra:move-items';
const validId = n => Number.isSafeInteger(n) && n > 0;
function registerMoveItems(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, r) => {
    const keys = ['orderId', 'sourceId', 'destinationId', 'destinationOrderId', 'itemIds', 'requestId'];
    if (!isAllowedSender(event) || !r || typeof r !== 'object' || Array.isArray(r) || Object.getPrototypeOf(r) !== Object.prototype ||
      Reflect.ownKeys(r).length !== keys.length || !keys.every(k => Object.hasOwn(r, k)) ||
      ![r.orderId, r.sourceId, r.destinationId].every(validId) || r.sourceId === r.destinationId ||
      !(r.destinationOrderId === null || validId(r.destinationOrderId)) || !Array.isArray(r.itemIds) || !r.itemIds.length ||
      r.itemIds.length > 1000 || !r.itemIds.every(validId) || new Set(r.itemIds).size !== r.itemIds.length ||
      typeof r.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(r.requestId)) return { ok: false, rejected: true };
    if (!hasPermissions(db, session, 'orders.view', 'orders.change')) return { ok: false, rejected: true };
    const ids = [...r.itemIds].sort((a,b) => a-b);
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        const prior = db.prepare("SELECT order_id, context FROM application_audit WHERE action='move_items' AND json_extract(context, '$.requestId') = ?").get(r.requestId);
        if (prior) {
          const c = JSON.parse(prior.context);
          const matches = prior.order_id === r.orderId && c.sourceId === r.sourceId && c.destinationId === r.destinationId && c.expectedDestinationOrderId === r.destinationOrderId && JSON.stringify(c.itemIds) === JSON.stringify(ids);
          db.exec('COMMIT'); return matches ? { ok: true } : { ok: false, rejected: true };
        }
        const source = db.prepare("SELECT id FROM orders WHERE id=? AND table_id=? AND status='open'").get(r.orderId, r.sourceId);
        const table = db.prepare('SELECT t.id FROM dining_tables t LEFT JOIN dining_areas a ON a.id=t.area_id WHERE t.id=? AND t.active=1 AND COALESCE(a.active,1)=1').get(r.destinationId);
        const dest = db.prepare("SELECT id FROM orders WHERE table_id=? AND status='open'").get(r.destinationId);
        if (!source || !table || (dest?.id || null) !== r.destinationOrderId || ids.some(id => !db.prepare('SELECT 1 FROM order_items WHERE id=? AND order_id=?').get(id, r.orderId))) {
          db.exec('ROLLBACK'); return { ok: false, rejected: true };
        }
        // Reject a merge that would make the destination total unrepresentable.
        let total = 0;
        const amount = db.prepare('SELECT unit_price, quantity FROM order_items WHERE id=?');
        const destinationItems = dest ? db.prepare('SELECT unit_price, quantity FROM order_items WHERE order_id=?').all(dest.id) : [];
        for (const item of [...destinationItems, ...ids.map(id => amount.get(id))]) {
          const line = item.unit_price * item.quantity;
          if (!Number.isSafeInteger(line) || !Number.isSafeInteger(total + line)) {
            db.exec('ROLLBACK'); return { ok: false, rejected: true };
          }
          total += line;
        }
        const destinationOrderId = dest ? dest.id : db.prepare("INSERT INTO orders (table_id, opened_at, status) VALUES (?, ?, 'open')").run(r.destinationId, Date.now()).lastInsertRowid;
        for (const id of ids) db.prepare('UPDATE order_items SET order_id=? WHERE id=? AND order_id=?').run(destinationOrderId, id, r.orderId);
        if (!db.prepare('SELECT 1 FROM order_items WHERE order_id=? LIMIT 1').get(r.orderId)) db.prepare("UPDATE orders SET status='completed' WHERE id=?").run(r.orderId);
        recordAudit(db, session.currentUserId(), 'move_items', 'order', r.orderId, r.orderId,
          { sourceId:r.sourceId, destinationId:r.destinationId, destinationOrderId, expectedDestinationOrderId:r.destinationOrderId, itemIds:ids, requestId:r.requestId });
        db.exec('COMMIT'); return { ok: true };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (_) { return { ok: false }; }
  });
}
module.exports = { CHANNEL, registerMoveItems };
