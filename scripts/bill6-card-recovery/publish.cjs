'use strict';
const {hold}=require('./device.cjs');
const {hash}=require('./original.cjs');

const originalView=`CREATE VIEW fast_pay_v1_status AS
 SELECT j.payment_id,p.bill_id,p.method,j.device_id,r.document_number,
 CASE WHEN r.status IS NOT NULL THEN r.status WHEN c.payment_id IS NOT NULL THEN 'unconfirmed' ELSE 'queued' END AS receipt_status
 FROM fast_pay_v1_jobs j JOIN payments p ON p.id=j.payment_id
 LEFT JOIN fast_pay_v1_claims c ON c.payment_id=j.payment_id LEFT JOIN fast_pay_v1_results r ON r.payment_id=c.payment_id`;
const recoveredView=`CREATE VIEW fast_pay_v1_status AS
 SELECT j.payment_id,p.bill_id,p.method,j.device_id,COALESCE(x.document_number,r.document_number) AS document_number,
 CASE WHEN x.payment_id IS NOT NULL THEN 'acknowledged' WHEN r.status IS NOT NULL THEN r.status
 WHEN c.payment_id IS NOT NULL THEN 'unconfirmed' ELSE 'queued' END AS receipt_status
 FROM fast_pay_v1_jobs j JOIN payments p ON p.id=j.payment_id
 LEFT JOIN fast_pay_v1_claims c ON c.payment_id=j.payment_id LEFT JOIN fast_pay_v1_results r ON r.payment_id=c.payment_id
 LEFT JOIN card_receipt_incident_proof x ON x.payment_id=p.id AND x.bill_id=p.bill_id AND r.status='unconfirmed'`;
const norm=sql=>String(sql||'').trim().replace(/\s+/g,' ').toLowerCase();

