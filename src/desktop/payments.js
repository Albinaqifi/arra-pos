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
  const trainingCash = db.prepare(`SELECT s.actor_id AS originalActor FROM fiscal_checkout_sales s
    JOIN fiscal_checkout_attempts a ON a.bill_id=s.bill_id JOIN simulated_cash_attempts t ON t.attempt_id=a.id
    WHERE s.bill_id=? AND s.mode='simulation' AND s.method='cash' ORDER BY a.id DESC LIMIT 1`).get(request.billId);
  const id = db.prepare('INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(?,?,?,?,?,?)')
    .run(request.billId, trainingCash?.originalActor ?? actor, paidAt, bill.total, request.method, request.account).lastInsertRowid;
  markService(db, paidAt);
  assignPayment(db, id, paidAt);
  db.prepare("UPDATE orders SET status='completed' WHERE id=? AND status='open' AND retired_empty=0").run(bill.orderId);
  recordAudit(db, actor, 'record', 'payment', id, bill.orderId, {});
  if (trainingCash) recordAudit(db, actor, 'recover', 'simulated_fiscal_checkout', request.billId, bill.orderId, {});
  // Keep ordinary non-fiscal bill jobs separate from the fiscal journal. A
  // previously printed unpaid bill is never automatically printed again.
  let attempt = null;
  if (!db.prepare('SELECT 1 FROM test_print_jobs WHERE bill_id=?').get(request.billId)) {
    const jobId = createBillJob(db, request.billId);
    if (printing) attempt = reserveAttempt(db, jobId, 'payment-' + id, actor);
  }
  return { response: success(id, fiscal ? { ...fiscal, status: 'accepted' } : null), printAttempt: attempt };
}

function trainingRecoveryAllowed(db, adapter) {
  return adapter?.mode === 'simulation' && adapter.simulationRecoveryControls === true &&
    typeof adapter.inspectCash === 'function' && typeof adapter.finishCash === 'function' && !isCommissioned(db);
}

function sameSavedCashBill(db, receipt) {
  const bill = db.prepare('SELECT total FROM bills WHERE id=?').get(receipt.billId);
  if (!bill || bill.total !== receipt.total || receipt.method !== 'cash' || receipt.account !== 'A') return false;
  const lines = db.prepare(`SELECT l.item_id AS itemId,l.name,l.unit_price AS unitPrice,l.quantity,l.modifiers,
    t.tax_group AS taxGroup,o.domestic AS domestic FROM bill_lines l
    LEFT JOIN order_item_fiscal_tax t ON t.item_id=l.item_id
    LEFT JOIN order_item_fiscal_origin o ON o.item_id=l.item_id WHERE l.bill_id=? ORDER BY l.id`).all(receipt.billId);
  if (!Array.isArray(receipt.lines) || lines.length !== receipt.lines.length) return false;
  return lines.every((line,i) => {
    const saved=receipt.lines[i];
    return line.itemId===saved.itemId && line.name===saved.name && line.unitPrice===saved.unitPrice &&
      line.quantity===saved.quantity && line.taxGroup===saved.taxGroup && line.domestic!==null &&
      !!line.domestic===saved.domesticProduct && saved.taxRate===(line.taxGroup==='А'?18:10) &&
      JSON.stringify(JSON.parse(line.modifiers))===JSON.stringify(saved.modifiers);
  });
}

function inspectSimulatedCash(db, session, request, adapter, finish) {
  if (!trainingRecoveryAllowed(db,adapter)) return failure('profile');
  const bill=db.prepare(`SELECT b.order_id AS orderId,o.status,o.retired_empty AS retired FROM bills b
    JOIN orders o ON o.id=b.order_id WHERE b.id=?`).get(request.billId);
  if (!bill || !ownsOrder(db,session,bill.orderId)) return {ok:false,error:'Access denied'};
  if (bill.status !== 'open' || bill.retired || db.prepare('SELECT 1 FROM payments WHERE bill_id=?').get(request.billId)) return failure('selection');
  const fiscal=readFiscalCheckout(db,request.billId);
  if (!fiscal || fiscal.mode!=='simulation' || fiscal.method!=='cash' || !sameSavedCashBill(db,fiscal.receipt)) return failure('uncertain');
  if (!['uncertain','submitted'].includes(fiscal.status)) return failure(fiscal.status);
  const attempt=db.prepare(`SELECT a.id,t.nonce FROM fiscal_checkout_attempts a
    JOIN simulated_cash_attempts t ON t.attempt_id=a.id
    WHERE a.bill_id=? ORDER BY a.id DESC LIMIT 1`).get(request.billId);
  if (!attempt) return failure('uncertain');
  let state;
  try { state=adapter.inspectCash(fiscal.receipt,attempt.nonce); } catch (_) { return failure('uncertain'); }
  if (!['not_started','open_unpaid','tendered','closed'].includes(state)) return failure('uncertain');
  if (fiscal.status === 'submitted' && state !== 'closed') return failure('uncertain');
  if (!finish) return {ok:true,data:{stage:state}};
  if (fiscal.status === 'submitted') return {ok:true};
  try { if (adapter.finishCash(fiscal.receipt,attempt.nonce)!==true) return failure('uncertain'); }
  catch (_) { return failure('uncertain'); }
  db.prepare('INSERT INTO fiscal_checkout_results(attempt_id,status,source,reference,evidence,ended_at) VALUES(?,?,?,?,?,?)')
    .run(attempt.id,'accepted','simulation','SIM-'+request.billId,null,Date.now());
  return {ok:true};
}

