function migrateSimulatedCashRecovery(db) {
  db.exec(`CREATE TABLE simulated_cash_intents (
    id INTEGER PRIMARY KEY,
    bill_id INTEGER NOT NULL UNIQUE REFERENCES bills(id),
    actor_id INTEGER NOT NULL REFERENCES local_users(id),
    interruption TEXT NOT NULL CHECK(interruption IN ('before_open','after_items','after_tender','after_close','after_ack')),
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TRIGGER simulated_cash_intent_guard BEFORE INSERT ON simulated_cash_intents
  WHEN NOT EXISTS(SELECT 1 FROM bills b JOIN orders o ON o.id=b.order_id WHERE b.id=NEW.bill_id
    AND o.status='open' AND o.retired_empty=0 AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.bill_id=b.id))
    OR EXISTS(SELECT 1 FROM fiscal_checkout_sales WHERE bill_id=NEW.bill_id)
    OR EXISTS(SELECT 1 FROM simulated_card_open_intents WHERE bill_id=NEW.bill_id)
    OR EXISTS(SELECT 1 FROM simulated_card_approvals WHERE bill_id=NEW.bill_id)
    OR EXISTS(SELECT 1 FROM simulated_cash_intents WHERE id=NEW.id OR bill_id=NEW.bill_id)
  BEGIN SELECT RAISE(ABORT,'Invalid simulated cash intent'); END;
  CREATE TRIGGER simulated_cash_intent_no_update BEFORE UPDATE ON simulated_cash_intents
  BEGIN SELECT RAISE(ABORT,'Simulated cash intent is retained'); END;
  CREATE TRIGGER simulated_cash_intent_no_delete BEFORE DELETE ON simulated_cash_intents
  BEGIN SELECT RAISE(ABORT,'Simulated cash intent is retained'); END;
  CREATE VIEW simulated_cash_open_intents AS
    SELECT i.* FROM simulated_cash_intents i WHERE NOT EXISTS(SELECT 1 FROM payments p WHERE p.bill_id=i.bill_id);
  CREATE TRIGGER simulated_cash_card_intent_guard BEFORE INSERT ON simulated_card_intents
  WHEN EXISTS(SELECT 1 FROM simulated_cash_open_intents WHERE bill_id=NEW.bill_id)
  BEGIN SELECT RAISE(ABORT,'Unresolved simulated cash intent'); END;
  CREATE TRIGGER simulated_cash_order_guard BEFORE UPDATE OF status,retired_empty ON orders
  WHEN EXISTS(SELECT 1 FROM bills b JOIN simulated_cash_open_intents i ON i.bill_id=b.id WHERE b.order_id=OLD.id)
    AND (NEW.status!=OLD.status OR NEW.retired_empty!=OLD.retired_empty)
  BEGIN SELECT RAISE(ABORT,'Unresolved simulated cash intent'); END;
  CREATE TRIGGER simulated_cash_shift_guard BEFORE INSERT ON shift_closes
  WHEN EXISTS(SELECT 1 FROM simulated_cash_open_intents)
  BEGIN SELECT RAISE(ABORT,'Resolve current checkout before closing'); END;
  CREATE TRIGGER simulated_cash_day_guard BEFORE UPDATE OF closed_at ON business_days
  WHEN NEW.closed_at IS NOT NULL AND EXISTS(SELECT 1 FROM simulated_cash_open_intents)
  BEGIN SELECT RAISE(ABORT,'Resolve current checkout before closing'); END;
  CREATE TRIGGER simulated_cash_account_a_guard BEFORE INSERT ON account_a_closes
  WHEN EXISTS(SELECT 1 FROM simulated_cash_open_intents)
  BEGIN SELECT RAISE(ABORT,'Resolve current checkout before closing'); END;
  CREATE TRIGGER simulated_cash_daily_guard BEFORE INSERT ON fiscal_daily_reports
  WHEN EXISTS(SELECT 1 FROM simulated_cash_open_intents)
  BEGIN SELECT RAISE(ABORT,'Resolve current checkout before closing'); END;
  CREATE TRIGGER simulated_cash_intent_sale_guard BEFORE INSERT ON fiscal_checkout_sales
  WHEN EXISTS(SELECT 1 FROM simulated_cash_intents WHERE bill_id=NEW.bill_id)
    AND (NEW.mode!='simulation' OR NEW.method!='cash')
  BEGIN SELECT RAISE(ABORT,'Unresolved simulated cash intent'); END;
  CREATE TRIGGER simulated_cash_intent_payment_guard BEFORE INSERT ON payments
  WHEN EXISTS(SELECT 1 FROM simulated_cash_intents WHERE bill_id=NEW.bill_id)
    AND (NEW.method!='cash' OR NEW.account!='A' OR NOT EXISTS(
      SELECT 1 FROM fiscal_checkout_sales s JOIN fiscal_checkout_attempts a ON a.bill_id=s.bill_id
      JOIN simulated_cash_attempts c ON c.attempt_id=a.id
      JOIN fiscal_checkout_verified_results r ON r.attempt_id=a.id
      WHERE s.bill_id=NEW.bill_id AND s.mode='simulation' AND s.method='cash' AND r.status='accepted'))
  BEGIN SELECT RAISE(ABORT,'Unresolved simulated cash intent'); END;
  CREATE TABLE simulated_cash_attempts (
    attempt_id INTEGER PRIMARY KEY REFERENCES fiscal_checkout_attempts(id),
    nonce TEXT NOT NULL UNIQUE CHECK(length(nonce)=64 AND nonce NOT GLOB '*[^a-f0-9]*'),
    interruption TEXT NOT NULL CHECK(interruption IN ('before_open','after_items','after_tender','after_close','after_ack'))
  ) STRICT;
  CREATE TRIGGER simulated_cash_attempt_guard BEFORE INSERT ON simulated_cash_attempts
  WHEN NOT EXISTS(SELECT 1 FROM fiscal_checkout_attempts a JOIN fiscal_checkout_sales s ON s.bill_id=a.bill_id
    WHERE a.id=NEW.attempt_id AND s.mode='simulation' AND s.method='cash')
    OR EXISTS(SELECT 1 FROM simulated_cash_attempts WHERE attempt_id=NEW.attempt_id OR nonce=NEW.nonce)
  BEGIN SELECT RAISE(ABORT,'Invalid simulated cash attempt'); END;
  CREATE TRIGGER simulated_cash_attempt_no_update BEFORE UPDATE ON simulated_cash_attempts
  BEGIN SELECT RAISE(ABORT,'Simulated cash attempt is retained'); END;
  CREATE TRIGGER simulated_cash_attempt_no_delete BEFORE DELETE ON simulated_cash_attempts
  BEGIN SELECT RAISE(ABORT,'Simulated cash attempt is retained'); END;`);
}
module.exports = { migrateSimulatedCashRecovery };
