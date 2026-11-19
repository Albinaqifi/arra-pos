'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { isDeepStrictEqual: equal } = require('node:util');
const { DatabaseSync } = require('node:sqlite');

const digest = value => createHash('sha256').update(value).digest('hex');

function check(condition) {
  if (!condition) throw Error('Evidence mismatch');
}

// The Windows launcher holds read handles denying write/delete on BOTH
// databases for this entire check. It also refuses WAL/SHM/rollback sidecars.
// Immutable mode prevents SQLite itself from creating any sidecars.
function openOriginal(filename) {
  const uri = pathToFileURL(filename);
  uri.search = 'mode=ro&immutable=1';
  const db = new DatabaseSync(uri.href, { readOnly: true, allowExtension: false });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY;');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function originalBill(db) {
  check(db.prepare('SELECT count(*) AS n FROM pf700_commissioning_enrollment WHERE id=1').get().n === 1);
  // Preserve the exact column names and order from the original finisher.
  // The fingerprint includes the original receipt JSON string byte for byte.
  const attempts = db.prepare(`SELECT a.id,a.started_at,s.actor_id,s.receipt,s.created_at,b.fingerprint,b.order_id,b.generated_at
    FROM fiscal_checkout_attempts a JOIN fiscal_checkout_sales s ON s.bill_id=a.bill_id
    JOIN bills b ON b.id=a.bill_id WHERE a.bill_id=1 LIMIT 2`).all();
  check(attempts.length === 1);
  const attempt = attempts[0];
  check(Number.isSafeInteger(attempt.actor_id) && attempt.actor_id > 0);
  const original = db.prepare(`SELECT base.device_id AS serial,base.previous_document AS previousDocument
    FROM fiscal_checkout_baselines base JOIN fiscal_checkout_sales sale
      ON sale.bill_id=1 AND sale.device_id=base.device_id
    WHERE base.attempt_id=? AND sale.mode='device' AND sale.method='cash'`).get(attempt.id);
  check(original && /^[A-Za-z0-9]{11}$/.test(original.serial) && /^[0-9]{7}$/.test(original.previousDocument) &&
    Number(original.previousDocument) < 9999999);
  const receipt = JSON.parse(attempt.receipt);
  check(receipt.billId === 1 && receipt.method === 'cash' && receipt.account === 'A' &&
    receipt.total === 70 && receipt.currency === 'MKD' && receipt.domesticProduct === true &&
    Array.isArray(receipt.lines) && receipt.lines.length === 1);
  const line = receipt.lines[0];
  check(line.name === 'Espresso' && line.unitPrice === 70 && line.quantity === 1 &&
    line.taxGroup === '\u0412' && line.taxRate === 10 && equal(line.modifiers, []));
  const billed = db.prepare(`SELECT l.item_id,l.name,l.unit_price,l.quantity,l.modifiers,
      i.product_id,i.status AS itemStatus,i.order_id,t.tax_group,b.total,o.status,o.retired_empty
    FROM bill_lines l LEFT JOIN bills b ON b.id=l.bill_id LEFT JOIN orders o ON o.id=b.order_id
    LEFT JOIN order_items i ON i.id=l.item_id LEFT JOIN order_item_fiscal_tax t ON t.item_id=l.item_id
    WHERE l.bill_id=1 LIMIT 2`).all();
  check(billed.length === 1);
  const saved = billed[0];
  check(Number.isSafeInteger(line.itemId) && line.itemId > 0 && saved.item_id === line.itemId &&
    saved.name === line.name && saved.unit_price === line.unitPrice && saved.quantity === line.quantity &&
    equal(JSON.parse(saved.modifiers), []) && saved.tax_group === line.taxGroup && saved.total === receipt.total &&
    saved.product_id === 'arra-product-11-0' && saved.itemStatus === 'sent' && saved.order_id === attempt.order_id &&
    saved.retired_empty === 0 && ['open', 'completed'].includes(saved.status));
  return { attempt, serial: original.serial, document: String(Number(original.previousDocument) + 1).padStart(7, '0'),
    orderStatus: saved.status, binding: digest(JSON.stringify([original, attempt])) };
}