function preparePayment(db, session, request, actor, printing, adapter) {
  const bill = db.prepare(`SELECT b.order_id AS orderId,b.total,o.status,o.retired_empty AS retired
    FROM bills b JOIN orders o ON o.id=b.order_id WHERE b.id=?`).get(request.billId);
  if (!bill) return { response: { ok: false, error: 'Access denied' } };
  if (!ownsOrder(db, session, bill.orderId)) return { response: recoverLegacyPayment(db, bill.orderId, actor, request) };

  const existing = db.prepare('SELECT id,method,account FROM payments WHERE bill_id=?').get(request.billId);
  const fiscal = readFiscalCheckout(db, request.billId);
  const approval = db.prepare('SELECT 1 FROM simulated_card_approvals WHERE bill_id=?').get(request.billId);
  const intent = db.prepare('SELECT id,actor_id AS actorId FROM simulated_card_open_intents WHERE bill_id=?').get(request.billId);
  const cashIntent = db.prepare('SELECT id,interruption FROM simulated_cash_open_intents WHERE bill_id=?').get(request.billId);
  if (existing) {
    if (existing.method !== request.method || existing.account !== request.account) {
      return { response: { ok: false, error: 'Bill already paid with a different selection' } };
    }
    if (fiscal && fiscal.status !== 'accepted') return {response:failure('uncertain')};
    return { response: success(existing.id, fiscal) };
  }
  if (bill.status !== 'open' || bill.retired) return { response: { ok: false, error: 'Bill unavailable' } };
  if (cashIntent && (request.method!=='cash' || request.account!=='A')) return {response:failure('selection')};
  if (cashIntent && !trainingRecoveryAllowed(db,adapter)) return {response:failure('profile')};
  if (cashIntent && !fiscal && (request.intentId!==cashIntent.id || request.simulateInterrupt!==cashIntent.interruption)) return {response:failure('selection')};
  if (request.simulateInterrupt && (!cashIntent || request.intentId!==cashIntent.id || request.simulateInterrupt!==cashIntent.interruption)) return {response:failure('selection')};
  if ((approval || intent) && (request.method !== 'card' || request.account !== 'A')) return { response: failure('selection') };
  // Card tender on a physical PF700 stays disabled until its interrupted-sale
  // recovery has been verified. This guard is independent of adapter policy.
  // An already acknowledged historical sale may still finish locally below.
  if (request.method === 'card' && adapter?.mode === 'device' && fiscal?.status !== 'submitted') {
    return { response: failure('cardDisabled') };
  }
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
  if ((approval || intent) && adapter?.mode !== 'simulation') return { response: failure('profile') };
  if (request.account === 'A' && !(fiscal?.mode === 'device' && fiscal.status === 'submitted')) {
    if (adapter?.mode !== 'device' && db.prepare('SELECT 1 FROM fiscal_checkout_open_device_sales LIMIT 1').get()) {
      return { response: failure('blocked') };
    }
    if (isCommissioned(db) && (adapter?.mode !== 'device' || (fiscal && fiscal.mode !== 'device'))) {
      return { response: failure('profile') };
    }
  }
  if (adapter?.mode === 'simulation' && request.method === 'card' && !approval && !fiscal) {
    if (request.terminalApproved !== true || !intent || request.intentId !== intent.id) return { response: failure('approvalRequired') };
    db.prepare('INSERT INTO simulated_card_intent_results(intent_id,status,recorded_at) VALUES(?,?,?)').run(intent.id,'approved',Date.now());
    db.prepare('INSERT INTO simulated_card_approvals(bill_id,actor_id,amount,approved_at) VALUES(?,?,?,?)')
      .run(request.billId, intent.actorId, bill.total, Date.now());
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

function simulatedTerminalIntent(db, session, request, actor, adapter) {
  const bill=db.prepare(`SELECT b.order_id AS orderId,b.total,o.status,o.retired_empty AS retired
    FROM bills b JOIN orders o ON o.id=b.order_id WHERE b.id=?`).get(request.billId);
  if (!bill || !ownsOrder(db,session,bill.orderId)) return {ok:false,error:'Access denied'};
  if (adapter?.mode !== 'simulation' || isCommissioned(db)) return failure('profile');
  if (request.prepareSimulated) {
    if (bill.status !== 'open' || bill.retired || db.prepare('SELECT 1 FROM payments WHERE bill_id=?').get(request.billId) ||
        db.prepare('SELECT 1 FROM fiscal_checkout_sales WHERE bill_id=?').get(request.billId) ||
        db.prepare('SELECT 1 FROM simulated_card_approvals WHERE bill_id=?').get(request.billId) ||
        db.prepare('SELECT 1 FROM simulated_cash_open_intents WHERE bill_id=?').get(request.billId)) return failure('selection');
    const existing=db.prepare('SELECT id FROM simulated_card_open_intents WHERE bill_id=?').get(request.billId);
    const id=existing?.id ?? db.prepare('INSERT INTO simulated_card_intents(bill_id,actor_id,amount,created_at) VALUES(?,?,?,?)')
      .run(request.billId,actor,bill.total,Date.now()).lastInsertRowid;
    return {ok:true,data:{intentId:id}};
  }
  return failure('selection');
}

function prepareSimulatedCashIntent(db,session,request,actor,adapter) {
  if (!trainingRecoveryAllowed(db,adapter)) return failure('profile');
  const bill=db.prepare(`SELECT b.order_id AS orderId,o.status,o.retired_empty AS retired FROM bills b
    JOIN orders o ON o.id=b.order_id WHERE b.id=?`).get(request.billId);
  if (!bill || !ownsOrder(db,session,bill.orderId)) return {ok:false,error:'Access denied'};
  if (bill.status!=='open' || bill.retired || db.prepare('SELECT 1 FROM payments WHERE bill_id=?').get(request.billId)) return failure('selection');
  const existing=db.prepare('SELECT id,interruption FROM simulated_cash_open_intents WHERE bill_id=?').get(request.billId);
  if (existing) return existing.interruption===request.prepareSimulatedCash ? {ok:true,data:{intentId:existing.id}} : failure('selection');
  if (db.prepare('SELECT 1 FROM fiscal_checkout_sales WHERE bill_id=?').get(request.billId) ||
      db.prepare('SELECT 1 FROM simulated_card_approvals WHERE bill_id=?').get(request.billId) ||
      db.prepare('SELECT 1 FROM simulated_card_open_intents WHERE bill_id=?').get(request.billId)) return failure('selection');
  const id=db.prepare('INSERT INTO simulated_cash_intents(bill_id,actor_id,interruption,created_at) VALUES(?,?,?,?)')
    .run(request.billId,actor,request.prepareSimulatedCash,Date.now()).lastInsertRowid;
  return {ok:true,data:{intentId:id}};
}

// This read-only check is available only for the persistent training printer.
// Missing or mismatched evidence never proves that a receipt did not start.
function recoverSimulatedCard(db, session, request, adapter) {
  const bill = db.prepare('SELECT order_id AS orderId FROM bills WHERE id=?').get(request.billId);
  if (!bill || !ownsOrder(db, session, bill.orderId)) return {ok:false,error:'Access denied'};
  const fiscal = readFiscalCheckout(db, request.billId);
  if (!db.prepare('SELECT 1 FROM simulated_card_approvals WHERE bill_id=?').get(request.billId) ||
      !fiscal || fiscal.mode !== 'simulation' || fiscal.method !== 'card' || adapter?.mode !== 'simulation' ||
      typeof adapter.matchRecordedSale !== 'function') return failure('profile');
  if (fiscal.status === 'submitted' || fiscal.status === 'accepted') return {ok:true};
  if (fiscal.status !== 'uncertain') return failure(fiscal.status);
  const attempt = db.prepare(`SELECT a.id,n.nonce FROM fiscal_checkout_attempts a
    JOIN simulated_card_attempts n ON n.attempt_id=a.id
    LEFT JOIN fiscal_checkout_results r ON r.attempt_id=a.id
    WHERE a.bill_id=? AND r.attempt_id IS NULL ORDER BY a.id DESC LIMIT 1`).get(request.billId);
  if (!attempt) return failure('uncertain');
  let match = false;
  try { match = adapter.matchRecordedSale(fiscal.receipt,attempt.nonce) === true; } catch (_) { /* remain uncertain */ }
  if (!match) return failure('uncertain');
  db.prepare('INSERT INTO fiscal_checkout_results(attempt_id,status,source,reference,evidence,ended_at) VALUES(?,?,?,?,?,?)')
    .run(attempt.id,'accepted','simulation','SIM-'+request.billId,null,Date.now());
  return {ok:true};
}

function registerPayments(ipcMain, isAllowedSender, db, session, printing = null, fiscalCheckout = null) {
  if (fiscalCheckout && !validFiscalAdapter(fiscalCheckout)) {
    throw Error('Unsupported fiscal checkout adapter');
  }
  ipcMain.handle(CHANNEL, (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype ||
      ![3,4,5].includes(Reflect.ownKeys(request).length) || !['billId', 'method', 'account'].every(k => Object.hasOwn(request, k)) ||
      !Number.isSafeInteger(request.billId) || request.billId <= 0 || !['cash', 'card'].includes(request.method) ||
      !['A', 'B'].includes(request.account) || (request.method === 'card' && request.account !== 'A') ||
      (Reflect.ownKeys(request).length === 4 && !(
        (request.method === 'card' && ((Object.hasOwn(request,'prepareSimulated') && request.prepareSimulated === true) ||
          (Object.hasOwn(request,'recoverSimulated') && request.recoverSimulated === true))) ||
        (request.method === 'cash' && request.account === 'A' &&
          ((Object.hasOwn(request,'prepareSimulatedCash') && ['before_open','after_items','after_tender','after_close','after_ack'].includes(request.prepareSimulatedCash)) ||
           (Object.hasOwn(request,'checkSimulated') && request.checkSimulated === true) ||
           (Object.hasOwn(request,'finishSimulated') && request.finishSimulated === true))))) ||
      (Reflect.ownKeys(request).length === 5 && (!Object.hasOwn(request,'intentId') ||
        !Number.isSafeInteger(request.intentId) || request.intentId <= 0 || !(
          (request.method === 'card' && Object.hasOwn(request,'terminalApproved') && request.terminalApproved === true) ||
          (request.method === 'cash' && request.account === 'A' && Object.hasOwn(request,'simulateInterrupt') &&
            ['before_open','after_items','after_tender','after_close','after_ack'].includes(request.simulateInterrupt)))))) return { ok: false, error: 'Invalid request' };
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
          if (!authorized()) step = { response: { ok: false, error: 'Access denied' } };
          else if ((request.simulateInterrupt || request.prepareSimulatedCash || request.checkSimulated || request.finishSimulated) && !trainingRecoveryAllowed(db,fiscalCheckout)) {
            step = {response:failure('profile')};
          }
          else if (request.prepareSimulatedCash) {
            step = {response:prepareSimulatedCashIntent(db,session,request,actor,fiscalCheckout)};
          }
          else if (request.checkSimulated) {
            const alreadyPaid=db.prepare('SELECT 1 FROM payments WHERE bill_id=?').get(request.billId);
            step = alreadyPaid ? preparePayment(db,session,request,actor,printing,fiscalCheckout) :
              {response:inspectSimulatedCash(db,session,request,fiscalCheckout,false)};
          }
          else if (request.finishSimulated) {
            const alreadyPaid=db.prepare('SELECT 1 FROM payments WHERE bill_id=?').get(request.billId);
            const recovery=alreadyPaid ? {ok:true} : inspectSimulatedCash(db,session,request,fiscalCheckout,true);
            step = recovery.ok ? preparePayment(db,session,request,actor,printing,fiscalCheckout) : {response:recovery};
          }
          else if (request.prepareSimulated) {
            step = {response:simulatedTerminalIntent(db,session,request,actor,fiscalCheckout)};
          }
          else {
            const recovery = request.recoverSimulated ? recoverSimulatedCard(db, session, request, fiscalCheckout) : {ok:true};
            step = recovery.ok ? preparePayment(db, session, request, actor, printing, fiscalCheckout) : {response:recovery};
          }
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
          if (result.ok && request.simulateInterrupt === 'after_ack') return authorized() ? failure('submitted') : {ok:false,error:'Access denied'};
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
