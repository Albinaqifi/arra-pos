const { untouchedOrder } = require('./untouched-order');
const { recordAudit } = require('./audit');
const { hasPermissions } = require('./permissions');
const CHANNEL = 'arra:open-order';

function registerOrders(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' ||
        Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype ||
        Reflect.ownKeys(request).length !== 1 || !Object.hasOwn(request, 'tableId') ||
        !Number.isSafeInteger(request.tableId) || request.tableId <= 0)
      return { ok: false, error: 'Invalid request' };
    if (!hasPermissions(db, session, 'orders.view')) return { ok: false, error: 'Access denied' };
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        const findOrder = db.prepare(`SELECT id, table_id AS tableId, opened_at AS openedAt, CASE WHEN ${untouchedOrder('orders')} THEN 1 ELSE 0 END AS untouched FROM orders WHERE table_id = ? AND status = 'open' AND retired_empty = 0`);
        if (!db.prepare("SELECT 1 FROM dining_tables t LEFT JOIN dining_areas a ON a.id = t.area_id WHERE t.id = ? AND t.active = 1 AND COALESCE(a.active, 1) = 1").get(request.tableId)) { db.exec('ROLLBACK'); return { ok: false, error: 'Table unavailable' }; }
        let order = findOrder.get(request.tableId);
        if (!order) {
          if (!hasPermissions(db, session, 'orders.change')) {
            db.exec('ROLLBACK');
            return { ok: false, error: 'Access denied' };
          }
          db.prepare(`INSERT INTO orders (table_id, opened_at, status)
            SELECT t.id, ?, 'open' FROM dining_tables t LEFT JOIN dining_areas a ON a.id = t.area_id WHERE t.id = ? AND t.active = 1 AND COALESCE(a.active, 1) = 1
            ON CONFLICT DO NOTHING`).run(Date.now(), request.tableId);
          order = findOrder.get(request.tableId);
          if (order) { recordAudit(db, session.currentUserId(), 'open', 'order', order.id, order.id, { tableId: order.tableId }); order = findOrder.get(request.tableId); }
        }
        db.exec('COMMIT');
        return order ? { ok: true, data: order } : { ok: false, error: 'Table unavailable' };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } catch (_) {
      return { ok: false, error: 'Could not open table' };
    }
  });
}
module.exports = { CHANNEL, registerOrders };
