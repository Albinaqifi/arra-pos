// A single attended terminal trial per database. Only a matching verified
// fiscal receipt can settle an approval. A decline consumes the trial.
function migratePf700Card(db) {
  db.exec(`
    CREATE TABLE pf700_card_intents (
      id INTEGER PRIMARY KEY CHECK(id=1),
      bill_id INTEGER NOT NULL REFERENCES bills(id),
      actor_id INTEGER NOT NULL REFERENCES local_users(id),
      device_id TEXT NOT NULL,
      token TEXT NOT NULL CHECK(length(token)=32 AND token NOT GLOB '*[^0-9a-f]*'),
      receipt TEXT NOT NULL CHECK(json_valid(receipt)),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE pf700_card_outcomes (
      intent_id INTEGER PRIMARY KEY REFERENCES pf700_card_intents(id),
      status TEXT NOT NULL CHECK(status IN ('approved','declined')),
      actor_id INTEGER NOT NULL REFERENCES local_users(id),
      recorded_at INTEGER NOT NULL
    ) STRICT;
    CREATE VIEW pf700_card_open_intents AS
      SELECT i.*,r.status AS outcome FROM pf700_card_intents i LEFT JOIN pf700_card_outcomes r ON r.intent_id=i.id
      WHERE r.status IS NOT 'declined' AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.bill_id=i.bill_id);
    CREATE TRIGGER pf700_card_intent_guard BEFORE INSERT ON pf700_card_intents
    WHEN NOT EXISTS(SELECT 1 FROM bills b JOIN orders o ON o.id=b.order_id WHERE b.id=NEW.bill_id
      AND o.status='open' AND o.retired_empty=0 AND json_extract(NEW.receipt,'$.billId')=b.id
      AND json_extract(NEW.receipt,'$.method')='card' AND json_extract(NEW.receipt,'$.account')='A'
      AND json_extract(NEW.receipt,'$.total')=b.total AND b.total>0
      AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.bill_id=b.id))
      OR EXISTS(SELECT 1 FROM fiscal_checkout_sales WHERE bill_id=NEW.bill_id)
      OR EXISTS(SELECT 1 FROM pf700_cash_open_intents)
      OR EXISTS(SELECT 1 FROM simulated_card_open_intents)
      OR EXISTS(SELECT 1 FROM simulated_card_open_approvals)
      OR EXISTS(SELECT 1 FROM simulated_cash_open_intents)
      OR EXISTS(SELECT 1 FROM fiscal_checkout_attempts a LEFT JOIN fiscal_checkout_verified_results r ON r.attempt_id=a.id
        WHERE r.status IS NULL OR (r.status='accepted' AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.bill_id=a.bill_id)))
      OR EXISTS(SELECT 1 FROM fiscal_daily_current d LEFT JOIN fiscal_daily_confirmations c USING(day_id) WHERE c.day_id IS NULL)
    BEGIN SELECT RAISE(ABORT,'Invalid supervised card trial'); END;
    CREATE TRIGGER pf700_card_outcome_guard BEFORE INSERT ON pf700_card_outcomes
      WHEN NOT EXISTS(SELECT 1 FROM pf700_card_open_intents i WHERE i.id=NEW.intent_id AND i.outcome IS NULL)
      BEGIN SELECT RAISE(ABORT,'Terminal result already recorded'); END;
    CREATE TRIGGER pf700_card_sale_guard BEFORE INSERT ON fiscal_checkout_sales
      WHEN EXISTS(SELECT 1 FROM pf700_card_open_intents) AND NOT EXISTS(
        SELECT 1 FROM pf700_card_open_intents i WHERE i.bill_id=NEW.bill_id AND i.outcome='approved'
        AND NEW.device_id=i.device_id AND NEW.mode='device' AND NEW.method='card'
        AND i.receipt=NEW.receipt AND i.actor_id=NEW.actor_id)
      BEGIN SELECT RAISE(ABORT,'Unresolved supervised card trial'); END;
    CREATE TRIGGER pf700_card_attempt_guard BEFORE INSERT ON fiscal_checkout_attempts
      WHEN EXISTS(SELECT 1 FROM pf700_card_open_intents i WHERE i.bill_id=NEW.bill_id)
        AND EXISTS(SELECT 1 FROM fiscal_checkout_attempts WHERE bill_id=NEW.bill_id)
      BEGIN SELECT RAISE(ABORT,'Supervised card dispatch already used'); END;
    CREATE TRIGGER pf700_card_payment_guard BEFORE INSERT ON payments
      WHEN EXISTS(SELECT 1 FROM pf700_card_open_intents WHERE bill_id=NEW.bill_id)
      AND NOT EXISTS(SELECT 1 FROM pf700_card_open_intents i JOIN fiscal_checkout_sales s ON s.bill_id=i.bill_id
        JOIN fiscal_checkout_attempts a ON a.bill_id=s.bill_id JOIN fiscal_checkout_verified_results r ON r.attempt_id=a.id
        WHERE i.bill_id=NEW.bill_id AND i.outcome='approved' AND NEW.method='card' AND NEW.account='A'
        AND NEW.actor_id=i.actor_id AND NEW.amount=json_extract(i.receipt,'$.total') AND i.receipt=s.receipt
        AND s.mode='device' AND s.method='card' AND s.device_id=i.device_id AND r.status='accepted'
        AND json_type(r.evidence,'$.debitAmountMinor')='integer' AND json_extract(r.evidence,'$.debitAmountMinor')=NEW.amount*100)
      BEGIN SELECT RAISE(ABORT,'Unresolved supervised card trial'); END;
    CREATE TRIGGER pf700_card_result_guard BEFORE INSERT ON fiscal_checkout_results
      WHEN NEW.status='accepted' AND EXISTS(SELECT 1 FROM fiscal_checkout_attempts a JOIN pf700_card_open_intents i ON i.bill_id=a.bill_id
        WHERE a.id=NEW.attempt_id AND (json_type(NEW.evidence,'$.debitAmountMinor') IS NOT 'integer'
        OR json_extract(NEW.evidence,'$.debitAmountMinor')!=json_extract(i.receipt,'$.total')*100))
      BEGIN SELECT RAISE(ABORT,'Missing approved card tender evidence'); END;
    CREATE TRIGGER pf700_card_order_guard BEFORE UPDATE OF status,retired_empty ON orders
      WHEN EXISTS(SELECT 1 FROM pf700_card_open_intents i JOIN bills b ON b.id=i.bill_id WHERE b.order_id=OLD.id)
      AND (NEW.status!=OLD.status OR NEW.retired_empty!=OLD.retired_empty)
      BEGIN SELECT RAISE(ABORT,'Unresolved supervised card trial'); END;
  `);
  for (const table of ['pf700_cash_intents','simulated_card_intents','simulated_cash_intents','shift_closes',
    'account_a_closes','fiscal_daily_reports','business_days']) {
    const update = table === 'business_days';
    db.exec(`CREATE TRIGGER pf700_card_block_${table} BEFORE ${update ? 'UPDATE OF closed_at' : 'INSERT'} ON ${table}
      WHEN ${update ? 'NEW.closed_at IS NOT NULL AND ' : ''}EXISTS(SELECT 1 FROM pf700_card_open_intents)
      BEGIN SELECT RAISE(ABORT,'Resolve current checkout before closing'); END;`);
  }
  for (const [table,key] of [['pf700_card_intents','id'],['pf700_card_outcomes','intent_id']]) {
    db.exec(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Card trial history is retained'); END;
      CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Card trial history is retained'); END;
      CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${key}=NEW.${key})
      BEGIN SELECT RAISE(ABORT,'Card trial history is retained'); END;`);
  }
}
module.exports = { migratePf700Card };
