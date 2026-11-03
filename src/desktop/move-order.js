const { hasPermissions } = require('./permissions');
const { recordAudit } = require('./audit');
const CHANNEL = 'arra:move-order';

function registerMoveOrder(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) ||
        Object.getPrototypeOf(request) !== Object.prototype || Reflect.ownKeys(request).length !== 4 ||
        !['orderId', 'sourceId', 'destinationId', 'requestId'].every(k => Object.hasOwn(request, k)) ||
        !['orderId', 'sourceId', 'destinationId'].every(k => Number.isSafeInteger(request[k]) && request[k] > 0) ||
        typeof request.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(request.requestId) ||
        request.sourceId === request.destinationId) return { ok: false, error: 'Invalid request' };
    if (!hasPermissions(db, session, 'orders.view', 'orders.change')) return { ok: false, error: 'Access denied' };
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        const prior = db.prepare("SELECT order_id, context FROM application_audit WHERE action = 'move' AND entity_type = 'order' AND json_extract(context, '$.requestId') = ?").get(request.requestId);
        if (prior) {
          const context = JSON.parse(prior.context);
          const matches = prior.order_id === request.orderId && context.sourceId === request.sourceId && context.destinationId === request.destinationId &&
            !!db.prepare("SELECT 1 FROM orders WHERE id = ? AND table_id = ? AND status = 'open'").get(request.orderId, request.destinationId);
          db.exec('COMMIT');
          return matches ? { ok: true } : { ok: false, error: 'Invalid request' };
        }
        const order = db.prepare("SELECT id FROM orders WHERE id = ? AND table_id = ? AND status = 'open'").get(request.orderId, request.sourceId);
        const destination = db.prepare(`SELECT t.id FROM dining_tables t LEFT JOIN dining_areas a ON a.id = t.area_id
          WHERE t.id = ? AND t.active = 1 AND COALESCE(a.active, 1) = 1
          AND NOT EXISTS (SELECT 1 FROM orders WHERE table_id = t.id AND status = 'open')`).get(request.destinationId);
        if (!order || !destination) { db.exec('ROLLBACK'); return { ok: false, error: 'Order or destination unavailable' }; }
        db.prepare('UPDATE orders SET table_id = ? WHERE id = ?').run(request.destinationId, request.orderId);
        recordAudit(db, session.currentUserId(), 'move', 'order', request.orderId, request.orderId,
          { sourceId: request.sourceId, destinationId: request.destinationId, requestId: request.requestId });
        db.exec('COMMIT');
        return { ok: true };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (_) { return { ok: false, error: 'Could not move order' }; }
  });
}
module.exports = { CHANNEL, registerMoveOrder };
