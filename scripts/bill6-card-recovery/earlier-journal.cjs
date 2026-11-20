'use strict';
const {hold,digest}=require('./device.cjs');
const hash=value=>digest(JSON.stringify(value));

// The historical bill #3 settlement kit installed one sealed table and one
// UNION on the verified-results view. These digests identify its published SQL.
function historicalContract(db) {
  const normalized=row=>[row.name,row.sql.replaceAll('\r\n','\n')];
  const witness=db.prepare(`SELECT name,sql FROM main.sqlite_schema WHERE tbl_name='pf700_bill3_numbered_journal'
    AND sql IS NOT NULL ORDER BY name`).all().map(normalized);
  hold(hash(witness)==='41dbd6d43d556a91dcb9727023fc93dbf125154b7f54000281a4ce1ed1d8e5d6','JOURNAL_SEAL_SCHEMA');
  const rows=db.prepare(`SELECT name,sql FROM main.sqlite_schema WHERE (tbl_name IN ('pf700_bill2_numbered_journal',
    'fiscal_checkout_results') AND sql IS NOT NULL) OR name='fiscal_checkout_verified_results' ORDER BY name`).all().map(normalized);
  const view=rows.find(row=>row[0]==='fiscal_checkout_verified_results');
  hold(view && digest(view[1].slice(-785))==='15fa3b57439d42638844c3d18f1cec1275b31fcad6d5c9de7228d892976b21ea','JOURNAL_VERIFY_VIEW');
  view[1]=view[1].slice(0,-785);
  hold(hash(rows)==='adc83b0901f47cc7fa4ef9906cdca3b478d5398f63f13ac0af3eada6cd03944b','JOURNAL_VERIFY_SCHEMA');
}
function earlierJournal(db,sale,binding,prior) {
  const isHash=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
  hold(isHash(binding.priorJournalHash) && prior.length===1 && prior[0].doc===sale.previousDocument,'JOURNAL_BASELINE');
  historicalContract(db);
  const matches=db.prepare(`SELECT j.evidence,base.previous_document AS initialDoc,b.total,p.amount,day.business_day_id
    FROM pf700_bill3_numbered_journal j
    JOIN fiscal_checkout_attempts a ON a.id=j.attempt_id
    JOIN fiscal_checkout_sales s ON s.bill_id=a.bill_id
    JOIN fiscal_checkout_verified_results v ON v.attempt_id=a.id AND v.evidence=j.evidence
    JOIN fiscal_checkout_results r ON r.attempt_id=a.id AND r.evidence=v.evidence AND r.source=v.source AND r.reference=v.reference
    JOIN fiscal_checkout_baselines base ON base.attempt_id=a.id AND base.device_id=s.device_id
    JOIN bills b ON b.id=s.bill_id JOIN orders o ON o.id=b.order_id
    JOIN payments p ON p.bill_id=b.id AND p.actor_id=s.actor_id AND p.method='cash' AND p.account='A'
    JOIN payment_business_days day ON day.payment_id=p.id AND j.day_id=day.business_day_id
    LEFT JOIN payment_shifts shift ON shift.payment_id=p.id
    JOIN pf700_cash_dispatches d ON d.attempt_id=a.id
    JOIN pf700_cash_intents i ON i.id=d.intent_id AND i.bill_id=b.id AND i.actor_id=s.actor_id
      AND i.device_id=s.device_id AND i.receipt=s.receipt
    JOIN pf700_cash_intent_results ir ON ir.intent_id=i.id AND ir.status='paid'
    WHERE p.bill_id=? AND j.shift_id IS shift.shift_id AND s.device_id=? AND s.mode='device' AND s.method='cash'
      AND v.source='device-'||s.device_id AND v.status='accepted' AND v.reference=? AND o.status='completed'
      AND (SELECT count(*) FROM application_audit au WHERE au.order_id=o.id AND au.actor_id=ir.actor_id
        AND au.entity_type='fiscal_checkout' AND au.action='recover' AND au.entity_id=CAST(a.id AS TEXT))=1
      AND (SELECT count(*) FROM application_audit au WHERE au.order_id=o.id AND au.actor_id=ir.actor_id
        AND au.entity_type='payment' AND au.action='record' AND au.entity_id=CAST(p.id AS TEXT))=1`).all(
    binding.previousBillId,sale.deviceId,sale.previousDocument);
  const row=matches[0];
  hold(matches.length===1 && db.prepare('SELECT count(*) AS n FROM pf700_bill3_numbered_journal').get().n===1 &&
    row.evidence===prior[0].evidence && row.business_day_id===sale.dayId && row.total===row.amount && row.total>0 &&
    /^\d{7}$/.test(row.initialDoc) && Number(row.initialDoc)+1===Number(sale.previousDocument),'JOURNAL_LINKS');
  const e=JSON.parse(row.evidence);
  hold(Object.keys(e).length===6 && e.kind==='numbered-journal' && e.documentNumber===sale.previousDocument &&
    [e.binding,e.captureHash,e.journalHash,e.responseHash].every(isHash) && e.journalHash===binding.priorJournalHash,'JOURNAL_EVIDENCE');
  return e;
}
module.exports={earlierJournal};
