const { recordAudit } = require('./audit');
const CHANNEL = 'arra:transfer-correction';
const plain = x => x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const fields = (x, names) => Reflect.ownKeys(x).length === names.length && names.every(n => Object.hasOwn(x, n));
function registerTransferCorrection(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, req) => {
    if (!isAllowedSender(event) || !plain(req) || !((req.action === 'list' && fields(req, ['action'])) ||
      (req.action === 'correct' && fields(req, ['action', 'paymentId', 'reason']) && Number.isSafeInteger(req.paymentId) && req.paymentId > 0 && typeof req.reason === 'string' && req.reason.length <= 500))) return { ok: false };
    try {
      const actor = session.currentUserId();
      if (!actor || !session.authenticatedUserId() || !db.prepare('SELECT 1 FROM transfer_managers tm JOIN local_users u ON u.id=tm.user_id WHERE tm.user_id=? AND u.active=1 AND u.pin_hash IS NOT NULL AND u.pin_salt IS NOT NULL').get(actor)) return { ok: false };
      if (req.action === 'list') return { ok: true, data: { tables: db.prepare('SELECT id, area, active FROM dining_tables ORDER BY id').all(), payments: db.prepare(`SELECT p.id, p.amount, p.paid_at AS paidAt, o.table_id AS tableId
        FROM payments p JOIN bills b ON b.id=p.bill_id JOIN orders o ON o.id=b.order_id
        JOIN payment_business_days pd ON pd.payment_id=p.id JOIN business_days d ON d.id=pd.business_day_id
        WHERE p.method='cash' AND p.account='B' AND d.closed_at IS NULL AND NOT EXISTS (SELECT 1 FROM payment_account_corrections c WHERE c.payment_id=p.id)
        ORDER BY o.table_id, p.id DESC`).all() } };
      db.exec('BEGIN IMMEDIATE');
      try {
        const now = Date.now();
        const id = db.prepare('INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(?,?,?,?)').run(req.paymentId, actor, now, req.reason.trim()).lastInsertRowid;
        recordAudit(db, actor, 'correct_account', 'payment', req.paymentId, null, {});
        db.exec('COMMIT'); return { ok: true, data: { id } };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (_) { return { ok: false }; }
  });
}
module.exports = { CHANNEL, registerTransferCorrection };
