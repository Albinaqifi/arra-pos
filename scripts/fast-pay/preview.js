'use strict';

// Only the authenticated Combined financial preview calls this function. Keep
// the existing report totals, print snapshot and confirmation digest intact.
function attachReceiptStatuses(db, data) {
  const enabled = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='view' AND name='fast_pay_v1_status'").get();
  if (!enabled) return data;
  const rows = db.prepare(`SELECT s.bill_id, s.receipt_status, s.document_number
    FROM fast_pay_v1_status s
    JOIN payment_business_days day ON day.payment_id=s.payment_id
    WHERE day.business_day_id=?`).all(data.id);
  const receipts = new Map(rows.map(row => [row.bill_id, row]));
  return {...data, records: data.records.map(record => {
    const receipt = receipts.get(record.billId);
    if (!receipt) return record;
    return {...record, receiptStatus: receipt.receipt_status, documentNumber: receipt.document_number};
  })};
}

module.exports = {attachReceiptStatuses};
