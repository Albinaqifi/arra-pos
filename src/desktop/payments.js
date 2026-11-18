const { hasPermissions } = require('./permissions');
const { recordAudit } = require('./audit');
const { markService, assignPayment } = require('./shifts');
const CHANNEL = 'arra:payment';
const { createBillJob, reserveAttempt, dispatch } = require('./test-printing');

function registerPayments(ipcMain, isAllowedSender, db, session, printing = null) {
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
        const bill = db.prepare("SELECT b.order_id AS orderId, b.total FROM bills b JOIN orders o ON o.id=b.order_id WHERE b.id=? AND o.status='open' AND o.retired_empty = 0").get(request.billId);
        if (!bill) throw Error('Bill unavailable');
        const paidAt = Date.now();
        const id = db.prepare('INSERT INTO payments (bill_id, actor_id, paid_at, amount, method, account) VALUES (?, ?, ?, ?, ?, ?)').run(request.billId, session.currentUserId(), paidAt, bill.total, request.method, request.account).lastInsertRowid;
        markService(db, paidAt);
        assignPayment(db, id, paidAt);
        db.prepare("UPDATE orders SET status='completed' WHERE id=? AND status='open' AND retired_empty = 0").run(bill.orderId);
        recordAudit(db, session.currentUserId(), 'record', 'payment', id, bill.orderId, {});
        let job = db.prepare('SELECT id FROM test_print_jobs WHERE bill_id=?').get(request.billId);
        const isNew = !job;
        if (isNew) job = { id: createBillJob(db, request.billId) };
        // A previously printed unpaid bill must never be printed automatically again.
        const attempt = isNew && printing ? reserveAttempt(db, job.id, 'payment-' + id, session.currentUserId()) : null;
        db.exec('COMMIT');
        if (attempt) dispatch(db, printing, attempt);
        return { ok: true, data: { id } };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (error) { return { ok: false, error: ['Bill unavailable', 'Bill already paid with a different selection'].includes(error.message) ? error.message : 'Could not record payment. Retry the same selection.' }; }
  });
}
module.exports = { CHANNEL, registerPayments };
