const { hasPermissions } = require('./permissions');
const CHANNEL = 'arra:financial-visibility';
const plain = x => x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const fields = (x, names) => Reflect.ownKeys(x).length === names.length && names.every(n => Object.hasOwn(x, n));

function registerFinancialVisibility(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, req) => {
    if (!isAllowedSender(event) || !plain(req) ||
        !((req.action === 'search' && fields(req, ['action', 'account']) && [null, 'A', 'B'].includes(req.account)) ||
          (req.action === 'detail' && fields(req, ['action', 'paymentId']) && Number.isSafeInteger(req.paymentId) && req.paymentId > 0) ||
          (req.action === 'aggregate' && fields(req, ['action', 'account']) && [null, 'A', 'B'].includes(req.account)) ||
          (req.action === 'unpaid' && fields(req, ['action'])) ||
          (req.action === 'unpaidDetail' && fields(req, ['action', 'billId']) && Number.isSafeInteger(req.billId) && req.billId > 0))) return { ok: false };
    try {
      const id = session.currentUserId();
      if (!id || session.authenticatedUserId() !== id || !hasPermissions(db, session, 'employees.view')) return { ok: false };
      const scope = db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(id)?.scope;
      if (!['A', 'B', 'combined'].includes(scope)) return { ok: false };
      if (req.account && scope !== 'combined' && req.account !== scope) return { ok: false };
      if (req.action === 'unpaid' || req.action === 'unpaidDetail') {
        if (scope !== 'combined') return req.action === 'unpaid' ? { ok: true, data: null } : { ok: false };
        const sql = `SELECT b.id, b.order_id AS orderId, o.table_id AS tableId, o.opened_at AS openedAt,
          b.actor_id AS actorId, b.generated_at AS generatedAt, b.total
          FROM bills b JOIN orders o ON o.id=b.order_id
          WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.bill_id=b.id)`;
        if (req.action === 'unpaid') return { ok: true, data: db.prepare(sql + ' ORDER BY b.id DESC').all() };
        const bill = db.prepare(sql + ' AND b.id=?').get(req.billId);
        if (!bill) return { ok: false };
        const lines = db.prepare('SELECT name, unit_price AS unitPrice, quantity, modifiers FROM bill_lines WHERE bill_id=? ORDER BY id').all(bill.id).map(line => ({ ...line, modifiers: JSON.parse(line.modifiers) }));
        return { ok: true, data: { bill, lines } };
      }
      const account = req.account || (scope === 'combined' ? null : scope);
      const where = account === null ? "COALESCE(c.account, p.account) IN ('A','B')" : 'COALESCE(c.account, p.account) = ?';
      const args = account === null ? [] : [account];
      if (req.action === 'search') {
        const records = db.prepare(`SELECT p.id, p.bill_id AS billId, p.paid_at AS paidAt, p.amount, p.method, COALESCE(c.account, p.account) AS account FROM payments p LEFT JOIN (SELECT payment_id, 'A' AS account FROM payment_account_corrections) c ON c.payment_id=p.id WHERE ${where} ORDER BY p.id DESC`).all(...args);
        return { ok: true, data: records };
      }
      if (req.action === 'aggregate') {
        const totals = db.prepare(`SELECT count(*) AS count, COALESCE(sum(p.amount),0) AS total FROM payments p LEFT JOIN (SELECT payment_id, 'A' AS account FROM payment_account_corrections) c ON c.payment_id=p.id WHERE ${where}`).get(...args);
        if (!Number.isSafeInteger(totals.count) || !Number.isSafeInteger(totals.total)) return { ok: false };
        return { ok: true, data: totals };
      }
      const payment = db.prepare(`SELECT p.id, p.bill_id AS billId, p.paid_at AS paidAt, p.amount, p.method, COALESCE(c.account, p.account) AS account FROM payments p LEFT JOIN (SELECT payment_id, 'A' AS account FROM payment_account_corrections) c ON c.payment_id=p.id WHERE ${where} AND p.id=?`).get(...args, req.paymentId);
      if (!payment) return { ok: false };
      const lines = db.prepare('SELECT name, unit_price AS unitPrice, quantity, modifiers FROM bill_lines WHERE bill_id=? ORDER BY id').all(payment.billId).map(line => ({ ...line, modifiers: JSON.parse(line.modifiers) }));
      const bill = db.prepare(`SELECT b.id, b.order_id AS orderId, o.table_id AS tableId, o.opened_at AS openedAt,
        b.actor_id AS actorId, b.generated_at AS generatedAt, b.total
        FROM bills b JOIN orders o ON o.id=b.order_id WHERE b.id=?`).get(payment.billId);
      Object.assign(payment, db.prepare('SELECT actor_id AS actorId, account AS originalAccount FROM payments WHERE id=?').get(payment.id));
      const corrections = db.prepare(`SELECT id, actor_id AS actorId, occurred_at AS occurredAt, reason,
        'B' AS fromAccount, 'A' AS toAccount FROM payment_account_corrections WHERE payment_id=? ORDER BY id`).all(payment.id);
      return { ok: true, data: { payment, bill, corrections, lines } };
    } catch (_) { return { ok: false }; }
  });
}
module.exports = { CHANNEL, registerFinancialVisibility };
