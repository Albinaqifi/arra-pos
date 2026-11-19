// A second connection or a restarted process cannot vouch for an outstanding
// attempt. Its durable state is uncertain until a result is recorded.
const active = new WeakMap();
const errors = Object.freeze({
  unmapped: 'A bill item has no verified fiscal tax group.',
  origin: 'A bill item has no saved Macedonian-product mark.',
  unavailable: 'The bill cannot be registered on the fiscal printer.',
  selection: 'This bill already has a different fiscal payment selection.',
  pending: 'Fiscal checkout is in progress.',
  submitted: 'The receipt was accepted. Retry the same selection to finish recording the payment.',
  profile: 'Reopen the original fiscal checkout profile for this bill.',
  scope: 'This bill is outside the commissioned checkout trial.',
  cardDisabled: 'Card checkout on the physical fiscal printer is not available.',
  approvalRequired: 'Confirm the simulated terminal approval first.',
  uncertain: 'The fiscal checkout outcome is unknown. Check the saved bill.',
  blocked: 'Another fiscal checkout has an unresolved result.',
  failed: 'Fiscal checkout stopped before registering the sale.'
});

function offlineCheckoutRequested(args) {
  const flag = '--pf700-offline-checkout';
  const options = args.filter(arg => arg.startsWith(flag));
  if (!options.length) return false;
  if (options.length !== 1 || options[0] !== flag || !args.some(arg => arg.startsWith('--sample-data-directory='))) {
    throw Error('The PF700 rehearsal requires a marked sample profile');
  }
  return true;
}

function createOfflineFiscalCheckout() {
  const { registerSimulatedPf700Sale } = require('./pf700-checkout-protocol');
  return Object.freeze({ mode: 'simulation', registerSale: registerSimulatedPf700Sale });
}

function validFiscalAdapter(adapter) {
  return typeof adapter?.registerSale === 'function' && (adapter.canRegister === undefined || typeof adapter.canRegister === 'function') &&
    ((adapter.mode === 'simulation' && adapter.deviceId === undefined) || (adapter.mode === 'device' &&
      typeof adapter.domesticProduct === 'boolean' && typeof adapter.deviceId === 'string' &&
      /^[A-Za-z0-9._-]{1,80}$/.test(adapter.deviceId)));
}

function failure(fiscalStatus) {
  return { ok: false, fiscalStatus, error: errors[fiscalStatus] };
}

function readFiscalCheckout(db, billId) {
  const row = db.prepare(`SELECT s.mode,s.device_id AS deviceId,s.method,s.receipt,a.id AS attemptId,r.status,r.reference,r.evidence,b.previous_document AS previousDocumentNumber,
    EXISTS(SELECT 1 FROM payments WHERE bill_id=s.bill_id) AS paid
    FROM fiscal_checkout_sales s JOIN fiscal_checkout_attempts a ON a.bill_id=s.bill_id
    LEFT JOIN fiscal_checkout_verified_results r ON r.attempt_id=a.id
    LEFT JOIN fiscal_checkout_baselines b ON b.attempt_id=a.id AND b.device_id=s.device_id
    WHERE s.bill_id=? ORDER BY a.id DESC LIMIT 1`).get(billId);
  if (!row) return null;
  let status = row.status || (active.get(db)?.has(row.attemptId) ? 'pending' : 'uncertain');
  if (status === 'accepted' && !row.paid) status = 'submitted';
  const baseline = row.previousDocumentNumber ? {deviceId:row.deviceId,previousDocumentNumber:row.previousDocumentNumber,
    expectedDocumentNumber:String(Number(row.previousDocumentNumber)+1).padStart(7,'0')} : null;
  const proof = row.evidence && JSON.parse(row.evidence);
  return { mode: row.mode, status, reference: row.reference, method: row.method, receipt: JSON.parse(row.receipt),
    ...(row.deviceId ? { deviceId: row.deviceId } : {}), ...(baseline ? {baseline} : {}),
    ...(proof ? {evidence:{documentNumber:proof.documentNumber,fiscalReceiptCount:proof.fiscalReceiptCount,reversalCount:proof.reversalCount}} : {}) };
}

function buildReceipt(db, billId, method, total, adapter) {
  const rows = db.prepare(`SELECT l.item_id AS itemId,l.name,l.unit_price AS unitPrice,l.quantity,l.modifiers,t.tax_group AS taxGroup,o.domestic AS domesticProduct
    FROM bill_lines l LEFT JOIN order_item_fiscal_tax t ON t.item_id=l.item_id LEFT JOIN order_item_fiscal_origin o ON o.item_id=l.item_id WHERE l.bill_id=? ORDER BY l.id`).all(billId);
  let sum = 0;
  const lines = [];
  for (const row of rows) {
    if (!['А','В'].includes(row.taxGroup)) return failure('unmapped');
    if (adapter.requireOrigins && row.domesticProduct === null) return failure('origin');
    const amount = row.quantity * row.unitPrice;
    if (!Number.isSafeInteger(row.quantity) || row.quantity < 1 || !Number.isSafeInteger(row.unitPrice) || row.unitPrice < 0 ||
        !Number.isSafeInteger(amount) || !Number.isSafeInteger(sum + amount)) return failure('unavailable');
    sum += amount;
    // The billed unit price already includes each selected adjustment.
    const {domesticProduct, ...line} = row;
    lines.push({ ...line, modifiers: JSON.parse(row.modifiers), taxRate: row.taxGroup === 'А' ? 18 : 10,
      ...(adapter.requireOrigins ? {domesticProduct: !!domesticProduct} : {}) });
  }
  if (!lines.length || sum !== total) return failure('unavailable');
  return { billId, account: 'A', method, currency: 'MKD', total, lines,
    ...(adapter.mode === 'device' ? {domesticProduct:adapter.domesticProduct} : {}) };
}

