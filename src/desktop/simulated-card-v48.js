// A simulated terminal approval is retained separately from the printer journal:
// fiscal preflight can fail before an attempt exists. This is not evidence of
// any actual terminal transaction.
function migrateSimulatedCard(db) {
  db.exec(`
    CREATE TABLE simulated_card_intents (
      id INTEGER PRIMARY KEY,
      bill_id INTEGER NOT NULL REFERENCES bills(id),
      actor_id INTEGER NOT NULL REFERENCES local_users(id),
      amount INTEGER NOT NULL CHECK(amount >= 0),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE simulated_card_intent_results (
      intent_id INTEGER PRIMARY KEY REFERENCES simulated_card_intents(id),
      status TEXT NOT NULL CHECK(status IN ('approved','declined')),
      recorded_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE simulated_card_approvals (
      bill_id INTEGER PRIMARY KEY REFERENCES bills(id),
      actor_id INTEGER NOT NULL REFERENCES local_users(id),
      amount INTEGER NOT NULL CHECK(amount >= 0),
      approved_at INTEGER NOT NULL
    ) STRICT;
    CREATE VIEW simulated_card_open_intents AS
      SELECT i.id,i.bill_id,i.actor_id,i.amount,i.created_at FROM simulated_card_intents i
      LEFT JOIN simulated_card_intent_results r ON r.intent_id=i.id
      WHERE r.intent_id IS NULL OR (r.status='approved' AND NOT EXISTS
        (SELECT 1 FROM simulated_card_approvals a WHERE a.bill_id=i.bill_id));
    CREATE TRIGGER simulated_card_intent_guard BEFORE INSERT ON simulated_card_intents
    WHEN NOT EXISTS(SELECT 1 FROM bills b JOIN orders o ON o.id=b.order_id
      WHERE b.id=NEW.bill_id AND b.total=NEW.amount AND o.status='open' AND o.retired_empty=0
        AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.bill_id=b.id))
      OR EXISTS(SELECT 1 FROM simulated_card_intents WHERE id=NEW.id)
      OR EXISTS(SELECT 1 FROM simulated_card_open_intents WHERE bill_id=NEW.bill_id)
      OR EXISTS(SELECT 1 FROM simulated_card_approvals WHERE bill_id=NEW.bill_id)
      OR EXISTS(SELECT 1 FROM fiscal_checkout_sales WHERE bill_id=NEW.bill_id)
    BEGIN SELECT RAISE(ABORT,'Invalid simulated card intent'); END;
    CREATE TRIGGER simulated_card_intents_no_update BEFORE UPDATE ON simulated_card_intents
    BEGIN SELECT RAISE(ABORT,'Simulated card intent is retained'); END;
    CREATE TRIGGER simulated_card_intents_no_delete BEFORE DELETE ON simulated_card_intents
    BEGIN SELECT RAISE(ABORT,'Simulated card intent is retained'); END;
    CREATE TRIGGER simulated_card_intent_result_guard BEFORE INSERT ON simulated_card_intent_results
    WHEN NOT EXISTS(SELECT 1 FROM simulated_card_intents i JOIN bills b ON b.id=i.bill_id
      JOIN orders o ON o.id=b.order_id WHERE i.id=NEW.intent_id AND i.amount=b.total
      AND o.status='open' AND o.retired_empty=0
      AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.bill_id=b.id)
      AND NOT EXISTS(SELECT 1 FROM simulated_card_approvals a WHERE a.bill_id=b.id)
      AND NOT EXISTS(SELECT 1 FROM fiscal_checkout_sales s WHERE s.bill_id=b.id))
      OR EXISTS(SELECT 1 FROM simulated_card_intent_results WHERE intent_id=NEW.intent_id)
    BEGIN SELECT RAISE(ABORT,'Invalid simulated card intent result'); END;
    CREATE TRIGGER simulated_card_intent_results_no_update BEFORE UPDATE ON simulated_card_intent_results
    BEGIN SELECT RAISE(ABORT,'Simulated card result is retained'); END;
    CREATE TRIGGER simulated_card_intent_results_no_delete BEFORE DELETE ON simulated_card_intent_results
    BEGIN SELECT RAISE(ABORT,'Simulated card result is retained'); END;
    CREATE TABLE simulated_card_attempts (
      attempt_id INTEGER PRIMARY KEY REFERENCES fiscal_checkout_attempts(id),
      nonce TEXT NOT NULL UNIQUE CHECK(length(nonce)=64 AND nonce NOT GLOB '*[^0-9a-f]*')
    ) STRICT;
    CREATE TRIGGER simulated_card_attempt_guard BEFORE INSERT ON simulated_card_attempts
    WHEN NOT EXISTS(SELECT 1 FROM fiscal_checkout_attempts a
      JOIN fiscal_checkout_sales s ON s.bill_id=a.bill_id JOIN simulated_card_approvals c ON c.bill_id=s.bill_id
      WHERE a.id=NEW.attempt_id AND s.mode='simulation' AND s.method='card')
      OR EXISTS(SELECT 1 FROM simulated_card_attempts WHERE attempt_id=NEW.attempt_id OR nonce=NEW.nonce)
    BEGIN SELECT RAISE(ABORT,'Invalid simulated card attempt'); END;
    CREATE TRIGGER simulated_card_attempts_no_update BEFORE UPDATE ON simulated_card_attempts
    BEGIN SELECT RAISE(ABORT,'Simulated card attempt is retained'); END;
    CREATE TRIGGER simulated_card_attempts_no_delete BEFORE DELETE ON simulated_card_attempts
    BEGIN SELECT RAISE(ABORT,'Simulated card attempt is retained'); END;
    CREATE TRIGGER simulated_card_approval_guard BEFORE INSERT ON simulated_card_approvals
    WHEN NOT EXISTS (SELECT 1 FROM bills b JOIN orders o ON o.id=b.order_id
      WHERE b.id=NEW.bill_id AND b.total=NEW.amount AND o.status='open' AND o.retired_empty=0
        AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.bill_id=b.id))
      OR EXISTS(SELECT 1 FROM fiscal_checkout_sales s WHERE s.bill_id=NEW.bill_id
        AND (s.mode!='simulation' OR s.method!='card'))
      OR EXISTS(SELECT 1 FROM simulated_card_approvals WHERE bill_id=NEW.bill_id)
      OR NOT EXISTS(SELECT 1 FROM simulated_card_intents i JOIN simulated_card_intent_results r ON r.intent_id=i.id
        WHERE i.bill_id=NEW.bill_id AND i.actor_id=NEW.actor_id AND i.amount=NEW.amount AND r.status='approved')
    BEGIN SELECT RAISE(ABORT,'Invalid simulated card approval'); END;
    CREATE TRIGGER simulated_card_approvals_no_update BEFORE UPDATE ON simulated_card_approvals
    BEGIN SELECT RAISE(ABORT,'Simulated card approval is retained'); END;
    CREATE TRIGGER simulated_card_approvals_no_delete BEFORE DELETE ON simulated_card_approvals
    BEGIN SELECT RAISE(ABORT,'Simulated card approval is retained'); END;
    CREATE TRIGGER simulated_card_payment_guard BEFORE INSERT ON payments
    WHEN EXISTS(SELECT 1 FROM simulated_card_approvals a WHERE a.bill_id=NEW.bill_id)
      AND (NEW.method!='card' OR NEW.account!='A' OR NOT EXISTS(
        SELECT 1 FROM simulated_card_approvals a JOIN fiscal_checkout_sales s ON s.bill_id=a.bill_id
        JOIN fiscal_checkout_attempts t ON t.bill_id=s.bill_id
        JOIN fiscal_checkout_verified_results r ON r.attempt_id=t.id
        WHERE a.bill_id=NEW.bill_id AND a.amount=NEW.amount AND s.mode='simulation'
          AND s.method='card' AND r.status='accepted'))
    BEGIN SELECT RAISE(ABORT,'Unresolved simulated card approval'); END;
    CREATE TRIGGER simulated_card_intent_payment_guard BEFORE INSERT ON payments
    WHEN EXISTS(SELECT 1 FROM simulated_card_open_intents WHERE bill_id=NEW.bill_id)
    BEGIN SELECT RAISE(ABORT,'Unresolved simulated card intent'); END;
    CREATE TRIGGER simulated_card_sale_guard BEFORE INSERT ON fiscal_checkout_sales
    WHEN EXISTS(SELECT 1 FROM simulated_card_open_intents WHERE bill_id=NEW.bill_id)
      OR (EXISTS(SELECT 1 FROM simulated_card_approvals WHERE bill_id=NEW.bill_id)
        AND (NEW.mode!='simulation' OR NEW.method!='card'))
    BEGIN SELECT RAISE(ABORT,'Unresolved simulated card intent'); END;
    CREATE TRIGGER simulated_card_order_guard BEFORE UPDATE OF status,retired_empty ON orders
    WHEN (EXISTS(SELECT 1 FROM bills b JOIN simulated_card_approvals a ON a.bill_id=b.id
      WHERE b.order_id=OLD.id AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.bill_id=b.id))
      OR EXISTS(SELECT 1 FROM bills b JOIN simulated_card_open_intents i ON i.bill_id=b.id WHERE b.order_id=OLD.id))
      AND (NEW.status!=OLD.status OR NEW.retired_empty!=OLD.retired_empty)
    BEGIN SELECT RAISE(ABORT,'Unresolved simulated card approval'); END;
    CREATE VIEW simulated_card_open_approvals AS
      SELECT a.bill_id FROM simulated_card_approvals a
      WHERE NOT EXISTS(SELECT 1 FROM payments p WHERE p.bill_id=a.bill_id);
    CREATE TRIGGER simulated_card_shift_guard BEFORE INSERT ON shift_closes
    WHEN EXISTS(SELECT 1 FROM simulated_card_open_approvals) OR EXISTS(SELECT 1 FROM simulated_card_open_intents)
    BEGIN SELECT RAISE(ABORT,'Resolve current checkout before closing'); END;
    CREATE TRIGGER simulated_card_day_guard BEFORE UPDATE OF closed_at ON business_days
    WHEN NEW.closed_at IS NOT NULL AND (EXISTS(SELECT 1 FROM simulated_card_open_approvals) OR EXISTS(SELECT 1 FROM simulated_card_open_intents))
    BEGIN SELECT RAISE(ABORT,'Resolve current checkout before closing'); END;
    CREATE TRIGGER simulated_card_account_a_guard BEFORE INSERT ON account_a_closes
    WHEN EXISTS(SELECT 1 FROM simulated_card_open_approvals) OR EXISTS(SELECT 1 FROM simulated_card_open_intents)
    BEGIN SELECT RAISE(ABORT,'Resolve current checkout before closing'); END;
    CREATE TRIGGER simulated_card_daily_guard BEFORE INSERT ON fiscal_daily_reports
    WHEN EXISTS(SELECT 1 FROM simulated_card_open_approvals) OR EXISTS(SELECT 1 FROM simulated_card_open_intents)
    BEGIN SELECT RAISE(ABORT,'Resolve current checkout before closing'); END;
  `);
}

module.exports = { migrateSimulatedCard };