function inspectEvidence(app, journal, original) {
  const { attempt, document, serial, binding, orderStatus } = original;
  const events = journal.prepare('SELECT step,binding,details FROM events ORDER BY step LIMIT 5').all();
  check(events.length <= 4);
  const details = events.map((event, index) => {
    check(event.step === index + 1 && event.binding === binding);
    return JSON.parse(event.details);
  });
  if (details.length >= 1) check(equal(details[0], { action: 'cash-tender-intent', billId: 1, attemptId: attempt.id }));
  if (details.length >= 2) check(equal(details[1], { action: 'close-intent', items: 1, amountRaw: 7000, tenderRaw: 7000 }));
  if (details.length >= 3) {
    const { fiscalReceiptCount, reversalCount } = details[2];
    check(equal(details[2], { fiscalReceiptCount, reversalCount }) && Number.isInteger(fiscalReceiptCount) &&
      fiscalReceiptCount >= 1 && fiscalReceiptCount <= 9999 &&
      Number.isInteger(reversalCount) && reversalCount >= 0 && reversalCount <= 9999);
  }
  if (details.length < 4) return 'STAGE' + details.length;
  check(equal(details[3], { documentNumber: document, ...details[2] }));
  const results = app.prepare(`SELECT status,source,reference,evidence FROM fiscal_checkout_results
    WHERE attempt_id=? LIMIT 2`).all(attempt.id);
  const payments = app.prepare('SELECT actor_id,amount,method,account FROM payments WHERE bill_id=1 LIMIT 2').all();
  check(results.length <= 1 && payments.length <= 1);
  if (results.length) {
    const result = results[0];
    check(result.status === 'accepted' && result.source === 'device-' + serial && result.reference === document &&
      equal(JSON.parse(result.evidence), details[3]));
    check(app.prepare(`SELECT count(*) AS n FROM fiscal_checkout_verified_results
      WHERE attempt_id=? AND status='accepted' AND source=? AND reference=? AND evidence=?`)
      .get(attempt.id, result.source, result.reference, result.evidence).n === 1);
  }
  if (payments.length) {
    const payment = payments[0];
    check(results.length === 1 && orderStatus === 'completed' && payment.actor_id === attempt.actor_id &&
      payment.amount === 70 && payment.account === 'A' && payment.method === 'cash');
  } else check(orderStatus === 'open');
  return payments.length ? 'MATCH' : 'UNSETTLED';
}

function inspectLocked(roaming, local) {
  const profile = path.join(roaming, 'Arra POS PF700 Commissioning');
  const directory = path.join(local, 'Arra POS', 'PF700 commissioning');
  check(!fs.existsSync(path.join(profile, 'SAMPLE-DATA-ONLY')));
  let app, journal;
  try {
    app = openOriginal(path.join(profile, 'arra.sqlite'));
    const original = originalBill(app);
    const expected = digest(original.serial + ':' + original.document) + '.finish.sqlite';
    const candidates = fs.readdirSync(directory).filter(name => name.toLowerCase().endsWith('.finish.sqlite'));
    check(candidates.length === 1 && candidates[0] === expected);
    check(fs.lstatSync(path.join(directory, digest(original.serial) + '.used')).isFile());
    journal = openOriginal(path.join(directory, expected));
    return inspectEvidence(app, journal, original);
  } finally {
    try { journal?.close(); } finally { app?.close(); }
  }
}

if (require.main === module) {
  let result = 'MISMATCH';
  try {
    check(process.platform === 'win32' && process.argv.length === 2 && process.env.ARRA_EVIDENCE_LOCKED === '1');
    result = inspectLocked(process.env.APPDATA, process.env.LOCALAPPDATA);
  } catch { /* Report fixed text only, including for malformed records. */ }
  console.log(result);
  if (result !== 'MATCH') process.exitCode = 1;
}

module.exports = { inspectLocked };
