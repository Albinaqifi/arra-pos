const { hasPermissions } = require('./permissions');
const { recordAudit } = require('./audit');
const CHANNEL = 'arra:payment';

function registerPayments(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype ||
      Reflect.ownKeys(request).length !== 3 || !['billId', 'method', 'account'].every(k => Object.hasOwn(request, k)) ||
      !Number.isSafeInteger(request.billId) || request.billId <= 0 || !['cash', 'card'].includes(request.method) ||
      !['A', 'B'].includes(request.account) || (request.method === 'card' && request.account !== 'A')) return { ok: false, error: 'Invalid request' };
    if (!hasPermissions(db, session, 'orders.view', 'orders.change')) return { ok: false, error: 'Access denied' };
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = db.prepare('SELECT id, method, account FROM payments WHERE bill_id=?').get(request.billId);
        if (existing) {
          if (existing.method !== request.method || existing.account !== request.account) throw Error('Bill already paid with a different selection');
          db.exec('COMMIT'); return { ok: true, data: { id: existing.id } };
        }
        const bill = db.prepare("SELECT b.order_id AS orderId, b.total FROM bills b JOIN orders o ON o.id=b.order_id WHERE b.id=? AND o.status='open'").get(request.billId);
        if (!bill) throw Error('Bill unavailable');
        const id = db.prepare('INSERT INTO payments (bill_id, actor_id, paid_at, amount, method, account) VALUES (?, ?, ?, ?, ?, ?)').run(request.billId, session.currentUserId(), Date.now(), bill.total, request.method, request.account).lastInsertRowid;
        db.prepare("UPDATE orders SET status='completed' WHERE id=? AND status='open'").run(bill.orderId);
        recordAudit(db, session.currentUserId(), 'record', 'payment', id, bill.orderId, {});
        db.exec('COMMIT'); return { ok: true, data: { id } };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (error) { return { ok: false, error: ['Bill unavailable', 'Bill already paid with a different selection'].includes(error.message) ? error.message : 'Could not record payment. Retry the same selection.' }; }
  });
}
module.exports = { CHANNEL, registerPayments };
