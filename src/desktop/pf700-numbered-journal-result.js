'use strict';

const { createHash } = require('node:crypto');
const { readCandidate } = require('./pf700-bill2-candidate');

// Fingerprints of the shipped results table, its triggers and the verified
// results view in the story database and the POS 1.0.10 database. v53 adds a
// physical-card result guard. Preserve the complete original SELECT verbatim.
const originalContracts = new Map([
  [50, 'ff7e161818d1a144772660a800b3bf860a49b54d7d650898f3b7bf51d7168e62'],
  [53, '3b096fd3a94bd031f10e8d1157aaacad76b867c6abff60e82419d245ba2a5106']
]);
function originalVerifiedView(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const rows = db.prepare(`SELECT name,sql FROM main.sqlite_schema WHERE
    (tbl_name='fiscal_checkout_results' AND sql IS NOT NULL) OR name='fiscal_checkout_verified_results'
    ORDER BY name`).all();
  const hash = createHash('sha256').update(rows.map(row => row.sql.replaceAll('\r\n', '\n')).join('\n')).digest('hex');
  if (originalContracts.get(version) !== hash) return null;
  return rows.find(row => row.name === 'fiscal_checkout_verified_results').sql;
}

// The caller has verified the numbered journal against the frozen bill and
// original trace inside the settlement transaction. Saving one immutable
// witness lets the installed POS recognize this receipt without inventing a
// missing close ACK or broadening its rules for any other attempt/document.
function persistNumberedJournal(db, candidate, evidence) {
  if (!db.isTransaction || candidate.billId !== 2 || candidate.expectedDocument !== '0000030' ||
      candidate.total !== 150 || evidence.kind !== 'numbered-journal' || evidence.documentNumber !== '0000030' ||
      evidence.binding !== candidate.binding || Object.keys(evidence).length !== 6 ||
      ![evidence.binding, evidence.captureHash, evidence.journalHash, evidence.responseHash].every(
        value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) {
    throw Error('Invalid numbered journal result');
  }
  const proof = JSON.stringify(evidence);
  const source = 'device-' + candidate.serial;
  const prior = db.prepare(`SELECT 1 FROM fiscal_checkout_verified_results
    WHERE attempt_id=? AND status='accepted' AND source=? AND reference='0000030' AND evidence=?`)
    .get(candidate.attemptId, source, proof);
  if (prior) return;
  const view = originalVerifiedView(db);
  if (!view) throw Error('Unexpected fiscal verification schema');
  const current = readCandidate(db, 2, '0000030', {matchJournalPaper:true});
  if (!current || current.binding !== evidence.binding || current.attemptId !== candidate.attemptId ||
      current.serial !== candidate.serial) throw Error('Cash checkout evidence changed');
  db.exec(`CREATE TABLE pf700_bill2_numbered_journal (
    attempt_id INTEGER PRIMARY KEY REFERENCES fiscal_checkout_attempts(id),
    evidence TEXT NOT NULL CHECK(json_valid(evidence))
  ) STRICT`);
  db.prepare('INSERT INTO pf700_bill2_numbered_journal VALUES(?,?)').run(candidate.attemptId, proof);
  // This one-shot table is sealed as part of the same transaction that first
  // creates it. Even INSERT OR REPLACE cannot attach the witness elsewhere.
  for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
    db.exec(`CREATE TRIGGER pf700_bill2_journal_no_${operation} BEFORE ${operation} ON pf700_bill2_numbered_journal
      BEGIN SELECT RAISE(ABORT,'Numbered journal witness is immutable'); END`);
  }
  db.exec('DROP VIEW fiscal_checkout_verified_results');
  db.exec(view + `
    UNION ALL
    SELECT r.* FROM fiscal_checkout_results r
      JOIN pf700_bill2_numbered_journal j ON j.attempt_id=r.attempt_id AND j.evidence=r.evidence
      JOIN fiscal_checkout_attempts a ON a.id=r.attempt_id
      JOIN fiscal_checkout_sales s ON s.bill_id=a.bill_id
      JOIN fiscal_checkout_baselines b ON b.attempt_id=a.id AND b.device_id=s.device_id
      JOIN pf700_cash_dispatches d ON d.attempt_id=a.id
      JOIN pf700_cash_intents i ON i.id=d.intent_id AND i.bill_id=s.bill_id AND i.actor_id=s.actor_id
        AND i.device_id=s.device_id AND i.receipt=s.receipt
      WHERE a.bill_id=2 AND s.mode='device' AND s.method='cash' AND r.source='device-' || s.device_id
        AND r.status='accepted' AND r.reference='0000030' AND b.previous_document='0000029'`);
  db.prepare(`INSERT INTO fiscal_checkout_results(attempt_id,status,source,reference,evidence,ended_at)
    VALUES(?,'accepted',?,'0000030',?,?)`).run(candidate.attemptId, source, proof, Date.now());
}

// Only a payment committed with this package's witness can be replayed after
// the sidecar files are archived. An ordinary close ACK for 0000030 is distinct.
function readSettledNumberedJournal(db, billId, journalHash) {
  const witness = db.prepare(`SELECT 1 FROM main.sqlite_schema
    WHERE type='table' AND name='pf700_bill2_numbered_journal'`).get();
  if (!witness || billId !== 2) return null;
  const row = db.prepare(`SELECT j.evidence FROM pf700_bill2_numbered_journal j
    JOIN fiscal_checkout_verified_results r ON r.attempt_id=j.attempt_id AND r.evidence=j.evidence
    JOIN fiscal_checkout_attempts t ON t.id=j.attempt_id
    JOIN fiscal_checkout_sales s ON s.bill_id=t.bill_id
    JOIN bills b ON b.id=t.bill_id JOIN orders o ON o.id=b.order_id
    JOIN payments p ON p.bill_id=b.id AND p.actor_id=s.actor_id AND p.account='A' AND p.method='cash'
    JOIN pf700_cash_dispatches d ON d.attempt_id=t.id
    JOIN pf700_cash_intent_results i ON i.intent_id=d.intent_id AND i.status='paid'
    WHERE b.id=? AND b.total=150 AND p.amount=b.total AND o.status='completed'
      AND s.mode='device' AND s.method='cash' AND r.source='device-' || s.device_id
      AND r.status='accepted' AND r.reference='0000030'`).get(billId);
  if (!row) return null;
  const evidence = JSON.parse(row.evidence);
  if (evidence.kind !== 'numbered-journal' || evidence.documentNumber !== '0000030' ||
      evidence.journalHash !== journalHash || Object.keys(evidence).length !== 6 ||
      ![evidence.binding,evidence.captureHash,evidence.responseHash].every(
        value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) return null;
  return {reference:evidence.documentNumber, evidence, settled:true};
}

module.exports = { originalVerifiedView, persistNumberedJournal, readSettledNumberedJournal };
