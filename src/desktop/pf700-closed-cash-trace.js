const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { encodeRequest } = require('./pf700-frame');
const { onsiteReceiptItems } = require('./pf700-checkout-protocol');
const { buildReceipt } = require('./fiscal-checkout');
const { isCommissioned } = require('./pf700-commissioning');

// Reconstruct only the successful on-site Cash A protocol. Each ACK is a
// trusted sender's append-only record made after its command-specific checks.
// Match the actual request for every item and the cash tender, not just their
// totals. The credential-bearing OPEN frame is deliberately never hashed.
function matchClosedCashCommands(rows, receipt, previousDocument) {
  if (!rows.length || receipt?.method !== 'cash' || !/^[0-9]{7}$/.test(previousDocument) ||
      Number(previousDocument) >= 9999999) return null;
  let index = 0;
  let sequence = rows[0].sequence;
  function take(command, data) {
    const row = rows[index++];
    if (!row || row.command !== command || row.sequence !== sequence || !row.summary || !row.responseHash) {
      throw Error('Incomplete PF700 checkout trace');
    }
    if (command === 48) {
      if (row.requestHash !== null) throw Error('Invalid PF700 open record');
    } else {
      const frame = encodeRequest({ command, sequence, data, allowedControls: [9, 10] });
      const hash = createHash('sha256').update(frame).digest('hex');
      if (row.requestHash !== hash) throw Error('Unexpected PF700 request');
    }
    sequence = sequence === 0x7f ? 0x20 : sequence + 1;
    return JSON.parse(row.summary);
  }
  function expect(command, data, summary) {
    if (!isDeepStrictEqual(take(command, data), summary)) throw Error('Unexpected PF700 acknowledgement');
  }
  try {
    const items = onsiteReceiptItems(receipt);
    const total = receipt.total;
    const state = name => ({state:name, items:items.length, total});
    const query = Buffer.from('T');
    expect(90, Buffer.from('0'), {identityMatched:true, onsiteFirmware:true});
    expect(74, Buffer.from('X'), {});
    expect(76, query, {stateChecked:true});
    expect(97, undefined, {ratesChecked:true});
    expect(113, undefined, {documentNumber:previousDocument});
    const opening = take(48);
    const { fiscalReceiptCount, reversalCount } = opening;
    const counter = n => Number.isInteger(n) && n >= 0 && n <= 9999;
    if (!counter(fiscalReceiptCount) || fiscalReceiptCount === 9999 || !counter(reversalCount) ||
        !isDeepStrictEqual(opening, {fiscalReceiptCount, reversalCount})) return null;
    for (const item of items) expect(49, item, {itemAccepted:true});
    expect(76, query, state('open_unpaid'));
    expect(103, undefined, {taxTotalsMatched:true});
    expect(53, Buffer.from([9]), {tenderAccepted:true});
    expect(76, query, state('open_paid'));
    expect(56, undefined, {fiscalReceiptCount:fiscalReceiptCount + 1, reversalCount});
    expect(76, query, state('closed'));
    const reference = String(Number(previousDocument) + 1).padStart(7, '0');
    expect(113, undefined, {documentNumber:reference});
    return index === rows.length
      ? {documentNumber:reference, fiscalReceiptCount:fiscalReceiptCount + 1, reversalCount} : null;
  } catch {
    return null;
  }
}

function readClosedCashTrace(db, billId) {
  const sale = db.prepare(`SELECT a.id AS attemptId,i.device_id AS deviceId,i.receipt,b.total,
      base.previous_document AS previousDocument
    FROM pf700_cash_open_intents i JOIN bills b ON b.id=i.bill_id JOIN orders o ON o.id=b.order_id
    JOIN pf700_cash_dispatches d ON d.intent_id=i.id
    JOIN fiscal_checkout_attempts a ON a.id=d.attempt_id AND a.bill_id=i.bill_id
    JOIN fiscal_checkout_sales s ON s.bill_id=i.bill_id AND s.mode='device' AND s.method='cash'
      AND s.device_id=i.device_id AND s.receipt=i.receipt
    JOIN fiscal_checkout_baselines base ON base.attempt_id=a.id AND base.device_id=i.device_id
    WHERE i.bill_id=? AND o.status='open' AND o.retired_empty=0
      AND a.id=(SELECT MAX(id) FROM fiscal_checkout_attempts WHERE bill_id=i.bill_id)
      AND NOT EXISTS(SELECT 1 FROM payments WHERE bill_id=i.bill_id)
      AND NOT EXISTS(SELECT 1 FROM fiscal_checkout_results WHERE attempt_id=a.id OR
        (source='device-' || i.device_id AND reference=printf('%07d',CAST(base.previous_document AS INTEGER)+1)))`).get(billId);
  if (!sale || !isCommissioned(db)) return null;
  const receipt = JSON.parse(sale.receipt);
  if (!Array.isArray(receipt?.lines) || !receipt.lines.length || receipt.lines.length > 512 ||
      typeof receipt.domesticProduct !== 'boolean') return null;
  const requireOrigins = receipt.lines.every(line => typeof line?.domesticProduct === 'boolean');
  // The supervised trial used the receipt-level origin for one unit. All
  // routine receipts must carry the saved origin for each line.
  if (!requireOrigins && (receipt.lines.length !== 1 || receipt.lines[0]?.quantity !== 1)) return null;
  const savedBill = buildReceipt(db, billId, 'cash', sale.total, {
    mode:'device', domesticProduct:receipt.domesticProduct, requireOrigins
  });
  if (!isDeepStrictEqual(receipt, savedBill)) return null;
  // Thirteen fixed commands plus one per bill line. Fetch an extra row so a
  // valid prefix with trailing activity can never match.
  const rows = db.prepare(`SELECT c.sequence,c.command,c.request_hash AS requestHash,
      a.response_hash AS responseHash,a.summary
    FROM pf700_command_intents c LEFT JOIN pf700_command_acks a ON a.command_id=c.id
    WHERE c.attempt_id=? ORDER BY c.id LIMIT ?`).all(sale.attemptId, receipt.lines.length + 14);
  const evidence = matchClosedCashCommands(rows, receipt, sale.previousDocument);
  return evidence ? { attemptId:sale.attemptId, deviceId:sale.deviceId, reference:evidence.documentNumber, evidence } : null;
}

// Called inside the payment transaction. SQLite applies its ordinary baseline,
// source, uniqueness and append-only guards to this result as well.
function persistClosedCashTrace(db, billId) {
  const trace = readClosedCashTrace(db, billId);
  if (trace) {
    db.prepare(`INSERT INTO fiscal_checkout_results(attempt_id,status,source,reference,evidence,ended_at)
      VALUES(?,'accepted',?,?,?,?)`).run(trace.attemptId, 'device-' + trace.deviceId, trace.reference,
      JSON.stringify(trace.evidence), Date.now());
  }
}

module.exports = { readClosedCashTrace, persistClosedCashTrace };
