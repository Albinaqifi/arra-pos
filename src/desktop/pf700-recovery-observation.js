// A read-only device inquiry can overwrite the PF700's last cached reply.
// Only an attempt whose own command history is complete may be sealed. The
// seal is checked by every command reservation before any further wire write.
function candidate(db,billId,adapter) {
  if (adapter?.mode!=='device' || typeof adapter.acquireCashObservation!=='function') return null;
  const row=db.prepare(`SELECT a.id AS attemptId,i.id AS intentId
    FROM pf700_cash_open_intents i JOIN fiscal_checkout_sales s ON s.bill_id=i.bill_id
    JOIN fiscal_checkout_attempts a ON a.bill_id=s.bill_id
    JOIN pf700_cash_dispatches d ON d.attempt_id=a.id AND d.intent_id=i.id
    JOIN bills b ON b.id=i.bill_id JOIN orders o ON o.id=b.order_id
    WHERE i.bill_id=? AND i.device_id=? AND s.mode='device' AND s.method='cash'
      AND s.device_id=i.device_id AND s.receipt=i.receipt AND o.status='open' AND o.retired_empty=0
      AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.bill_id=i.bill_id)
      AND NOT EXISTS(SELECT 1 FROM fiscal_checkout_results r WHERE r.attempt_id=a.id)
      AND a.id=(SELECT MAX(last.id) FROM fiscal_checkout_attempts last WHERE last.bill_id=i.bill_id)`).get(billId,adapter.deviceId);
  if (!row) return null;
  if (db.prepare(`SELECT 1 FROM fiscal_checkout_attempts a LEFT JOIN fiscal_checkout_verified_results r ON r.attempt_id=a.id
    JOIN fiscal_checkout_sales s ON s.bill_id=a.bill_id WHERE s.mode='device' AND a.id!=? AND r.attempt_id IS NULL LIMIT 1`).get(row.attemptId)) return null;
  if (db.prepare(`SELECT 1 FROM fiscal_daily_current d LEFT JOIN fiscal_daily_confirmations c USING(day_id)
    WHERE d.mode='device' AND c.day_id IS NULL LIMIT 1`).get()) return null;
  const commands=db.prepare(`SELECT c.command,a.summary FROM pf700_command_intents c
    LEFT JOIN pf700_command_acks a ON a.command_id=c.id WHERE c.attempt_id=? ORDER BY c.id`).all(row.attemptId);
  if (!commands.length || commands[0].command!==90 || commands.some(command=>!command.summary)) return null;
  let identity;
  try { identity=JSON.parse(commands[0].summary); } catch { return null; }
  if (identity?.identityMatched!==true || identity.onsiteFirmware!==true) return null;
  return row;
}

// Caller holds BEGIN IMMEDIATE. The database seal prevents a sender from
// reserving any subsequent wire command, including a delayed original sender.
function seal(db,billId,adapter,actor) {
  const row=candidate(db,billId,adapter);
  if (!row) return null;
  if (!db.prepare('SELECT 1 FROM pf700_command_seals WHERE attempt_id=?').get(row.attemptId)) {
    db.prepare('INSERT INTO pf700_command_seals(attempt_id,actor_id,created_at) VALUES(?,?,?)').run(row.attemptId,actor,Date.now());
  }
  return row;
}
module.exports = { candidate, seal };
