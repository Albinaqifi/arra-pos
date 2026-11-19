// All journal rows are append-only. A reserved attempt with no result survives a
// crash as an unknown device outcome, even if the application never sent it.
function createFiscalCheckoutSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fiscal_checkout_sales (
      bill_id INTEGER PRIMARY KEY REFERENCES bills(id),
      actor_id INTEGER NOT NULL REFERENCES local_users(id),
      mode TEXT NOT NULL CHECK(mode IN ('simulation','device')),
      device_id TEXT,
      method TEXT NOT NULL CHECK(method IN ('cash','card')),
      receipt TEXT NOT NULL CHECK(json_valid(receipt)),
      created_at INTEGER NOT NULL,
      CHECK((mode='simulation' AND device_id IS NULL) OR (mode='device' AND length(device_id) BETWEEN 1 AND 80 AND device_id IS NOT NULL))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS fiscal_checkout_attempts (
      id INTEGER PRIMARY KEY,
      bill_id INTEGER NOT NULL REFERENCES fiscal_checkout_sales(bill_id),
      started_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS fiscal_checkout_bill_attempts ON fiscal_checkout_attempts(bill_id,id);
    CREATE TABLE IF NOT EXISTS fiscal_checkout_baselines (
      attempt_id INTEGER PRIMARY KEY REFERENCES fiscal_checkout_attempts(id),
      device_id TEXT NOT NULL,
      previous_document TEXT NOT NULL CHECK(length(previous_document)=7 AND previous_document NOT GLOB '*[^0-9]*' AND previous_document<'9999999')
    ) STRICT;
    CREATE TABLE IF NOT EXISTS fiscal_checkout_results (
      attempt_id INTEGER PRIMARY KEY REFERENCES fiscal_checkout_attempts(id),
      status TEXT NOT NULL CHECK(status IN ('accepted','failed')),
      source TEXT NOT NULL,
      reference TEXT,
      evidence TEXT CHECK(evidence IS NULL OR json_valid(evidence)),
      ended_at INTEGER NOT NULL,
      UNIQUE(source,reference),
      CHECK((status='accepted' AND reference IS NOT NULL) OR (status='failed' AND reference IS NULL AND evidence IS NULL))
    ) STRICT;
    CREATE VIEW IF NOT EXISTS fiscal_checkout_verified_results AS
      SELECT r.* FROM fiscal_checkout_results r
      JOIN fiscal_checkout_attempts a ON a.id=r.attempt_id JOIN fiscal_checkout_sales s ON s.bill_id=a.bill_id
      LEFT JOIN fiscal_checkout_baselines b ON b.attempt_id=a.id AND b.device_id=s.device_id
      WHERE r.source=CASE s.mode WHEN 'simulation' THEN 'simulation' WHEN 'device' THEN 'device-' || s.device_id END
      AND ((r.status='failed' AND r.reference IS NULL AND r.evidence IS NULL AND b.attempt_id IS NULL)
        OR (r.status='accepted' AND
          ((s.mode='simulation' AND r.reference='SIM-' || s.bill_id AND r.evidence IS NULL)
           OR (s.mode='device' AND json_type(s.receipt,'$.domesticProduct') IN ('true','false')
             AND length(b.previous_document)=7 AND b.previous_document NOT GLOB '*[^0-9]*'
             AND b.previous_document<'9999999' AND r.reference=printf('%07d',CAST(b.previous_document AS INTEGER)+1)
             AND CASE WHEN json_valid(r.evidence) THEN (
               json_type(r.evidence)='object' AND json_type(r.evidence,'$.documentNumber')='text'
               AND json_extract(r.evidence,'$.documentNumber')=r.reference
               AND json_type(r.evidence,'$.fiscalReceiptCount')='integer'
               AND json_extract(r.evidence,'$.fiscalReceiptCount') BETWEEN 1 AND 9999
               AND json_type(r.evidence,'$.reversalCount')='integer'
               AND json_extract(r.evidence,'$.reversalCount') BETWEEN 0 AND 9999
             ) ELSE 0 END))));
    CREATE TRIGGER IF NOT EXISTS fiscal_checkout_baseline_guard BEFORE INSERT ON fiscal_checkout_baselines
    WHEN NOT EXISTS (SELECT 1 FROM fiscal_checkout_attempts a JOIN fiscal_checkout_sales s ON s.bill_id=a.bill_id
      WHERE a.id=NEW.attempt_id AND s.mode='device' AND s.device_id=NEW.device_id)
      OR EXISTS (SELECT 1 FROM fiscal_checkout_results WHERE attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'Invalid fiscal checkout baseline'); END;
    CREATE TRIGGER IF NOT EXISTS fiscal_checkout_result_guard AFTER INSERT ON fiscal_checkout_results
    WHEN NOT EXISTS (SELECT 1 FROM fiscal_checkout_verified_results WHERE attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'Unverified fiscal checkout outcome'); END;
    CREATE TRIGGER IF NOT EXISTS fiscal_checkout_payment_guard BEFORE INSERT ON payments
    WHEN EXISTS (SELECT 1 FROM fiscal_checkout_sales WHERE bill_id=NEW.bill_id)
      AND NOT EXISTS (SELECT 1 FROM fiscal_checkout_sales s
        JOIN fiscal_checkout_attempts a ON a.bill_id=s.bill_id
        JOIN fiscal_checkout_verified_results r ON r.attempt_id=a.id
        WHERE s.bill_id=NEW.bill_id AND s.method=NEW.method AND NEW.account='A' AND r.status='accepted')
    BEGIN SELECT RAISE(ABORT,'Unresolved fiscal checkout'); END;
    CREATE TRIGGER IF NOT EXISTS fiscal_checkout_attempt_guard BEFORE INSERT ON fiscal_checkout_attempts
    WHEN EXISTS (SELECT 1 FROM fiscal_checkout_attempts a LEFT JOIN fiscal_checkout_verified_results r ON r.attempt_id=a.id
      WHERE r.status IS NULL OR (a.bill_id=NEW.bill_id AND r.status='accepted'))
    BEGIN SELECT RAISE(ABORT,'Fiscal checkout already reserved'); END;
    CREATE VIEW IF NOT EXISTS fiscal_checkout_open_device_sales AS
      SELECT a.bill_id FROM fiscal_checkout_attempts a JOIN fiscal_checkout_sales s ON s.bill_id=a.bill_id
      LEFT JOIN fiscal_checkout_verified_results r ON r.attempt_id=a.id
      WHERE s.mode='device' AND (r.status IS NULL OR r.status='accepted')
        AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.bill_id=a.bill_id);
    CREATE TRIGGER IF NOT EXISTS fiscal_checkout_shift_guard BEFORE INSERT ON shift_closes
      WHEN EXISTS(SELECT 1 FROM fiscal_checkout_open_device_sales)
      BEGIN SELECT RAISE(ABORT,'Resolve current checkout before closing'); END;
    CREATE TRIGGER IF NOT EXISTS fiscal_checkout_day_guard BEFORE UPDATE OF closed_at ON business_days
      WHEN NEW.closed_at IS NOT NULL AND EXISTS(SELECT 1 FROM fiscal_checkout_open_device_sales)
      BEGIN SELECT RAISE(ABORT,'Resolve current checkout before closing'); END;
  `);
  for (const [table, primaryKey] of [
    ['fiscal_checkout_sales', 'bill_id'], ['fiscal_checkout_attempts', 'id'], ['fiscal_checkout_baselines', 'attempt_id'],
    ['fiscal_checkout_results', 'attempt_id']
  ]) {
    const conflict = table === 'fiscal_checkout_results' ? ' OR (source=NEW.source AND reference=NEW.reference)' : '';
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table}
      BEGIN SELECT RAISE(ABORT,'Fiscal checkout history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table}
      BEGIN SELECT RAISE(ABORT,'Fiscal checkout history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS ${table}_no_replace BEFORE INSERT ON ${table}
      WHEN EXISTS (SELECT 1 FROM ${table} WHERE ${primaryKey}=NEW.${primaryKey}${conflict})
      BEGIN SELECT RAISE(ABORT,'Fiscal checkout history is immutable'); END;`);
  }
}

module.exports = { createFiscalCheckoutSchema };
