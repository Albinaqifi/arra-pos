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
        const findOrder = db.prepare("SELECT id, table_id AS tableId, opened_at AS openedAt FROM orders WHERE table_id = ? AND status = 'open'");
        let order = findOrder.get(request.tableId);
        if (!order) {
          if (!hasPermissions(db, session, 'orders.change')) {
            db.exec('ROLLBACK');
            return { ok: false, error: 'Access denied' };
          }
          db.prepare(`INSERT INTO orders (table_id, opened_at, status)
            SELECT id, ?, 'open' FROM dining_tables WHERE id = ?
            ON CONFLICT DO NOTHING`).run(Date.now(), request.tableId);
          order = findOrder.get(request.tableId);
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
