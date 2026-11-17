const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(workerData.file,{readOnly:true});
// Scan a fixed number of primary-key entries, including entries outside the
// range or scope, so sparse ranges cannot cause an unbounded single read.
const ids=db.prepare('SELECT id FROM payments WHERE id<=? AND id<=? ORDER BY id DESC LIMIT 200');
const records=db.prepare(`SELECT p.id,p.bill_id AS billId,p.paid_at AS paidAt,p.amount,p.method,o.table_id AS tableId,
 CASE WHEN c.id IS NULL OR c.id>? THEN p.account ELSE 'A' END AS account,d.id AS dayId,d.opened_at AS openedAt,
 CASE WHEN d.id=? THEN NULL ELSE d.closed_at END AS closedAt,d.id=? AS firstDay
 FROM payments p JOIN payment_business_days pd ON pd.payment_id=p.id JOIN business_days d ON d.id=pd.business_day_id
 JOIN bills b ON b.id=p.bill_id JOIN orders o ON o.id=b.order_id LEFT JOIN payment_account_corrections c ON c.payment_id=p.id
 WHERE p.id>=? AND p.id<=? AND p.paid_at>=? AND p.paid_at<?
 AND (?='combined' OR (CASE WHEN c.id IS NULL OR c.id>? THEN p.account ELSE 'A' END)=?) ORDER BY p.id DESC`);
parentPort.on('message', ({id,anchor,cursor}) => {
  try {
    const bucket=ids.all(anchor.payment,cursor);
    if (!bucket.length) return parentPort.postMessage({id,ok:true,data:{rows:[],cursor:0}});
    const high=bucket[0].id,low=bucket[bucket.length-1].id;
    const rows=records.all(anchor.correction,anchor.openDay,anchor.firstDay,low,high,anchor.from,anchor.to,anchor.scope,anchor.correction,anchor.scope);
    parentPort.postMessage({id,ok:true,data:{rows,cursor:low-1}});
  } catch (_) { parentPort.postMessage({id,ok:false}); }
});