function assertReadyToPublish(db,s) {
  const schema=db.prepare("SELECT sql FROM sqlite_schema WHERE name='fast_pay_v1_status' AND type='view'").get()?.sql;
  hold(norm(schema)===norm(originalView),'STATUS_SCHEMA');
  hold(!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='card_receipt_incident_proof'").get(),'RECOVERY_SCHEMA');
  const doc=String(Number(s.previousDocument)+1).padStart(7,'0');
  hold(!db.prepare('SELECT 1 FROM fiscal_checkout_sales WHERE bill_id=?').get(s.billId) &&
    !db.prepare('SELECT 1 FROM fiscal_checkout_results WHERE source=? AND reference=?').get('device-'+s.deviceId,doc) &&
    !db.prepare(`SELECT 1 FROM fast_pay_v1_results r JOIN fast_pay_v1_jobs j USING(payment_id)
      WHERE j.device_id=? AND r.document_number=?`).get(s.deviceId,doc),'EXISTING_PROOF');
}
function closeFields(p) {
  return {documentNumber:p.documentNumber,fiscalReceiptCount:p.fiscalReceiptCount,
    reversalCount:p.reversalCount,debitAmountMinor:p.debitAmountMinor};
}
function already(db,s,packet) {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='card_receipt_incident_proof' AND type='table'").get()) return false;
  const row=db.prepare('SELECT * FROM card_receipt_incident_proof WHERE payment_id=?').get(s.paymentId);
  const status=db.prepare('SELECT * FROM fast_pay_v1_status WHERE payment_id=?').get(s.paymentId);
  hold(row && row.bill_id===s.billId && packet && row.trace_hash===packet.traceHash &&
    row.binding_hash===s.fingerprint && row.document_number===packet.result.documentNumber &&
    row.recovered_by===packet.actor && row.recovered_at===packet.finished &&
    row.close_evidence===JSON.stringify(closeFields(packet.result)) &&
    row.register_proof===JSON.stringify({before:packet.result.before,after:packet.result.after}) &&
    norm(db.prepare("SELECT sql FROM sqlite_schema WHERE name='fast_pay_v1_status'").get()?.sql)===norm(recoveredView) &&
    status?.document_number===row.document_number && status.receipt_status==='acknowledged' &&
    (row.native_published===0 || (row.native_published===1 && db.prepare(`SELECT 1 FROM fiscal_checkout_verified_results v
      JOIN fiscal_checkout_attempts a ON a.id=v.attempt_id WHERE a.bill_id=? AND v.status='accepted'
      AND v.source=? AND v.reference=? AND v.evidence=?`).get(s.billId,'device-'+s.deviceId,row.document_number,row.close_evidence))),
    'EXISTING_RECOVERY_MISMATCH');
  return true;
}
function unresolvedNativeAttempt(db) {
  return !!db.prepare(`SELECT 1 FROM fiscal_checkout_attempts a LEFT JOIN fiscal_checkout_verified_results r ON r.attempt_id=a.id
    WHERE r.status IS NULL LIMIT 1`).get();
}
function saveNative(db,s,packet) {
  const p=packet.result;
  db.prepare(`INSERT INTO fiscal_checkout_sales(bill_id,actor_id,mode,device_id,method,receipt,created_at)
      VALUES(?,?,'device',?,'card',?,?)`).run(s.billId,s.payer,s.deviceId,s.receipt,s.paidAt);
  const id=db.prepare('INSERT INTO fiscal_checkout_attempts(bill_id,started_at) VALUES(?,?)').run(s.billId,packet.started).lastInsertRowid;
  db.prepare('INSERT INTO fiscal_checkout_baselines(attempt_id,device_id,previous_document) VALUES(?,?,?)').run(id,s.deviceId,s.previousDocument);
  db.prepare(`INSERT INTO fiscal_checkout_results(attempt_id,status,source,reference,evidence,ended_at)
    VALUES(?,'accepted',?,?,?,?)`).run(id,'device-'+s.deviceId,p.documentNumber,JSON.stringify(closeFields(p)),packet.finished);
  hold(db.prepare(`SELECT 1 FROM fiscal_checkout_verified_results WHERE attempt_id=? AND status='accepted' AND evidence=?`).get(
    id,JSON.stringify(closeFields(p))),'NATIVE_PUBLICATION');
}
function promoteIfAvailable(db,s,packet,actorId) {
  const row=db.prepare('SELECT native_published FROM card_receipt_incident_proof WHERE payment_id=?').get(s.paymentId);
  if (row.native_published===1) return;
  const e=JSON.stringify(closeFields(packet.result));
  const prior=db.prepare(`SELECT v.evidence,v.source,v.reference FROM fiscal_checkout_verified_results v
    JOIN fiscal_checkout_attempts a ON a.id=v.attempt_id WHERE a.bill_id=? AND v.status='accepted'`).get(s.billId);
  if (prior) {
    hold(prior.evidence===e && prior.source==='device-'+s.deviceId && prior.reference===packet.result.documentNumber,'EXISTING_RECOVERY_MISMATCH');
    return;
  }
  if (unresolvedNativeAttempt(db) || !db.prepare('SELECT 1 FROM business_days WHERE id=? AND closed_at IS NULL').get(s.dayId) ||
    db.prepare('SELECT 1 FROM fiscal_daily_current WHERE day_id=?').get(s.dayId)) return;
  hold(!db.prepare('SELECT 1 FROM fiscal_checkout_sales WHERE bill_id=?').get(s.billId),'EXISTING_PROOF');
  saveNative(db,s,packet);
  db.exec(`CREATE TABLE card_receipt_incident_promotion(payment_id INTEGER PRIMARY KEY REFERENCES card_receipt_incident_proof(payment_id),
    actor_id INTEGER NOT NULL REFERENCES local_users(id),promoted_at INTEGER NOT NULL,trace_hash TEXT NOT NULL) STRICT`);
  db.prepare('INSERT INTO card_receipt_incident_promotion VALUES(?,?,?,?)').run(s.paymentId,actorId,Date.now(),packet.traceHash);
  for (const op of ['INSERT','DELETE','UPDATE']) db.exec(`CREATE TRIGGER promotion_sealed_${op} BEFORE ${op} ON card_receipt_incident_promotion
    BEGIN SELECT RAISE(ABORT,'Recovery promotion is immutable'); END`);
}
function publish(db,s,packet,actorId) {
  assertReadyToPublish(db,s);
  const p=packet.result;
  const evidence=closeFields(p);
  // Use the physical recovery times and actual verified close/debit evidence, and retain
  // the unconfirmed Fast Pay attempt forever. Do not re-record the original payment.
  const otherAttempt=unresolvedNativeAttempt(db);
  if (!otherAttempt) saveNative(db,s,packet);
  db.exec(`CREATE TABLE card_receipt_incident_proof(
    payment_id INTEGER PRIMARY KEY REFERENCES payments(id),bill_id INTEGER UNIQUE NOT NULL REFERENCES bills(id),
    document_number TEXT NOT NULL,binding_hash TEXT NOT NULL,trace_hash TEXT NOT NULL,
    recovered_by INTEGER NOT NULL REFERENCES local_users(id),published_by INTEGER NOT NULL REFERENCES local_users(id),
    recovered_at INTEGER NOT NULL,published_at INTEGER NOT NULL,register_proof TEXT NOT NULL CHECK(json_valid(register_proof)),
    close_evidence TEXT NOT NULL CHECK(json_valid(close_evidence)),native_published INTEGER NOT NULL CHECK(native_published IN(0,1))) STRICT`);
  db.prepare('INSERT INTO card_receipt_incident_proof VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(s.paymentId,s.billId,p.documentNumber,
    s.fingerprint,packet.traceHash,packet.actor,actorId,packet.finished,Date.now(),JSON.stringify({before:p.before,after:p.after}),
    JSON.stringify(evidence),otherAttempt?0:1);
  // This kit can only supplement one incident, and there is no general-purpose insert path.
  for (const op of ['INSERT','DELETE','UPDATE']) db.exec(`CREATE TRIGGER incident_sealed_${op} BEFORE ${op}
    ON card_receipt_incident_proof BEGIN SELECT RAISE(ABORT,'Original recovery proof is immutable'); END;`);
  db.exec('DROP VIEW fast_pay_v1_status');
  db.exec(recoveredView);
  hold(already(db,s,packet),'PUBLICATION');
}
module.exports={already,publish,promoteIfAvailable,assertReadyToPublish};