// The caller holds BEGIN IMMEDIATE, and commits before contacting any adapter.
function reserveSale(db, request, total, actor, prior, adapter) {
  if (db.prepare(`SELECT 1 FROM fiscal_checkout_attempts a LEFT JOIN fiscal_checkout_verified_results r
      ON r.attempt_id=a.id WHERE r.attempt_id IS NULL LIMIT 1`).get()) return failure('blocked');
  // The only physical mode in this release is the single-sale commissioning
  // trial. Its allowance is spent when the receipt is acknowledged, even if
  // the POS payment still needs to be finalized in a later session.
  if (adapter.mode === 'device' && !adapter.requireOrigins && db.prepare(`SELECT 1 FROM fiscal_checkout_verified_results
      WHERE source=? AND status='accepted' LIMIT 1`).get('device-' + adapter.deviceId)) return failure('scope');
  const receipt = prior?.receipt || buildReceipt(db, request.billId, request.method, total, adapter);
  if (receipt.ok === false) return receipt;
  if (!require('./pf700-checkout-protocol').canEncodePf700Receipt(receipt)) return failure('unavailable');
  // Trial restrictions are local, synchronous predicates. Reject a tender,
  // quantity or additional sale before freezing the operator's selection.
  if (adapter.canRegister && adapter.canRegister(receipt, prior) !== true) return failure('scope');
  const now = Date.now();
  if (!prior) db.prepare(`INSERT INTO fiscal_checkout_sales(bill_id,actor_id,mode,device_id,method,receipt,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(request.billId, actor, adapter.mode, adapter.deviceId ?? null, request.method, JSON.stringify(receipt), now);
  const attemptId = db.prepare('INSERT INTO fiscal_checkout_attempts(bill_id,started_at) VALUES(?,?)').run(request.billId, now).lastInsertRowid;
  if (adapter.mode === 'simulation' && request.method === 'card' &&
      db.prepare('SELECT 1 FROM simulated_card_approvals WHERE bill_id=?').get(request.billId)) {
    db.prepare('INSERT INTO simulated_card_attempts(attempt_id,nonce) VALUES(?,?)')
      .run(attemptId,require('node:crypto').randomBytes(32).toString('hex'));
  }
  return { attemptId, receipt };
}

function acceptedOutcome(adapter, receipt, result) {
  if (result?.status !== 'accepted') return null;
  if (adapter.mode === 'simulation') {
    return result.reference === 'SIM-' + receipt.billId ? { reference: result.reference, evidence: null } : null;
  }
  const evidence = result.evidence;
  const counter = n => Number.isInteger(n) && n >= 0 && n <= 9999;
  if (typeof result.reference !== 'string' || !/^[0-9]{7}$/.test(result.reference) ||
      !evidence || evidence.documentNumber !== result.reference ||
      !counter(evidence.fiscalReceiptCount) || !counter(evidence.reversalCount)) return null;
  // Save only the validated protocol evidence. Never retain raw transport
  // replies, operator credentials or arbitrary properties returned by a driver.
  return { reference: result.reference, evidence: JSON.stringify({ documentNumber: evidence.documentNumber,
    fiscalReceiptCount: evidence.fiscalReceiptCount, reversalCount: evidence.reversalCount }) };
}

async function submitSale(db, adapter, reservation) {
  const { attemptId, receipt } = reservation;
  let pending = active.get(db);
  if (!pending) { pending = new Set(); active.set(db, pending); }
  pending.add(attemptId);
  try {
    const result = await adapter.registerSale(receipt, {
      simulationAttempt: db.prepare('SELECT nonce FROM simulated_card_attempts WHERE attempt_id=?').get(attemptId)?.nonce,
      beforeOpen({previousDocumentNumber}) {
        if (adapter.mode !== 'device' || typeof previousDocumentNumber !== 'string' ||
            !/^[0-9]{7}$/.test(previousDocumentNumber) || previousDocumentNumber === '9999999') {
          throw Error('Invalid fiscal checkout baseline');
        }
        db.prepare('INSERT INTO fiscal_checkout_baselines(attempt_id,device_id,previous_document) VALUES(?,?,?)')
          .run(attemptId,adapter.deviceId,previousDocumentNumber);
      }
    });
    const accepted = acceptedOutcome(adapter, receipt, result);
    if (!accepted && result?.status !== 'failed') return failure('uncertain');
    // Persist device acknowledgement independently of the POS transaction. If
    // finalizing the payment later fails, retry finalization without a new sale.
    const source = adapter.mode === 'simulation' ? 'simulation' : 'device-' + adapter.deviceId;
    db.prepare('INSERT INTO fiscal_checkout_results(attempt_id,status,source,reference,evidence,ended_at) VALUES(?,?,?,?,?,?)')
      .run(attemptId, result.status, source, accepted?.reference ?? null, accepted?.evidence ?? null, Date.now());
    return accepted ? { ok: true } : failure('failed');
  } catch {
    return failure('uncertain');
  } finally {
    pending.delete(attemptId);
  }
}

module.exports = { offlineCheckoutRequested, createOfflineFiscalCheckout, validFiscalAdapter, readFiscalCheckout, reserveSale, submitSale, failure };
