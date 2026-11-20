'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { onsiteReceiptItems } = require('../../src/desktop/pf700-checkout-protocol');
const { hold, digest } = require('./device.cjs');
const { earlierJournal } = require('./earlier-journal.cjs');
const hash = value => digest(JSON.stringify(value));

function original(db, ledgerDir, binding, forDeviceWrites = true) {
  hold(binding && Number.isSafeInteger(binding.billId) && Number.isSafeInteger(binding.previousBillId) &&
    binding.previousBillId > 0 && binding.billId > binding.previousBillId &&
    typeof binding.previousDocument === 'string' && /^\d{7}$/.test(binding.previousDocument) && Number(binding.previousDocument)<9999999 &&
    typeof binding.headerNumber === 'string' && /^\d{4}$/.test(binding.headerNumber) &&
    Number.isSafeInteger(binding.total) && binding.total>0 &&
    binding.lines?.length === 2 && binding.itemHex?.length === 2, 'INCIDENT_BINDING');
  hold(db.prepare('PRAGMA user_version').get().user_version === 53 &&
    db.prepare('SELECT 1 FROM pf700_commissioning_enrollment WHERE id=1').get(),'PROFILE');
  const sale = db.prepare(`SELECT p.id AS paymentId,p.actor_id AS payer,p.paid_at AS paidAt,
    p.amount, b.order_id AS orderId, o.opened_at AS openedAt, j.device_id AS deviceId,
    j.receipt,j.order_key AS orderKey,j.job_token AS jobToken,c.claimed_at AS claimedAt,
    base.previous_document AS previousDocument, res.finished_at AS finishedAt, day.id AS dayId
    FROM payments p JOIN bills b ON b.id=p.bill_id JOIN orders o ON o.id=b.order_id
    JOIN payment_business_days pd ON pd.payment_id=p.id JOIN business_days day ON day.id=pd.business_day_id
    JOIN fast_pay_v1_jobs j ON j.payment_id=p.id JOIN fast_pay_v1_claims c USING(payment_id)
    JOIN fast_pay_v1_baselines base USING(payment_id) JOIN fast_pay_v1_results res USING(payment_id)
    WHERE p.bill_id=? AND p.method='card' AND p.account='A' AND o.status='completed' AND p.amount=b.total
      AND res.status='unconfirmed' AND res.document_number IS NULL AND res.evidence IS NULL`).get(binding.billId);
  hold(sale && sale.amount===binding.total && sale.previousDocument === binding.previousDocument &&
    /^[A-Za-z0-9]{11}$/.test(sale.deviceId) && /^[0-9a-f-]{36}$/.test(sale.jobToken) &&
    sale.orderKey === hash([sale.deviceId,sale.orderId,sale.openedAt]) &&
    sale.paidAt <= sale.claimedAt && sale.claimedAt <= sale.finishedAt,'ORIGINAL_PAYMENT');
  hold(path.isAbsolute(ledgerDir) && fs.realpathSync.native(ledgerDir).toLowerCase() === path.resolve(ledgerDir).toLowerCase(),'LEDGER_PATH');
  for (const file of [path.join(ledgerDir,sale.orderKey+'.order'),path.join(ledgerDir,sale.jobToken+'.used'),
    path.join(path.dirname(ledgerDir),digest(sale.deviceId)+'.used')]) {
    const stat = fs.lstatSync(file,{throwIfNoEntry:false});
    hold(stat && stat.isFile() && !stat.isSymbolicLink() && stat.size===0,'ORIGINAL_CLAIM');
  }
  const earlier = db.prepare(`SELECT p.id, p.paid_at AS paidAt,pd.business_day_id AS dayId
    FROM payments p JOIN payment_business_days pd ON pd.payment_id=p.id
    WHERE p.bill_id=? AND p.method='cash' AND p.account='A'`).get(binding.previousBillId);
  hold(earlier && earlier.id<sale.paymentId && earlier.paidAt<=sale.paidAt && earlier.dayId===sale.dayId,'EARLIER_CASH');
  const prior = db.prepare(`SELECT r.document_number AS doc,r.evidence FROM fast_pay_v1_results r
    JOIN fast_pay_v1_jobs j USING(payment_id) WHERE j.device_id=?1 AND r.payment_id=?2 AND r.status='acknowledged'
    UNION ALL SELECT v.reference AS doc,v.evidence FROM fiscal_checkout_sales s
    JOIN fiscal_checkout_attempts a ON a.bill_id=s.bill_id JOIN fiscal_checkout_verified_results v ON v.attempt_id=a.id
    WHERE s.bill_id=?3 AND s.mode='device' AND s.method='cash' AND s.device_id=?1 AND v.source='device-'||?1 AND v.status='accepted'`).all(
    {'1':sale.deviceId,'2':earlier.id,'3':binding.previousBillId});
  hold(prior.length>0,'EARLIER_PROOF');
  const numbered=Object.hasOwn(binding,'priorJournalHash')?earlierJournal(db,sale,binding,prior):null;
  const records=numbered?[]:prior.map(row=>{
    const e=JSON.parse(row.evidence);
    hold(row.doc===sale.previousDocument && e.documentNumber===row.doc &&
      Number.isSafeInteger(e.fiscalReceiptCount) && e.fiscalReceiptCount>=1 && e.fiscalReceiptCount<9998 &&
      Number.isSafeInteger(e.reversalCount) && e.reversalCount>=0 && e.reversalCount<=9999,'EARLIER_COUNTERS');
    return {fiscalReceiptCount:e.fiscalReceiptCount,reversalCount:e.reversalCount};
  });
  if (!numbered) hold(records.every(e=>hash(e)===hash(records[0])) &&
    Number(binding.headerNumber) === records[0].fiscalReceiptCount+1,'HEADER_CORROBORATION');
  if (forDeviceWrites) {
    // A DB restored from before other dispatches still has older job ids. The
    // original commissioning ledger retains spent order and job markers outside it.
    const known=new Set();
    for (const row of db.prepare(`SELECT j.order_key,j.job_token FROM fast_pay_v1_jobs j JOIN fast_pay_v1_claims c USING(payment_id)`).iterate()) {
      known.add(row.order_key+'.order');known.add(row.job_token+'.used');
    }
    for (const name of fs.readdirSync(ledgerDir)) {
      if (/\.order$|\.used$/i.test(name)) hold(known.has(name),'RESTORED_OR_UNKNOWN_CLAIM');
    }
    hold(!db.prepare(`SELECT 1 FROM fast_pay_v1_jobs j LEFT JOIN fast_pay_v1_claims c USING(payment_id)
      LEFT JOIN fast_pay_v1_results r USING(payment_id) WHERE j.device_id=? AND j.payment_id NOT IN (?,?)
      AND (j.payment_id>? OR c.claimed_at>=? OR r.finished_at>=?)`).get(sale.deviceId,earlier.id,sale.paymentId,earlier.id,earlier.paidAt,earlier.paidAt) &&
    !db.prepare(`SELECT 1 FROM fiscal_checkout_sales s JOIN fiscal_checkout_attempts a ON a.bill_id=s.bill_id
      WHERE s.device_id=? AND s.bill_id NOT IN (?,?) AND a.started_at>=?`).get(sale.deviceId,binding.previousBillId,binding.billId,earlier.paidAt) &&
    !db.prepare(`SELECT 1 FROM fiscal_daily_current d LEFT JOIN fiscal_daily_confirmations c ON c.day_id=d.day_id
      WHERE d.device_id=? AND (c.day_id IS NULL OR d.started_at>=?)`).get(sale.deviceId,earlier.paidAt),'INTERVENING_FISCAL_WORK');
    checkOpenWindow(db,sale);
  }
  const receipt=JSON.parse(sale.receipt);
  hold(receipt.billId===binding.billId && receipt.method==='card' && receipt.account==='A' &&
    receipt.total===sale.amount && typeof receipt.domesticProduct==='boolean' && receipt.currency==='MKD' &&
    receipt.lines?.length===2,'SAVED_RECEIPT');
  const billed=db.prepare(`SELECT l.item_id AS itemId,l.name,l.quantity,l.unit_price AS unitPrice,l.modifiers,
      t.tax_group AS taxGroup,o.domestic FROM bill_lines l
    JOIN order_item_fiscal_tax t ON t.item_id=l.item_id JOIN order_item_fiscal_origin o ON o.item_id=l.item_id
    WHERE l.bill_id=? ORDER BY l.id`).all(binding.billId);
  const amounts=[0,0,0,0], items=onsiteReceiptItems(receipt);
  hold(billed.length===2 && binding.lines.every((line,index) => {
    const original=billed[index], saved=receipt.lines[index];
    if (!line || typeof line.name!=='string' || !Number.isSafeInteger(line.unitPrice) || !Number.isSafeInteger(line.quantity) ||
      !['name','unitPrice','quantity'].every(k=>line[k]===original[k] && line[k]===saved[k]) ||
      saved.itemId!==original.itemId || !['А','В'].includes(original.taxGroup) || saved.taxGroup!==original.taxGroup ||
      ![0,1].includes(original.domestic) || saved.domesticProduct!==Boolean(original.domestic) ||
      hash(saved.modifiers)!==hash(JSON.parse(original.modifiers)) ||
      items[index].toString('hex')!==binding.itemHex[index]) return false;
    amounts[original.taxGroup==='А'?0:2]+=saved.unitPrice*saved.quantity;
    return true;
  }),'BILL_LINES');
  const s={...sale,billId:binding.billId,previousBillId:binding.previousBillId,headerNumber:binding.headerNumber,
    lines:binding.lines,total:sale.amount,taxTotals:amounts,earlierCounters:numbered?null:records[0],
    ...(numbered?{earlierJournal:numbered}:{})};
  return {...s,items,fingerprint:hash(s)};
}
function checkOpenWindow(db,s) {
  hold(db.prepare('SELECT 1 FROM business_days WHERE id=? AND closed_at IS NULL').get(s.dayId) &&
    !db.prepare('SELECT 1 FROM fiscal_daily_current WHERE day_id=?').get(s.dayId),'CLOSED_FISCAL_WINDOW');
}
module.exports = {original,hash,checkOpenWindow};
