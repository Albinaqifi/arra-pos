// A reservation and the exact device baseline are committed together BEFORE
// the first Z write. A missing confirmation never authorizes another write.
function createFiscalDailySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fiscal_daily_reports (
      id INTEGER PRIMARY KEY,
      day_id INTEGER NOT NULL REFERENCES business_days(id),
      actor_id INTEGER NOT NULL REFERENCES local_users(id),
      mode TEXT NOT NULL CHECK(mode IN ('device','simulation')),
      device_id TEXT NOT NULL,
      expected TEXT NOT NULL CHECK(json_valid(expected)),
      previous_closure INTEGER NOT NULL CHECK(previous_closure BETWEEN 0 AND 9998),
      previous_document TEXT NOT NULL CHECK(length(previous_document)=7 AND previous_document NOT GLOB '*[^0-9]*' AND previous_document<'9999999'),
      device_date TEXT NOT NULL CHECK(length(device_date)=6 AND device_date NOT GLOB '*[^0-9]*'),
      started_at INTEGER NOT NULL,
      CHECK((mode='simulation' AND device_id='') OR (mode='device' AND length(device_id) BETWEEN 1 AND 80))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS fiscal_daily_day ON fiscal_daily_reports(day_id);
    CREATE TABLE IF NOT EXISTS fiscal_daily_nonissuances (
      attempt_id INTEGER PRIMARY KEY REFERENCES fiscal_daily_reports(id),
      actor_id INTEGER NOT NULL REFERENCES local_users(id),
      verified_at INTEGER NOT NULL
    ) STRICT;
    CREATE VIEW IF NOT EXISTS fiscal_daily_current AS
      SELECT d.* FROM fiscal_daily_reports d WHERE NOT EXISTS
        (SELECT 1 FROM fiscal_daily_nonissuances n WHERE n.attempt_id=d.id);
    CREATE TABLE IF NOT EXISTS fiscal_daily_confirmations (
      day_id INTEGER PRIMARY KEY REFERENCES business_days(id),
      close_id INTEGER NOT NULL UNIQUE REFERENCES account_a_closes(id),
      actor_id INTEGER NOT NULL REFERENCES local_users(id),
      report_number TEXT NOT NULL,
      document_number TEXT NOT NULL,
      confirmed_at INTEGER NOT NULL
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS fiscal_daily_confirmation_guard BEFORE INSERT ON fiscal_daily_confirmations
    WHEN NOT EXISTS (SELECT 1 FROM fiscal_daily_current d JOIN account_a_closes c ON c.day_id=d.day_id
      WHERE d.day_id=NEW.day_id AND c.id=NEW.close_id
        AND NEW.report_number=printf('%04d',d.previous_closure+1)
        AND NEW.document_number=printf('%07d',CAST(d.previous_document AS INTEGER)+1))
    BEGIN SELECT RAISE(ABORT,'Unverified daily report'); END;
    CREATE TRIGGER IF NOT EXISTS fiscal_daily_reserve_guard BEFORE INSERT ON fiscal_daily_reports
    WHEN EXISTS (SELECT 1 FROM fiscal_daily_current d LEFT JOIN fiscal_daily_confirmations c USING(day_id)
      WHERE c.day_id IS NULL OR d.day_id=NEW.day_id OR (d.mode=NEW.mode AND d.device_id=NEW.device_id
        AND (d.previous_closure=NEW.previous_closure OR d.previous_document=NEW.previous_document)))
    BEGIN SELECT RAISE(ABORT,'Fiscal period already reserved'); END;
    CREATE TRIGGER IF NOT EXISTS fiscal_daily_nonissuance_guard BEFORE INSERT ON fiscal_daily_nonissuances
    WHEN NOT EXISTS (SELECT 1 FROM fiscal_daily_current d LEFT JOIN fiscal_daily_confirmations c USING(day_id)
      WHERE d.id=NEW.attempt_id AND c.day_id IS NULL)
    BEGIN SELECT RAISE(ABORT,'Report attempt already resolved'); END;
    CREATE TRIGGER IF NOT EXISTS fiscal_daily_checkout_guard BEFORE INSERT ON fiscal_checkout_attempts
    WHEN EXISTS (SELECT 1 FROM fiscal_daily_current d LEFT JOIN fiscal_daily_confirmations c USING(day_id)
      WHERE c.day_id IS NULL)
    BEGIN SELECT RAISE(ABORT,'Resolve the outstanding daily report'); END;
  `);
  for (const [table, conflict] of [
    ['fiscal_daily_reports','id=NEW.id'],
    ['fiscal_daily_confirmations','day_id=NEW.day_id OR close_id=NEW.close_id'],
    ['fiscal_daily_nonissuances','attempt_id=NEW.attempt_id']
  ]) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table}
      BEGIN SELECT RAISE(ABORT,'Daily report history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table}
      BEGIN SELECT RAISE(ABORT,'Daily report history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS ${table}_no_replace BEFORE INSERT ON ${table}
      WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${conflict})
      BEGIN SELECT RAISE(ABORT,'Daily report history is immutable'); END;`);
  }
}
module.exports = { createFiscalDailySchema };
