const { hasPermissions } = require('./permissions');
const { ownsOrder } = require('./order-ownership');
const { recordAudit } = require('./audit');
const { markService, assignPayment } = require('./shifts');
const { createBillJob, reserveAttempt, dispatch } = require('./test-printing');
const { validFiscalAdapter, readFiscalCheckout, reserveSale, submitSale, failure } = require('./fiscal-checkout');
const { isCommissioned } = require('./pf700-commissioning');
const CHANNEL = 'arra:payment';

function success(id, fiscal) {
  return { ok: true, data: fiscal ? { id, fiscal } : { id } };
}

// Reconcile only the original payer's exact historic selection when a payment
// lost its response before waiter ownership was introduced.
function recoverLegacyPayment(db, orderId, actor, request) {
  const legacy = db.prepare(`SELECT p.id FROM legacy_unassigned_orders l JOIN orders o ON o.id=l.order_id
    JOIN bills b ON b.order_id=o.id JOIN payments p ON p.bill_id=b.id WHERE l.order_id=? AND o.status='completed'
    AND b.id=? AND p.actor_id=? AND p.method=? AND p.account=?
    AND NOT EXISTS(SELECT 1 FROM order_waiter_ownership w WHERE w.order_id=o.id)`)
    .get(orderId, request.billId, actor, request.method, request.account);
  return legacy ? success(legacy.id) : { ok: false, error: 'Access denied' };
}

function recordPayment(db, request, bill, actor, printing, fiscal) {
  const paidAt = Date.now();
  const id = db.prepare('INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(?,?,?,?,?,?)')
    .run(request.billId, actor, paidAt, bill.total, request.method, request.account).lastInsertRowid;
  markService(db, paidAt);
  assignPayment(db, id, paidAt);
  db.prepare("UPDATE orders SET status='completed' WHERE id=? AND status='open' AND retired_empty=0").run(bill.orderId);
  recordAudit(db, actor, 'record', 'payment', id, bill.orderId, {});
  // Keep ordinary non-fiscal bill jobs separate from the fiscal journal. A
  // previously printed unpaid bill is never automatically printed again.
  let attempt = null;
  if (!db.prepare('SELECT 1 FROM test_print_jobs WHERE bill_id=?').get(request.billId)) {
    const jobId = createBillJob(db, request.billId);
    if (printing) attempt = reserveAttempt(db, jobId, 'payment-' + id, actor);
  }
  return { response: success(id, fiscal ? { ...fiscal, status: 'accepted' } : null), printAttempt: attempt };
}

function preparePayment(db, session, request, actor, printing, adapter) {
  const bill = db.prepare(`SELECT b.order_id AS orderId,b.total,o.status,o.retired_empty AS retired
    FROM bills b JOIN orders o ON o.id=b.order_id WHERE b.id=?`).get(request.billId);
  if (!bill) return { response: { ok: false, error: 'Access denied' } };
  if (!ownsOrder(db, session, bill.orderId)) return { response: recoverLegacyPayment(db, bill.orderId, actor, request) };

  const existing = db.prepare('SELECT id,method,account FROM payments WHERE bill_id=?').get(request.billId);
  const fiscal = readFiscalCheckout(db, request.billId);
  if (existing) {
    if (existing.method !== request.method || existing.account !== request.account) {
      return { response: { ok: false, error: 'Bill already paid with a different selection' } };
    }
    if (fiscal && fiscal.status !== 'accepted') return {response:failure('uncertain')};
    return { response: success(existing.id, fiscal) };
  }
  if (bill.status !== 'open' || bill.retired) return { response: { ok: false, error: 'Bill unavailable' } };
  if (fiscal) {
    if (request.method !== fiscal.method || request.account !== 'A') return { response: failure('selection') };
    if (fiscal.status === 'pending' || fiscal.status === 'uncertain') return { response: failure(fiscal.status) };
    if (fiscal.status === 'failed' && (!adapter || fiscal.mode !== adapter.mode || fiscal.deviceId !== adapter.deviceId ||
        (fiscal.mode === 'device' && fiscal.receipt.domesticProduct !== adapter.domesticProduct &&
          !(adapter.requireOrigins && fiscal.receipt.lines.length === 1 && fiscal.receipt.lines[0].quantity === 1 &&
            !Object.hasOwn(fiscal.receipt.lines[0], 'domesticProduct'))))) {
      return { response: failure('profile') };
    }
  }
  if (request.account === 'A' && !(fiscal?.mode === 'device' && fiscal.status === 'submitted')) {
    if (adapter?.mode !== 'device' && db.prepare('SELECT 1 FROM fiscal_checkout_open_device_sales LIMIT 1').get()) {
      return { response: failure('blocked') };
    }
    if (isCommissioned(db) && (adapter?.mode !== 'device' || (fiscal && fiscal.mode !== 'device'))) {
      return { response: failure('profile') };
    }
  }
  if (adapter && request.account === 'A' && fiscal?.status !== 'submitted') {
    const reserved = reserveSale(db, request, bill.total, actor, fiscal, adapter);
    return reserved.ok === false ? { response: reserved } : { reservation: reserved };
  }
  try {
    return recordPayment(db, request, bill, actor, printing, fiscal);
  } catch (error) {
    if (fiscal?.status === 'submitted') error.fiscalSubmitted = true;
    throw error;
  }
}

function registerPayments(ipcMain, isAllowedSender, db, session, printing = null, fiscalCheckout = null) {
  if (fiscalCheckout && !validFiscalAdapter(fiscalCheckout)) {
    throw Error('Unsupported fiscal checkout adapter');
  }
  ipcMain.handle(CHANNEL, (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype ||
      Reflect.ownKeys(request).length !== 3 || !['billId', 'method', 'account'].every(k => Object.hasOwn(request, k)) ||
      !Number.isSafeInteger(request.billId) || request.billId <= 0 || !['cash', 'card'].includes(request.method) ||
      !['A', 'B'].includes(request.account) || (request.method === 'card' && request.account !== 'A')) return { ok: false, error: 'Invalid request' };
    const actor = session.currentUserId();
    const authenticated = session.authenticatedUserId();
    const generation = session.identityGeneration?.();
    const authorized = () => isAllowedSender(event) && session.currentUserId() === actor &&
      authenticated === session.authenticatedUserId() && generation === session.identityGeneration?.() &&
      hasPermissions(db, session, 'orders.view', 'orders.change');

    function execute() {
      try {
        db.exec('BEGIN IMMEDIATE');
        let step;
        try {
          step = authorized() ? preparePayment(db, session, request, actor, printing, fiscalCheckout) :
            { response: { ok: false, error: 'Access denied' } };
          db.exec('COMMIT');
        } catch (error) {
          if (db.isTransaction) db.exec('ROLLBACK');
          if (step?.response?.data?.fiscal?.status === 'accepted') error.fiscalSubmitted = true;
          throw error;
        }
        if (step.printAttempt) dispatch(db, printing, step.printAttempt);
        if (step.reservation) return submitSale(db, fiscalCheckout, step.reservation).then(result => {
          // An acknowledgement belongs to the original checkout even if the
          // operator switched. Disclose or finalize it only to that identity.
          if (result.ok) return execute();
          return authorized() ? result : { ok: false, error: 'Access denied' };
        });
        return step.response;
      } catch (error) {
        if (error.fiscalSubmitted) return failure('submitted');
        return { ok: false, error: 'Could not record payment. Retry the same selection.' };
      }
    }
    return execute();
  });
}
module.exports = { CHANNEL, registerPayments };
