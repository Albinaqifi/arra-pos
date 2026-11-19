'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { isCommissioned } = require('../../src/desktop/pf700-commissioning');
const { buildReceipt } = require('../../src/desktop/fiscal-checkout');
const { matchPendingCashClose } = require('../../src/desktop/pf700-closed-cash-trace');
const { decodeResponse } = require('../../src/desktop/pf700-frame');

const digest = value => createHash('sha256').update(value).digest('hex');

// The launcher holds the original database against writes for the whole run.
// This collector is for the reported two-coffee incident only.
function readCandidate(db, billId, expectedDocument, {matchJournalPaper = false} = {}) {
  try {
    if (billId !== 2 || expectedDocument !== '0000030' || !isCommissioned(db)) return null;
    const sale = db.prepare(`SELECT i.id AS intentId, i.created_at AS intentAt, i.device_id AS serial,
        i.receipt, s.actor_id AS payer, s.created_at AS saleAt, a.id AS attemptId, a.started_at AS startedAt,
        d.created_at AS dispatchedAt, b.order_id AS orderId, b.fingerprint, b.generated_at AS generatedAt,
        b.total, base.previous_document AS previousDocument
      FROM pf700_cash_open_intents i JOIN bills b ON b.id=i.bill_id JOIN orders o ON o.id=b.order_id
      JOIN pf700_cash_dispatches d ON d.intent_id=i.id
      JOIN fiscal_checkout_attempts a ON a.id=d.attempt_id AND a.bill_id=i.bill_id
      JOIN fiscal_checkout_sales s ON s.bill_id=i.bill_id AND s.mode='device' AND s.method='cash'
        AND s.device_id=i.device_id AND s.receipt=i.receipt AND s.actor_id=i.actor_id
      JOIN fiscal_checkout_baselines base ON base.attempt_id=a.id AND base.device_id=i.device_id
      WHERE i.bill_id=? AND b.total=150 AND o.status='open' AND o.retired_empty=0
        AND NOT EXISTS(SELECT 1 FROM bill_lines l LEFT JOIN order_items item ON item.id=l.item_id
          WHERE l.bill_id=b.id AND (item.id IS NULL OR item.order_id!=b.order_id OR item.status!='sent'))
        AND a.id=(SELECT MAX(id) FROM fiscal_checkout_attempts)
        AND NOT EXISTS(SELECT 1 FROM pf700_cash_open_intents WHERE id!=i.id)
        AND NOT EXISTS(SELECT 1 FROM pf700_command_seals WHERE attempt_id=a.id)
        AND NOT EXISTS(SELECT 1 FROM payments WHERE bill_id=i.bill_id)
        AND NOT EXISTS(SELECT 1 FROM fiscal_checkout_results r JOIN fiscal_checkout_attempts t ON t.id=r.attempt_id
          WHERE r.attempt_id=a.id OR (t.bill_id=i.bill_id AND r.status='accepted')
            OR (r.source='device-' || i.device_id AND r.reference=?))
        AND NOT EXISTS(SELECT 1 FROM fiscal_checkout_attempts t LEFT JOIN fiscal_checkout_verified_results r ON r.attempt_id=t.id
          WHERE t.id!=a.id AND r.attempt_id IS NULL)
        AND NOT EXISTS(SELECT 1 FROM fiscal_checkout_open_device_sales WHERE bill_id!=i.bill_id)
        AND NOT EXISTS(SELECT 1 FROM fiscal_daily_current r LEFT JOIN fiscal_daily_confirmations c USING(day_id)
          WHERE c.day_id IS NULL)
        AND NOT EXISTS(SELECT 1 FROM fiscal_daily_reports WHERE mode='device' AND started_at>=a.started_at)`).get(billId, expectedDocument);
    if (!sale || !/^[A-Za-z0-9]{11}$/.test(sale.serial) || sale.previousDocument !== '0000029') return null;
    const receipt = JSON.parse(sale.receipt);
    if (typeof receipt?.domesticProduct !== 'boolean' || !Array.isArray(receipt.lines) || receipt.lines.length !== 2) return null;
    const saved = buildReceipt(db, billId, 'cash', sale.total, {
      mode:'device', domesticProduct:receipt.domesticProduct, requireOrigins:true
    });
    if (!isDeepStrictEqual(receipt, saved) ||
        !receipt.lines.some(line => line.name === 'Espresso' && line.unitPrice === 70 && line.quantity === 1) ||
        !receipt.lines.some(line => line.name === 'Macchiato' && line.unitPrice === 80 && line.quantity === 1)) return null;
    if (matchJournalPaper && (receipt.lines[0].name !== 'Espresso' ||
        !receipt.lines.every(line => line.taxGroup === 'В' && line.taxRate === 10 && line.domesticProduct === true))) return null;
    const rows = db.prepare(`SELECT c.id, c.sequence, c.command, c.request_hash AS requestHash, c.created_at AS intentAt,
        a.response_hash AS responseHash, a.summary, a.created_at AS ackAt
      FROM pf700_command_intents c LEFT JOIN pf700_command_acks a ON a.command_id=c.id
      WHERE c.attempt_id=? ORDER BY c.id LIMIT 14`).all(sale.attemptId);
    const opening = matchPendingCashClose(rows, receipt, sale.previousDocument);
    if (!opening || rows.at(-1).id !== db.prepare('SELECT MAX(id) AS id FROM pf700_command_intents').get().id) return null;
    return {
      billId, attemptId:sale.attemptId, sequence:rows.at(-1).sequence, serial:sale.serial, expectedDocument, total:sale.total,
      openingFiscalReceiptCount:opening.fiscalReceiptCount, openingReversalCount:opening.reversalCount,
      binding:digest(JSON.stringify([billId, expectedDocument, sale, rows]))
    };
  } catch {
    return null;
  }
}

// Only the original close or the wrapping status query can supply usable
// evidence. Never disclose arbitrary payloads or interpret either as payment.
function classifyReply(candidate, buffer) {
  const unknown = {kind:'inconclusive'};
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 17 || buffer.length > 101 ||
        ![56,74].includes(buffer[3])) return unknown;
    const { command, data, status } = decodeResponse(buffer, { sequence:candidate.sequence, command:buffer[3] });
    const open = Boolean(status[2] & 0x08);
    const healthy = !(status[0] & 0x37) && !(status[1] & 0x3f) && !(status[2] & 0x05) &&
      !(status[4] & 0x35) && !(status[5] & 0x01) && (status[5] & 0x1a) === 0x1a;
    const frame = {statusHex:status.toString('hex'), responseHash:digest(buffer)};
    if (command === 74) {
      return data.equals(status) ? {kind:'status', ready:healthy, open, ...frame} : unknown;
    }
    const fields = data.toString('latin1').split(',');
    if (fields.length !== 2 || !fields.every(n => n.length === 4 && /^ *[0-9]+$/.test(n))) {
      const shape = data.subarray(0,32).toString('latin1').replace(/[0-9]/g, '#')
        .replace(/[^# ,.+\/-]/g, '?').replace(/ /g, '_');
      return {kind:'unrecognized-close', ready:healthy && !open, open, payloadLength:data.length, shape, ...frame};
    }
    const [fiscalReceiptCount, reversalCount] = fields.map(Number);
    return {
      kind:'cached-close', ready:healthy && !open, open, fiscalReceiptCount, reversalCount,
      countersMatch:fiscalReceiptCount === candidate.openingFiscalReceiptCount + 1 && reversalCount === candidate.openingReversalCount,
      ...frame
    };
  } catch {
    return unknown;
  }
}

module.exports = { readCandidate, classifyReply };
