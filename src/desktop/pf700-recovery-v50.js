// Durable physical Cash A preparation and non-secret wire metadata. A prepared
// intent does not say that a printer operation happened; dispatch and replies
// are separate append-only facts. Existing attempts have no such evidence.
function migratePf700Recovery(db) {
  db.exec(`
    CREATE TABLE pf700_cash_intents (
      id INTEGER PRIMARY KEY,
      bill_id INTEGER NOT NULL REFERENCES bills(id),
      actor_id INTEGER NOT NULL REFERENCES local_users(id),
      device_id TEXT NOT NULL CHECK(length(device_id) BETWEEN 1 AND 80),
      receipt TEXT NOT NULL CHECK(json_valid(receipt)),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE pf700_cash_intent_results (
      intent_id INTEGER PRIMARY KEY REFERENCES pf700_cash_intents(id),
      actor_id INTEGER NOT NULL REFERENCES local_users(id),
      status TEXT NOT NULL CHECK(status IN ('released','paid')),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE VIEW pf700_cash_open_intents AS
      SELECT i.* FROM pf700_cash_intents i LEFT JOIN pf700_cash_intent_results r ON r.intent_id=i.id WHERE r.intent_id IS NULL;
    CREATE TRIGGER pf700_cash_intent_guard BEFORE INSERT ON pf700_cash_intents
    WHEN EXISTS(SELECT 1 FROM pf700_cash_open_intents WHERE bill_id=NEW.bill_id)
      OR NOT EXISTS(SELECT 1 FROM bills b JOIN orders o ON o.id=b.order_id
        WHERE b.id=NEW.bill_id AND o.status='open' AND o.retired_empty=0 AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.bill_id=b.id))
      OR EXISTS(SELECT 1 FROM simulated_card_open_intents WHERE bill_id=NEW.bill_id)
      OR EXISTS(SELECT 1 FROM simulated_card_approvals WHERE bill_id=NEW.bill_id)
      OR EXISTS(SELECT 1 FROM simulated_cash_open_intents WHERE bill_id=NEW.bill_id)
      OR EXISTS(SELECT 1 FROM fiscal_daily_current d LEFT JOIN fiscal_daily_confirmations c USING(day_id) WHERE c.day_id IS NULL)
      OR EXISTS(SELECT 1 FROM pf700_cash_intents WHERE id=NEW.id)
    BEGIN SELECT RAISE(ABORT,'Invalid PF700 cash intent'); END;
    CREATE TABLE pf700_cash_dispatches (
      attempt_id INTEGER PRIMARY KEY REFERENCES fiscal_checkout_attempts(id),
      intent_id INTEGER NOT NULL REFERENCES pf700_cash_intents(id),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TRIGGER pf700_cash_dispatch_guard BEFORE INSERT ON pf700_cash_dispatches
    WHEN NOT EXISTS(SELECT 1 FROM pf700_cash_open_intents i JOIN fiscal_checkout_attempts a ON a.bill_id=i.bill_id
      JOIN fiscal_checkout_sales s ON s.bill_id=i.bill_id WHERE i.id=NEW.intent_id AND a.id=NEW.attempt_id
      AND s.mode='device' AND s.method='cash' AND s.device_id=i.device_id AND s.receipt=i.receipt)
      OR EXISTS(SELECT 1 FROM pf700_cash_dispatches WHERE attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'Invalid PF700 cash dispatch'); END;
    CREATE TRIGGER pf700_cash_result_guard BEFORE INSERT ON pf700_cash_intent_results
    WHEN NOT EXISTS(SELECT 1 FROM pf700_cash_open_intents i WHERE i.id=NEW.intent_id)
      OR (NEW.status='released' AND EXISTS(SELECT 1 FROM pf700_cash_dispatches d
        LEFT JOIN fiscal_checkout_verified_results r ON r.attempt_id=d.attempt_id
        WHERE d.intent_id=NEW.intent_id AND (r.status IS NULL OR r.status!='failed')))
      OR (NEW.status='paid' AND NOT EXISTS(SELECT 1 FROM pf700_cash_intents i JOIN payments p ON p.bill_id=i.bill_id
        WHERE i.id=NEW.intent_id AND p.method='cash' AND p.account='A'))
    BEGIN SELECT RAISE(ABORT,'Invalid PF700 cash result'); END;
    CREATE TRIGGER pf700_cash_payment_guard BEFORE INSERT ON payments
    WHEN EXISTS(SELECT 1 FROM pf700_cash_open_intents WHERE bill_id=NEW.bill_id)
      AND (NEW.method!='cash' OR NEW.account!='A' OR NOT EXISTS(SELECT 1 FROM pf700_cash_open_intents i
        JOIN pf700_cash_dispatches d ON d.intent_id=i.id JOIN fiscal_checkout_verified_results r ON r.attempt_id=d.attempt_id
        WHERE i.bill_id=NEW.bill_id AND r.status='accepted'))
    BEGIN SELECT RAISE(ABORT,'Unresolved PF700 cash intent'); END;
    CREATE TRIGGER pf700_cash_sale_guard BEFORE INSERT ON fiscal_checkout_sales
    WHEN EXISTS(SELECT 1 FROM pf700_cash_open_intents WHERE bill_id=NEW.bill_id)
      AND NOT EXISTS(SELECT 1 FROM pf700_cash_open_intents i WHERE i.bill_id=NEW.bill_id
        AND NEW.mode='device' AND NEW.method='cash' AND NEW.device_id=i.device_id AND NEW.receipt=i.receipt)
    BEGIN SELECT RAISE(ABORT,'Unresolved PF700 cash intent'); END;
    CREATE TRIGGER pf700_cash_card_guard BEFORE INSERT ON simulated_card_intents
      WHEN EXISTS(SELECT 1 FROM pf700_cash_open_intents WHERE bill_id=NEW.bill_id)
      BEGIN SELECT RAISE(ABORT,'Unresolved PF700 cash intent'); END;
    CREATE TRIGGER pf700_cash_sample_guard BEFORE INSERT ON simulated_cash_intents
      WHEN EXISTS(SELECT 1 FROM pf700_cash_open_intents WHERE bill_id=NEW.bill_id)
      BEGIN SELECT RAISE(ABORT,'Unresolved PF700 cash intent'); END;
    CREATE TRIGGER pf700_cash_order_guard BEFORE UPDATE OF status,retired_empty ON orders
    WHEN EXISTS(SELECT 1 FROM bills b JOIN pf700_cash_open_intents i ON i.bill_id=b.id WHERE b.order_id=OLD.id)
      AND (NEW.status!=OLD.status OR NEW.retired_empty!=OLD.retired_empty)
    BEGIN SELECT RAISE(ABORT,'Unresolved PF700 cash intent'); END;
    CREATE TRIGGER pf700_cash_shift_guard BEFORE INSERT ON shift_closes
      WHEN EXISTS(SELECT 1 FROM pf700_cash_open_intents) BEGIN SELECT RAISE(ABORT,'Resolve current checkout before closing'); END;
    CREATE TRIGGER pf700_cash_day_guard BEFORE UPDATE OF closed_at ON business_days
      WHEN NEW.closed_at IS NOT NULL AND EXISTS(SELECT 1 FROM pf700_cash_open_intents) BEGIN SELECT RAISE(ABORT,'Resolve current checkout before closing'); END;
    CREATE TRIGGER pf700_cash_account_a_guard BEFORE INSERT ON account_a_closes
      WHEN EXISTS(SELECT 1 FROM pf700_cash_open_intents) BEGIN SELECT RAISE(ABORT,'Resolve current checkout before closing'); END;
    CREATE TRIGGER pf700_cash_daily_guard BEFORE INSERT ON fiscal_daily_reports
      WHEN EXISTS(SELECT 1 FROM pf700_cash_open_intents) BEGIN SELECT RAISE(ABORT,'Resolve current checkout before closing'); END;
    CREATE TABLE pf700_command_intents (
      id INTEGER PRIMARY KEY,
      attempt_id INTEGER NOT NULL REFERENCES fiscal_checkout_attempts(id),
      sequence INTEGER NOT NULL CHECK(sequence BETWEEN 32 AND 127),
      command INTEGER NOT NULL CHECK(command IN (48,49,51,53,56,74,76,90,97,103,113)),
      request_hash TEXT CHECK(request_hash IS NULL OR (length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*')),
      created_at INTEGER NOT NULL,
      CHECK((command=48 AND request_hash IS NULL) OR (command!=48 AND request_hash IS NOT NULL))
    ) STRICT;
    CREATE TABLE pf700_command_acks (
      command_id INTEGER PRIMARY KEY REFERENCES pf700_command_intents(id),
      response_hash TEXT NOT NULL CHECK(length(response_hash)=64 AND response_hash NOT GLOB '*[^0-9a-f]*'),
      summary TEXT NOT NULL CHECK(json_valid(summary) AND json_type(summary)='object'),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE pf700_command_seals (
      attempt_id INTEGER PRIMARY KEY REFERENCES fiscal_checkout_attempts(id),
      actor_id INTEGER NOT NULL REFERENCES local_users(id),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TRIGGER pf700_command_seal_guard BEFORE INSERT ON pf700_command_seals
    WHEN NOT EXISTS(SELECT 1 FROM pf700_cash_dispatches d JOIN fiscal_checkout_attempts t ON t.id=d.attempt_id
        JOIN pf700_cash_open_intents i ON i.id=d.intent_id WHERE d.attempt_id=NEW.attempt_id
        AND NOT EXISTS(SELECT 1 FROM fiscal_checkout_results r WHERE r.attempt_id=t.id))
      OR NOT EXISTS(SELECT 1 FROM pf700_command_intents WHERE attempt_id=NEW.attempt_id)
      OR EXISTS(SELECT 1 FROM pf700_command_intents c LEFT JOIN pf700_command_acks a ON a.command_id=c.id
        WHERE c.attempt_id=NEW.attempt_id AND a.command_id IS NULL)
    BEGIN SELECT RAISE(ABORT,'PF700 command evidence incomplete'); END;
    CREATE TRIGGER pf700_command_intent_guard BEFORE INSERT ON pf700_command_intents
    WHEN NOT EXISTS(SELECT 1 FROM fiscal_checkout_attempts a JOIN fiscal_checkout_sales s ON s.bill_id=a.bill_id
      JOIN pf700_cash_dispatches d ON d.attempt_id=a.id
      WHERE a.id=NEW.attempt_id AND s.mode='device' AND s.method='cash'
      AND NOT EXISTS(SELECT 1 FROM fiscal_checkout_results r WHERE r.attempt_id=a.id))
      OR EXISTS(SELECT 1 FROM pf700_command_seals WHERE attempt_id=NEW.attempt_id)
      OR EXISTS(SELECT 1 FROM pf700_command_intents c LEFT JOIN pf700_command_acks a ON a.command_id=c.id
        WHERE c.attempt_id=NEW.attempt_id AND a.command_id IS NULL)
    BEGIN SELECT RAISE(ABORT,'Invalid PF700 command intent'); END;
  `);
  for (const [table, key] of [['pf700_cash_intents','id'], ['pf700_cash_intent_results','intent_id'], ['pf700_cash_dispatches','attempt_id'], ['pf700_command_intents','id'], ['pf700_command_acks','command_id'], ['pf700_command_seals','attempt_id']]) {
    db.exec(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'PF700 recovery history is retained'); END;
      CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'PF700 recovery history is retained'); END;
      CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${key}=NEW.${key})
      BEGIN SELECT RAISE(ABORT,'PF700 recovery history is retained'); END;`);
  }
}
module.exports = { migratePf700Recovery };
