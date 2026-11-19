const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { untouchedOrder } = require('./untouched-order');

// Once released, migrations are historical records: append new versions instead
// of changing these statements. Each version and its schema changes commit together.
const migrations = [
  {
    version: 1,
    sql: `CREATE TABLE app_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    ) STRICT;`,
  },
  {
    version: 2,
    sql: 'ALTER TABLE app_metadata ADD COLUMN updated_at TEXT;',
  },
  {
    version: 3,
    sql: `CREATE TABLE dining_tables (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id > 0),
      area TEXT NOT NULL CHECK (length(trim(area)) > 0)
    ) STRICT;`,
  },
  {
    version: 4,
    sql: `CREATE TABLE menu_categories (
      id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      active INTEGER NOT NULL CHECK (active IN (0, 1))
    ) STRICT;
    CREATE TABLE menu_products (
      id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
      category_id TEXT NOT NULL REFERENCES menu_categories(id),
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      price INTEGER NOT NULL CHECK (price >= 0 AND price <= 9007199254740991),
      active INTEGER NOT NULL CHECK (active IN (0, 1))
    ) STRICT;`,
  },
  {
    version: 5,
    sql: `CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      table_id INTEGER NOT NULL REFERENCES dining_tables(id),
      opened_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'completed'))
    ) STRICT;
    CREATE UNIQUE INDEX one_open_order_per_table ON orders(table_id) WHERE status = 'open';`,
  },
  {
    version: 6,
    sql: `CREATE TABLE order_items (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      product_id TEXT NOT NULL REFERENCES menu_products(id),
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      unit_price INTEGER NOT NULL CHECK (unit_price >= 0 AND unit_price <= 9007199254740991),
      quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 9007199254740991),
      status TEXT NOT NULL CHECK (status IN ('pending', 'sent'))
    ) STRICT;`,
  },
  {
    version: 7,
    sql: "ALTER TABLE order_items ADD COLUMN note TEXT NOT NULL DEFAULT '';",
  },
  {
    version: 8,
    sql: `CREATE TABLE local_users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE CHECK (length(trim(username)) > 0),
      salt BLOB NOT NULL,
      password_hash BLOB NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
    ) STRICT;`,
  },
  {
    version: 9,
    sql: `CREATE TABLE user_permissions (
      user_id INTEGER NOT NULL REFERENCES local_users(id),
      permission TEXT NOT NULL CHECK (permission IN ('tables.view', 'menu.view', 'orders.view', 'orders.change')),
      PRIMARY KEY (user_id, permission)
    ) STRICT;
    INSERT INTO user_permissions (user_id, permission)
    SELECT id, permission FROM local_users CROSS JOIN (
      SELECT 'tables.view' AS permission UNION ALL SELECT 'menu.view'
      UNION ALL SELECT 'orders.view' UNION ALL SELECT 'orders.change'
    ) WHERE id = (SELECT min(id) FROM local_users);`,
  },
  {
    version: 10,
    sql: `ALTER TABLE local_users ADD COLUMN pin_salt BLOB;
    ALTER TABLE local_users ADD COLUMN pin_hash BLOB;`,
  },
  {
    version: 11,
    sql: `CREATE TABLE dining_areas (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) > 0), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1))) STRICT;
    INSERT INTO dining_areas (name) SELECT DISTINCT area FROM dining_tables;
    ALTER TABLE dining_tables ADD COLUMN area_id INTEGER REFERENCES dining_areas(id);
    ALTER TABLE dining_tables ADD COLUMN capacity INTEGER NOT NULL DEFAULT 4 CHECK(capacity > 0 AND capacity <= 1000);
    ALTER TABLE dining_tables ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1));
    UPDATE dining_tables SET area_id = (SELECT id FROM dining_areas WHERE name = dining_tables.area);
    CREATE TABLE new_user_permissions (user_id INTEGER NOT NULL REFERENCES local_users(id), permission TEXT NOT NULL CHECK(permission IN ('tables.view', 'tables.change', 'menu.view', 'orders.view', 'orders.change')), PRIMARY KEY(user_id, permission)) STRICT;
    INSERT INTO new_user_permissions SELECT * FROM user_permissions;
    DROP TABLE user_permissions;
    ALTER TABLE new_user_permissions RENAME TO user_permissions;
    INSERT INTO user_permissions SELECT min(id), 'tables.change' FROM local_users HAVING count(*) > 0;`,
  },
  {
    version: 12,
    sql: `ALTER TABLE menu_categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0);
    UPDATE menu_categories SET sort_order = rowid;
    ALTER TABLE menu_categories ADD COLUMN parent_id TEXT REFERENCES menu_categories(id);
    ALTER TABLE menu_products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0);
    UPDATE menu_products SET sort_order = rowid;
    CREATE TABLE new_user_permissions (user_id INTEGER NOT NULL REFERENCES local_users(id), permission TEXT NOT NULL CHECK(permission IN ('tables.view', 'tables.change', 'menu.view', 'menu.change', 'orders.view', 'orders.change')), PRIMARY KEY(user_id, permission)) STRICT;
    INSERT INTO new_user_permissions SELECT * FROM user_permissions;
    DROP TABLE user_permissions;
    ALTER TABLE new_user_permissions RENAME TO user_permissions;
    INSERT INTO user_permissions SELECT min(id), 'menu.change' FROM local_users HAVING count(*) > 0;`,
  },
  { version: 13, sql: `CREATE TABLE modifier_groups (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES menu_products(id), name TEXT NOT NULL, required INTEGER NOT NULL CHECK(required IN (0,1)), active INTEGER NOT NULL CHECK(active IN (0,1))) STRICT;
    CREATE TABLE modifier_options (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES modifier_groups(id), name TEXT NOT NULL, adjustment INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1))) STRICT;
    CREATE TABLE order_item_modifiers (item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE, group_name TEXT NOT NULL, option_name TEXT NOT NULL, adjustment INTEGER NOT NULL) STRICT;` },
  { version: 14, sql: `CREATE TABLE new_user_permissions (user_id INTEGER NOT NULL REFERENCES local_users(id), permission TEXT NOT NULL CHECK(permission IN ('tables.view', 'tables.change', 'menu.view', 'menu.change', 'orders.view', 'orders.change', 'employees.view', 'employees.change')), PRIMARY KEY(user_id, permission)) STRICT;
    INSERT INTO new_user_permissions SELECT * FROM user_permissions;
    DROP TABLE user_permissions;
    ALTER TABLE new_user_permissions RENAME TO user_permissions;
    INSERT INTO user_permissions SELECT min(id), 'employees.view' FROM local_users HAVING count(*) > 0;
    INSERT INTO user_permissions SELECT min(id), 'employees.change' FROM local_users HAVING count(*) > 0;
    CREATE TABLE employee_permission_audit (id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES local_users(id), target_id INTEGER NOT NULL REFERENCES local_users(id), permission TEXT NOT NULL, granted INTEGER NOT NULL CHECK(granted IN (0,1)), occurred_at INTEGER NOT NULL) STRICT;
    CREATE TABLE employee_account_audit (id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES local_users(id), target_id INTEGER NOT NULL REFERENCES local_users(id), old_username TEXT NOT NULL, new_username TEXT NOT NULL, old_active INTEGER NOT NULL, new_active INTEGER NOT NULL, occurred_at INTEGER NOT NULL) STRICT;
    CREATE TRIGGER employee_account_audit_no_update BEFORE UPDATE ON employee_account_audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
    CREATE TRIGGER employee_account_audit_no_delete BEFORE DELETE ON employee_account_audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
    CREATE TABLE employee_credential_audit (id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES local_users(id), target_id INTEGER NOT NULL REFERENCES local_users(id), password_changed INTEGER NOT NULL CHECK(password_changed IN (0,1)), pin_changed INTEGER NOT NULL CHECK(pin_changed IN (0,1)), occurred_at INTEGER NOT NULL) STRICT;
    CREATE TRIGGER employee_credential_audit_no_update BEFORE UPDATE ON employee_credential_audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
    CREATE TRIGGER employee_credential_audit_no_delete BEFORE DELETE ON employee_credential_audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
    CREATE TRIGGER employee_audit_no_update BEFORE UPDATE ON employee_permission_audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
    CREATE TRIGGER employee_audit_no_delete BEFORE DELETE ON employee_permission_audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;` },
  { version: 15, sql: `CREATE TABLE application_audit (
    id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES local_users(id), occurred_at INTEGER NOT NULL,
    action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
    order_id INTEGER REFERENCES orders(id), context TEXT NOT NULL
  ) STRICT;
  CREATE TRIGGER application_audit_no_update BEFORE UPDATE ON application_audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
  CREATE TRIGGER application_audit_no_delete BEFORE DELETE ON application_audit BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
  CREATE TRIGGER application_audit_no_replace BEFORE INSERT ON application_audit WHEN EXISTS (SELECT 1 FROM application_audit WHERE id = NEW.id) BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
  CREATE TRIGGER employee_permission_audit_no_replace BEFORE INSERT ON employee_permission_audit WHEN EXISTS (SELECT 1 FROM employee_permission_audit WHERE id = NEW.id) BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
  CREATE TRIGGER employee_account_audit_no_replace BEFORE INSERT ON employee_account_audit WHEN EXISTS (SELECT 1 FROM employee_account_audit WHERE id = NEW.id) BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
  CREATE TRIGGER employee_credential_audit_no_replace BEFORE INSERT ON employee_credential_audit WHEN EXISTS (SELECT 1 FROM employee_credential_audit WHERE id = NEW.id) BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;` },
  { version: 16, sql: `ALTER TABLE menu_products ADD COLUMN destination TEXT NOT NULL DEFAULT 'kitchen' CHECK(destination IN ('kitchen', 'bar'));
    CREATE TABLE preparation_rounds (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), request_id TEXT NOT NULL UNIQUE, number INTEGER NOT NULL, actor_id INTEGER NOT NULL REFERENCES local_users(id), sent_at INTEGER NOT NULL, UNIQUE(order_id, number)) STRICT;
    CREATE TABLE preparation_tickets (id INTEGER PRIMARY KEY, round_id INTEGER NOT NULL REFERENCES preparation_rounds(id), destination TEXT NOT NULL CHECK(destination IN ('kitchen','bar')), adapter TEXT NOT NULL CHECK(adapter = 'simulated'), UNIQUE(round_id, destination)) STRICT;
    CREATE TABLE preparation_ticket_items (ticket_id INTEGER NOT NULL REFERENCES preparation_tickets(id), item_id INTEGER NOT NULL UNIQUE REFERENCES order_items(id), quantity INTEGER NOT NULL CHECK(quantity > 0), PRIMARY KEY(ticket_id, item_id)) STRICT;` },
  { version: 17, sql: `CREATE TABLE simulated_printers (destination TEXT PRIMARY KEY CHECK(destination IN ('kitchen','bar')), result TEXT NOT NULL CHECK(result IN ('success','failed','uncertain'))) STRICT;
    INSERT INTO simulated_printers VALUES ('kitchen','success'),('bar','success');
    CREATE TABLE print_jobs (id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL UNIQUE REFERENCES preparation_tickets(id), created_at INTEGER NOT NULL) STRICT;
    CREATE TABLE print_attempts (id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES print_jobs(id), request_id TEXT NOT NULL UNIQUE, actor_id INTEGER REFERENCES local_users(id), occurred_at INTEGER NOT NULL, result TEXT NOT NULL CHECK(result IN ('success','failed','uncertain'))) STRICT;
    INSERT INTO print_jobs (ticket_id, created_at) SELECT t.id, r.sent_at FROM preparation_tickets t JOIN preparation_rounds r ON r.id=t.round_id;
    INSERT INTO print_attempts (job_id, request_id, actor_id, occurred_at, result) SELECT j.id, 'legacy-' || j.id, NULL, j.created_at, 'uncertain' FROM print_jobs j;
    CREATE TRIGGER print_attempts_no_update BEFORE UPDATE ON print_attempts BEGIN SELECT RAISE(ABORT, 'Attempts are append-only'); END;
    CREATE TRIGGER print_attempts_no_delete BEFORE DELETE ON print_attempts BEGIN SELECT RAISE(ABORT, 'Attempts are append-only'); END;` },
  { version: 18, sql: `ALTER TABLE preparation_rounds ADD COLUMN table_id INTEGER REFERENCES dining_tables(id);
    UPDATE preparation_rounds SET table_id = (SELECT table_id FROM orders WHERE id = preparation_rounds.order_id);` },
  { version: 19, sql: `CREATE TABLE new_user_permissions (user_id INTEGER NOT NULL REFERENCES local_users(id), permission TEXT NOT NULL CHECK(permission IN ('tables.view', 'tables.change', 'menu.view', 'menu.change', 'orders.view', 'orders.change', 'employees.view', 'employees.change', 'orders.correct_sent')), PRIMARY KEY(user_id, permission)) STRICT;
    INSERT INTO new_user_permissions SELECT * FROM user_permissions;
    DROP TABLE user_permissions;
    ALTER TABLE new_user_permissions RENAME TO user_permissions;
    INSERT INTO user_permissions SELECT u.id, 'orders.correct_sent' FROM local_users u
      WHERE u.active = 1 AND EXISTS (SELECT 1 FROM user_permissions p WHERE p.user_id = u.id AND p.permission = 'employees.change');
    CREATE TABLE sent_item_corrections (id INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, item_id INTEGER NOT NULL REFERENCES order_items(id), order_id INTEGER NOT NULL REFERENCES orders(id), actor_id INTEGER NOT NULL REFERENCES local_users(id), quantity INTEGER NOT NULL CHECK(quantity > 0), reason TEXT NOT NULL CHECK(length(trim(reason)) > 0), occurred_at INTEGER NOT NULL) STRICT;
    CREATE TRIGGER sent_item_corrections_no_update BEFORE UPDATE ON sent_item_corrections BEGIN SELECT RAISE(ABORT, 'Corrections are append-only'); END;
    CREATE TRIGGER sent_item_corrections_no_delete BEFORE DELETE ON sent_item_corrections BEGIN SELECT RAISE(ABORT, 'Corrections are append-only'); END;
    CREATE TRIGGER sent_item_corrections_no_replace BEFORE INSERT ON sent_item_corrections WHEN EXISTS (SELECT 1 FROM sent_item_corrections WHERE id=NEW.id OR request_id=NEW.request_id) BEGIN SELECT RAISE(ABORT, 'Corrections are append-only'); END;` },
  { version: 20, sql: `CREATE TABLE bills (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id), actor_id INTEGER NOT NULL REFERENCES local_users(id), generated_at INTEGER NOT NULL, total INTEGER NOT NULL CHECK(total >= 0), fingerprint TEXT NOT NULL) STRICT;
    CREATE TABLE bill_lines (id INTEGER PRIMARY KEY, bill_id INTEGER NOT NULL REFERENCES bills(id), item_id INTEGER NOT NULL REFERENCES order_items(id), name TEXT NOT NULL, unit_price INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), modifiers TEXT NOT NULL, UNIQUE(bill_id, item_id)) STRICT;
    CREATE TRIGGER billed_item_insert BEFORE INSERT ON order_items WHEN EXISTS (SELECT 1 FROM bills WHERE order_id=NEW.order_id) BEGIN SELECT RAISE(ABORT, 'Order billed'); END;
    CREATE TRIGGER billed_item_update BEFORE UPDATE ON order_items WHEN EXISTS (SELECT 1 FROM bills WHERE order_id IN (OLD.order_id, NEW.order_id)) BEGIN SELECT RAISE(ABORT, 'Order billed'); END;
    CREATE TRIGGER billed_item_delete BEFORE DELETE ON order_items WHEN EXISTS (SELECT 1 FROM bills WHERE order_id=OLD.order_id) BEGIN SELECT RAISE(ABORT, 'Order billed'); END;
    CREATE TRIGGER billed_correction BEFORE INSERT ON sent_item_corrections WHEN EXISTS (SELECT 1 FROM bills WHERE order_id=NEW.order_id) BEGIN SELECT RAISE(ABORT, 'Order billed'); END;
    CREATE TRIGGER billed_order_move BEFORE UPDATE OF table_id ON orders WHEN EXISTS (SELECT 1 FROM bills WHERE order_id=OLD.id) BEGIN SELECT RAISE(ABORT, 'Order billed'); END;
    CREATE TRIGGER bills_no_update BEFORE UPDATE ON bills BEGIN SELECT RAISE(ABORT, 'Bills are immutable'); END;
    CREATE TRIGGER bills_no_delete BEFORE DELETE ON bills BEGIN SELECT RAISE(ABORT, 'Bills are immutable'); END;
    CREATE TRIGGER bill_lines_no_update BEFORE UPDATE ON bill_lines BEGIN SELECT RAISE(ABORT, 'Bill lines are immutable'); END;
    CREATE TRIGGER bill_lines_no_delete BEFORE DELETE ON bill_lines BEGIN SELECT RAISE(ABORT, 'Bill lines are immutable'); END;` },
  { version: 21, sql: `CREATE TABLE payments (
    id INTEGER PRIMARY KEY, bill_id INTEGER NOT NULL UNIQUE REFERENCES bills(id), actor_id INTEGER NOT NULL REFERENCES local_users(id),
    paid_at INTEGER NOT NULL, amount INTEGER NOT NULL CHECK(amount >= 0), method TEXT NOT NULL CHECK(method IN ('cash','card')),
    account TEXT NOT NULL CHECK(account IN ('A','B')), CHECK(method != 'card' OR account = 'A')
  ) STRICT;
  CREATE TRIGGER payments_full_amount BEFORE INSERT ON payments WHEN NOT EXISTS (SELECT 1 FROM bills b JOIN orders o ON o.id=b.order_id WHERE b.id=NEW.bill_id AND b.total=NEW.amount AND o.status='open') BEGIN SELECT RAISE(ABORT, 'Invalid payment'); END;
  CREATE TRIGGER payments_no_update BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT, 'Payments are immutable'); END;
  CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT, 'Payments are immutable'); END;
  CREATE TRIGGER payments_no_replace BEFORE INSERT ON payments WHEN EXISTS (SELECT 1 FROM payments WHERE id=NEW.id OR bill_id=NEW.bill_id) BEGIN SELECT RAISE(ABORT, 'Payments are immutable'); END;` },
  { version: 22, sql: `CREATE TABLE financial_scopes (
    user_id INTEGER PRIMARY KEY REFERENCES local_users(id),
    scope TEXT NOT NULL CHECK(scope IN ('A','B','combined','waiter'))
  ) STRICT;` },
  { version: 23, sql: `CREATE TABLE new_user_permissions (user_id INTEGER NOT NULL REFERENCES local_users(id), permission TEXT NOT NULL CHECK(permission IN ('tables.view', 'tables.change', 'menu.view', 'menu.change', 'orders.view', 'orders.change', 'employees.view', 'employees.change', 'orders.correct_sent', 'business_days.close')), PRIMARY KEY(user_id, permission)) STRICT;
  INSERT INTO new_user_permissions SELECT * FROM user_permissions;
  DROP TABLE user_permissions;
  ALTER TABLE new_user_permissions RENAME TO user_permissions;
  CREATE TABLE business_days (
    id INTEGER PRIMARY KEY, opened_at INTEGER NOT NULL, closed_at INTEGER, closed_by INTEGER REFERENCES local_users(id),
    issues TEXT, CHECK ((closed_at IS NULL AND closed_by IS NULL AND issues IS NULL) OR (closed_at IS NOT NULL AND closed_by IS NOT NULL AND issues IS NOT NULL))
  ) STRICT;
  CREATE UNIQUE INDEX one_open_business_day ON business_days((1)) WHERE closed_at IS NULL;
  INSERT INTO business_days(opened_at) SELECT COALESCE(min(paid_at), unixepoch()*1000) FROM payments;
  CREATE TABLE payment_business_days (payment_id INTEGER PRIMARY KEY REFERENCES payments(id), business_day_id INTEGER NOT NULL REFERENCES business_days(id)) STRICT;
  INSERT INTO payment_business_days SELECT id, (SELECT id FROM business_days WHERE closed_at IS NULL) FROM payments;
  CREATE TRIGGER payment_assign_business_day AFTER INSERT ON payments BEGIN
    INSERT INTO payment_business_days VALUES (NEW.id, (SELECT id FROM business_days WHERE closed_at IS NULL));
  END;
  CREATE TRIGGER payment_business_days_no_update BEFORE UPDATE ON payment_business_days BEGIN SELECT RAISE(ABORT, 'Payment day is immutable'); END;
  CREATE TRIGGER payment_business_days_no_delete BEFORE DELETE ON payment_business_days BEGIN SELECT RAISE(ABORT, 'Payment day is immutable'); END;
  CREATE TRIGGER closed_business_days_no_update BEFORE UPDATE ON business_days WHEN OLD.closed_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'Closed day is immutable'); END;
  CREATE TRIGGER business_days_no_delete BEFORE DELETE ON business_days BEGIN SELECT RAISE(ABORT, 'Business days are retained'); END;` },

  { version: 24, sql: `CREATE TABLE transfer_managers (user_id INTEGER PRIMARY KEY REFERENCES local_users(id)) STRICT;
  CREATE TABLE payment_account_corrections (id INTEGER PRIMARY KEY, payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id), actor_id INTEGER NOT NULL REFERENCES local_users(id), occurred_at INTEGER NOT NULL, reason TEXT NOT NULL) STRICT;
  CREATE TRIGGER payment_correction_validate BEFORE INSERT ON payment_account_corrections WHEN NOT EXISTS (SELECT 1 FROM payments p JOIN payment_business_days pd ON pd.payment_id=p.id JOIN business_days d ON d.id=pd.business_day_id WHERE p.id=NEW.payment_id AND p.method='cash' AND p.account='B' AND d.closed_at IS NULL) BEGIN SELECT RAISE(ABORT, 'Payment is not eligible'); END;
  CREATE TRIGGER payment_corrections_no_update BEFORE UPDATE ON payment_account_corrections BEGIN SELECT RAISE(ABORT, 'Corrections are immutable'); END;
  CREATE TRIGGER payment_corrections_no_delete BEFORE DELETE ON payment_account_corrections BEGIN SELECT RAISE(ABORT, 'Corrections are immutable'); END;
  CREATE TRIGGER payment_corrections_no_replace BEFORE INSERT ON payment_account_corrections WHEN EXISTS (SELECT 1 FROM payment_account_corrections WHERE id=NEW.id OR payment_id=NEW.payment_id) BEGIN SELECT RAISE(ABORT, 'Corrections are immutable'); END;` },
  { version: 25, sql: `ALTER TABLE orders ADD COLUMN retired_empty INTEGER NOT NULL DEFAULT 0 CHECK(retired_empty IN (0,1));
  DROP INDEX one_open_order_per_table;
  CREATE UNIQUE INDEX one_open_order_per_table ON orders(table_id) WHERE status = 'open' AND retired_empty = 0;` },
  { version: 26, sql: `CREATE TABLE test_printer_queues (destination TEXT PRIMARY KEY CHECK(destination IN ('kitchen','bar','bill')), queue TEXT NOT NULL CHECK(length(trim(queue)) BETWEEN 1 AND 255)) STRICT;
  INSERT INTO test_printer_queues VALUES ('kitchen','Arra Test Printer'),('bar','Arra Test Printer'),('bill','Arra Test Printer');
  CREATE TABLE test_print_jobs (id INTEGER PRIMARY KEY, destination TEXT NOT NULL CHECK(destination IN ('kitchen','bar','bill')), ticket_id INTEGER UNIQUE REFERENCES preparation_tickets(id), bill_id INTEGER UNIQUE REFERENCES bills(id), snapshot TEXT NOT NULL, created_at INTEGER NOT NULL, CHECK ((destination='bill' AND bill_id IS NOT NULL AND ticket_id IS NULL) OR (destination IN ('kitchen','bar') AND ticket_id IS NOT NULL AND bill_id IS NULL))) STRICT;
  CREATE TABLE test_print_attempts (id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES test_print_jobs(id), request_id TEXT NOT NULL UNIQUE, actor_id INTEGER NOT NULL REFERENCES local_users(id), queue TEXT NOT NULL, started_at INTEGER NOT NULL) STRICT;
  CREATE TABLE test_print_results (attempt_id INTEGER PRIMARY KEY REFERENCES test_print_attempts(id), result TEXT NOT NULL CHECK(result IN ('failed','accepted')), occurred_at INTEGER NOT NULL) STRICT;
  CREATE TRIGGER test_print_jobs_no_update BEFORE UPDATE ON test_print_jobs BEGIN SELECT RAISE(ABORT,'Print jobs are immutable'); END;
  CREATE TRIGGER test_print_jobs_no_delete BEFORE DELETE ON test_print_jobs BEGIN SELECT RAISE(ABORT,'Print jobs are immutable'); END;
  CREATE TRIGGER test_print_attempts_no_update BEFORE UPDATE ON test_print_attempts BEGIN SELECT RAISE(ABORT,'Print attempts are immutable'); END;
  CREATE TRIGGER test_print_attempts_no_delete BEFORE DELETE ON test_print_attempts BEGIN SELECT RAISE(ABORT,'Print attempts are immutable'); END;
  CREATE TRIGGER test_print_results_no_update BEFORE UPDATE ON test_print_results BEGIN SELECT RAISE(ABORT,'Print results are immutable'); END;
  CREATE TRIGGER test_print_results_no_delete BEFORE DELETE ON test_print_results BEGIN SELECT RAISE(ABORT,'Print results are immutable'); END;
  CREATE TRIGGER test_print_jobs_no_replace BEFORE INSERT ON test_print_jobs WHEN EXISTS(SELECT 1 FROM test_print_jobs WHERE id=NEW.id OR ticket_id=NEW.ticket_id OR bill_id=NEW.bill_id) BEGIN SELECT RAISE(ABORT,'Print jobs are immutable'); END;
  CREATE TRIGGER test_print_attempts_no_replace BEFORE INSERT ON test_print_attempts WHEN EXISTS(SELECT 1 FROM test_print_attempts WHERE id=NEW.id OR request_id=NEW.request_id) BEGIN SELECT RAISE(ABORT,'Print attempts are immutable'); END;
  CREATE TRIGGER test_print_results_no_replace BEFORE INSERT ON test_print_results WHEN EXISTS(SELECT 1 FROM test_print_results WHERE attempt_id=NEW.attempt_id) BEGIN SELECT RAISE(ABORT,'Print results are immutable'); END;` },
  { version: 27, sql: `CREATE TABLE day_print_settings (id INTEGER PRIMARY KEY CHECK(id=1), queue TEXT NOT NULL CHECK(length(trim(queue)) BETWEEN 1 AND 255)) STRICT;
  INSERT INTO day_print_settings SELECT 1,queue FROM test_printer_queues WHERE destination='bill';
  CREATE TABLE day_print_jobs (id INTEGER PRIMARY KEY, day_id INTEGER NOT NULL UNIQUE REFERENCES business_days(id), snapshot TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT;
  CREATE TABLE day_print_attempts (id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES day_print_jobs(id), request_id TEXT NOT NULL UNIQUE, actor_id INTEGER NOT NULL REFERENCES local_users(id), queue TEXT NOT NULL, started_at INTEGER NOT NULL) STRICT;
  CREATE TABLE day_print_results (attempt_id INTEGER PRIMARY KEY REFERENCES day_print_attempts(id), result TEXT NOT NULL CHECK(result IN ('failed','accepted')), occurred_at INTEGER NOT NULL) STRICT;
  CREATE TRIGGER day_jobs_no_update BEFORE UPDATE ON day_print_jobs BEGIN SELECT RAISE(ABORT,'Reports are immutable'); END;
  CREATE TRIGGER day_jobs_no_delete BEFORE DELETE ON day_print_jobs BEGIN SELECT RAISE(ABORT,'Reports are immutable'); END;
  CREATE TRIGGER day_attempts_no_update BEFORE UPDATE ON day_print_attempts BEGIN SELECT RAISE(ABORT,'Attempts are immutable'); END;
  CREATE TRIGGER day_attempts_no_delete BEFORE DELETE ON day_print_attempts BEGIN SELECT RAISE(ABORT,'Attempts are immutable'); END;
  CREATE TRIGGER day_results_no_update BEFORE UPDATE ON day_print_results BEGIN SELECT RAISE(ABORT,'Results are immutable'); END;
  CREATE TRIGGER day_results_no_delete BEFORE DELETE ON day_print_results BEGIN SELECT RAISE(ABORT,'Results are immutable'); END;
  CREATE TRIGGER day_jobs_no_replace BEFORE INSERT ON day_print_jobs WHEN EXISTS(SELECT 1 FROM day_print_jobs WHERE id=NEW.id OR day_id=NEW.day_id) BEGIN SELECT RAISE(ABORT,'Reports are immutable'); END;
  CREATE TRIGGER day_attempts_no_replace BEFORE INSERT ON day_print_attempts WHEN EXISTS(SELECT 1 FROM day_print_attempts WHERE id=NEW.id OR request_id=NEW.request_id) BEGIN SELECT RAISE(ABORT,'Attempts are immutable'); END;
  CREATE TRIGGER day_results_no_replace BEFORE INSERT ON day_print_results WHEN EXISTS(SELECT 1 FROM day_print_results WHERE attempt_id=NEW.attempt_id) BEGIN SELECT RAISE(ABORT,'Results are immutable'); END;` },
  { version: 28, sql: `INSERT OR IGNORE INTO user_permissions(user_id, permission)
    SELECT user_id, permission FROM financial_scopes CROSS JOIN
    (SELECT 'tables.change' AS permission UNION ALL SELECT 'menu.change' UNION ALL SELECT 'employees.view' UNION ALL SELECT 'employees.change')
    WHERE scope IN ('A','B','combined');` },
  { version: 29, sql: `CREATE TABLE pending_staff (user_id INTEGER PRIMARY KEY REFERENCES local_users(id)) STRICT;` },
  { version: 30, sql: `ALTER TABLE day_print_attempts ADD COLUMN scope TEXT NOT NULL DEFAULT 'combined' CHECK(scope IN ('A','B','combined'));` },
  { version: 31, sql: `CREATE TABLE restaurant_accounts (user_id INTEGER PRIMARY KEY REFERENCES local_users(id)) STRICT;` },
  { version: 32, sql: `CREATE TABLE order_cancellations (order_id INTEGER PRIMARY KEY REFERENCES orders(id), actor_id INTEGER NOT NULL REFERENCES local_users(id), occurred_at INTEGER NOT NULL, reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500), items TEXT NOT NULL) STRICT;
  CREATE TRIGGER order_cancellations_no_update BEFORE UPDATE ON order_cancellations BEGIN SELECT RAISE(ABORT,'Cancellations are immutable'); END;
  CREATE TRIGGER order_cancellations_no_delete BEFORE DELETE ON order_cancellations BEGIN SELECT RAISE(ABORT,'Cancellations are immutable'); END;
  CREATE TRIGGER order_cancellations_no_replace BEFORE INSERT ON order_cancellations WHEN EXISTS(SELECT 1 FROM order_cancellations WHERE order_id=NEW.order_id) BEGIN SELECT RAISE(ABORT,'Cancellations are immutable'); END;` },
  { version: 33, sql: `CREATE TABLE IF NOT EXISTS cancellation_notice_jobs (id INTEGER PRIMARY KEY, correction_id INTEGER NOT NULL UNIQUE REFERENCES sent_item_corrections(id), destination TEXT NOT NULL CHECK(destination IN ('kitchen','bar')), snapshot TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS cancellation_notice_attempts (id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES cancellation_notice_jobs(id), request_id TEXT NOT NULL UNIQUE, actor_id INTEGER NOT NULL REFERENCES local_users(id), queue TEXT NOT NULL, beep INTEGER NOT NULL CHECK(beep IN (0,1)), started_at INTEGER NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS cancellation_alert_settings (destination TEXT PRIMARY KEY CHECK(destination IN ('kitchen','bar')), beep INTEGER NOT NULL DEFAULT 0 CHECK(beep IN (0,1))) STRICT;
  INSERT OR IGNORE INTO cancellation_alert_settings(destination) VALUES('kitchen'),('bar');
  CREATE TABLE IF NOT EXISTS cancellation_notice_results (attempt_id INTEGER PRIMARY KEY REFERENCES cancellation_notice_attempts(id), result TEXT NOT NULL CHECK(result IN ('failed','accepted')), occurred_at INTEGER NOT NULL) STRICT;
  CREATE TRIGGER IF NOT EXISTS cancellation_jobs_no_update BEFORE UPDATE ON cancellation_notice_jobs BEGIN SELECT RAISE(ABORT,'Notices are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS cancellation_jobs_no_delete BEFORE DELETE ON cancellation_notice_jobs BEGIN SELECT RAISE(ABORT,'Notices are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS cancellation_jobs_no_replace BEFORE INSERT ON cancellation_notice_jobs WHEN EXISTS(SELECT 1 FROM cancellation_notice_jobs WHERE id=NEW.id OR correction_id=NEW.correction_id) BEGIN SELECT RAISE(ABORT,'Notices are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS cancellation_attempts_no_update BEFORE UPDATE ON cancellation_notice_attempts BEGIN SELECT RAISE(ABORT,'Attempts are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS cancellation_attempts_no_delete BEFORE DELETE ON cancellation_notice_attempts BEGIN SELECT RAISE(ABORT,'Attempts are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS cancellation_attempts_no_replace BEFORE INSERT ON cancellation_notice_attempts WHEN EXISTS(SELECT 1 FROM cancellation_notice_attempts WHERE id=NEW.id OR request_id=NEW.request_id) BEGIN SELECT RAISE(ABORT,'Attempts are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS cancellation_results_no_update BEFORE UPDATE ON cancellation_notice_results BEGIN SELECT RAISE(ABORT,'Results are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS cancellation_results_no_delete BEFORE DELETE ON cancellation_notice_results BEGIN SELECT RAISE(ABORT,'Results are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS cancellation_results_no_replace BEFORE INSERT ON cancellation_notice_results WHEN EXISTS(SELECT 1 FROM cancellation_notice_results WHERE attempt_id=NEW.attempt_id) BEGIN SELECT RAISE(ABORT,'Results are immutable'); END;` },
  { version: 34, run: addSecondKitchen },
  { version: 35, sql: `CREATE INDEX IF NOT EXISTS activity_move_source ON application_audit(order_id) WHERE action='move_items' AND entity_type='order';
    CREATE INDEX IF NOT EXISTS activity_move_destination ON application_audit(json_extract(context,'$.destinationOrderId')) WHERE action='move_items' AND entity_type='order';
    CREATE INDEX IF NOT EXISTS activity_correction_source ON application_audit(json_extract(context,'$.correctionId')) WHERE action='correct_sent' AND entity_type='order_item';
    CREATE INDEX IF NOT EXISTS activity_correction_date ON sent_item_corrections(occurred_at,id);
    CREATE INDEX IF NOT EXISTS activity_correction_actor_date ON sent_item_corrections(actor_id,occurred_at,id);
    CREATE INDEX IF NOT EXISTS activity_order_cancellation_date ON order_cancellations(occurred_at,order_id);
    CREATE INDEX IF NOT EXISTS activity_order_cancellation_actor_date ON order_cancellations(actor_id,occurred_at,order_id);
    CREATE INDEX IF NOT EXISTS activity_payment_actor_date ON payments(actor_id,paid_at);` },
  { version: 36, sql: `CREATE TABLE IF NOT EXISTS bill_printer_queues (account TEXT PRIMARY KEY CHECK(account IN ('A','B')), queue TEXT NOT NULL CHECK(length(trim(queue)) BETWEEN 1 AND 255)) STRICT;
    INSERT OR IGNORE INTO bill_printer_queues SELECT 'A',queue FROM test_printer_queues WHERE destination='bill';
    INSERT OR IGNORE INTO bill_printer_queues SELECT 'B',queue FROM test_printer_queues WHERE destination='bill';` },
  { version: 37, sql: `CREATE TABLE IF NOT EXISTS account_a_settings (id INTEGER PRIMARY KEY CHECK(id=1), boundary INTEGER NOT NULL, queue TEXT NOT NULL) STRICT;
    INSERT OR IGNORE INTO account_a_settings SELECT 1,COALESCE((SELECT MAX(id) FROM business_days WHERE closed_at IS NOT NULL),0),queue FROM bill_printer_queues WHERE account='A';
    CREATE TABLE IF NOT EXISTS account_a_closes (id INTEGER PRIMARY KEY, day_id INTEGER NOT NULL UNIQUE REFERENCES business_days(id), actor_id INTEGER NOT NULL REFERENCES local_users(id), closed_at INTEGER NOT NULL, snapshot TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS account_a_attempts (id INTEGER PRIMARY KEY, close_id INTEGER NOT NULL REFERENCES account_a_closes(id), request_id TEXT NOT NULL UNIQUE, actor_id INTEGER NOT NULL REFERENCES local_users(id), queue TEXT NOT NULL, started_at INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS account_a_results (attempt_id INTEGER PRIMARY KEY REFERENCES account_a_attempts(id), result TEXT NOT NULL CHECK(result IN ('failed','accepted')), occurred_at INTEGER NOT NULL) STRICT;
    CREATE TRIGGER IF NOT EXISTS account_a_closes_no_update BEFORE UPDATE ON account_a_closes BEGIN SELECT RAISE(ABORT,'Closes are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS account_a_closes_no_delete BEFORE DELETE ON account_a_closes BEGIN SELECT RAISE(ABORT,'Closes are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS account_a_closes_no_replace BEFORE INSERT ON account_a_closes WHEN EXISTS(SELECT 1 FROM account_a_closes WHERE id=NEW.id OR day_id=NEW.day_id) BEGIN SELECT RAISE(ABORT,'Closes are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS account_a_attempts_no_update BEFORE UPDATE ON account_a_attempts BEGIN SELECT RAISE(ABORT,'Attempts are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS account_a_attempts_no_delete BEFORE DELETE ON account_a_attempts BEGIN SELECT RAISE(ABORT,'Attempts are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS account_a_attempts_no_replace BEFORE INSERT ON account_a_attempts WHEN EXISTS(SELECT 1 FROM account_a_attempts WHERE id=NEW.id OR request_id=NEW.request_id) BEGIN SELECT RAISE(ABORT,'Attempts are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS account_a_results_no_update BEFORE UPDATE ON account_a_results BEGIN SELECT RAISE(ABORT,'Results are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS account_a_results_no_delete BEFORE DELETE ON account_a_results BEGIN SELECT RAISE(ABORT,'Results are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS account_a_results_no_replace BEFORE INSERT ON account_a_results WHEN EXISTS(SELECT 1 FROM account_a_results WHERE attempt_id=NEW.attempt_id) BEGIN SELECT RAISE(ABORT,'Results are immutable'); END;` },
  { version: 38, sql: `CREATE TABLE IF NOT EXISTS account_a_bill_print_settings (id INTEGER PRIMARY KEY CHECK(id=1), queue TEXT NOT NULL CHECK(length(trim(queue)) BETWEEN 1 AND 255)) STRICT;
    INSERT OR IGNORE INTO account_a_bill_print_settings SELECT 1,queue FROM bill_printer_queues WHERE account='A';` },
  { version: 39, sql: `CREATE TABLE shift_coverage_unavailable (day_id INTEGER PRIMARY KEY REFERENCES business_days(id)) STRICT;
    INSERT INTO shift_coverage_unavailable SELECT d.id FROM business_days d WHERE d.closed_at IS NULL AND (
      EXISTS(SELECT 1 FROM payment_business_days pd WHERE pd.business_day_id=d.id) OR
      EXISTS(SELECT 1 FROM preparation_rounds r WHERE r.sent_at>=d.opened_at) OR
      EXISTS(SELECT 1 FROM application_audit a WHERE a.occurred_at>=d.opened_at AND a.action IN ('add','send','remove','quantity_changed','note_changed','correct_sent','generate','record')) OR
      EXISTS(SELECT 1 FROM application_audit a WHERE a.occurred_at>=d.opened_at AND a.action='move' AND a.entity_type='order' AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.id=a.order_id AND (NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=o.id AND (i.status<>'sent' OR i.quantity<>COALESCE((SELECT SUM(c.quantity) FROM sent_item_corrections c WHERE c.item_id=i.id),0)))
        AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.order_id=o.id)
        AND EXISTS (SELECT 1 FROM application_audit h WHERE h.order_id=o.id AND h.action='open' AND h.entity_type='order')
        AND NOT EXISTS (SELECT 1 FROM application_audit h WHERE h.order_id=o.id AND NOT ((h.action IN ('open','move') AND h.entity_type='order') OR (h.action IN ('add','remove','quantity_changed','note_changed','correct_sent') AND h.entity_type='order_item') OR (h.action='send' AND h.entity_type='preparation_round') OR (h.action='print_retry' AND h.entity_type='print_attempt')))))) OR
      EXISTS(SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status='open' AND NOT EXISTS(SELECT 1 FROM application_audit a WHERE a.action='add' AND a.entity_type='order_item' AND a.entity_id=CAST(i.id AS TEXT) AND a.occurred_at<d.opened_at)));
    CREATE TABLE restaurant_shifts (id INTEGER PRIMARY KEY, day_id INTEGER NOT NULL REFERENCES business_days(id), opened_at INTEGER NOT NULL, reportable INTEGER NOT NULL CHECK(reportable IN (0,1))) STRICT;
    CREATE INDEX restaurant_shifts_day ON restaurant_shifts(day_id,id);
    CREATE TABLE shift_closes (shift_id INTEGER PRIMARY KEY REFERENCES restaurant_shifts(id), closed_at INTEGER NOT NULL, actor_id INTEGER NOT NULL REFERENCES local_users(id), snapshot TEXT NOT NULL) STRICT;
    CREATE TABLE payment_shifts (payment_id INTEGER PRIMARY KEY REFERENCES payments(id), shift_id INTEGER NOT NULL REFERENCES restaurant_shifts(id)) STRICT;
    CREATE TRIGGER restaurant_shifts_update_guard BEFORE UPDATE ON restaurant_shifts WHEN OLD.reportable!=0 OR NEW.reportable!=1 OR OLD.id!=NEW.id OR OLD.day_id!=NEW.day_id OR OLD.opened_at!=NEW.opened_at OR EXISTS(SELECT 1 FROM shift_closes WHERE shift_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Shift is immutable'); END;
    CREATE TRIGGER restaurant_shifts_no_delete BEFORE DELETE ON restaurant_shifts BEGIN SELECT RAISE(ABORT,'Shifts are retained'); END;
    CREATE TRIGGER shift_closes_no_replace BEFORE INSERT ON shift_closes WHEN EXISTS(SELECT 1 FROM shift_closes WHERE shift_id=NEW.shift_id) BEGIN SELECT RAISE(ABORT,'Shift close is immutable'); END;
    CREATE TRIGGER payment_shifts_no_replace BEFORE INSERT ON payment_shifts WHEN EXISTS(SELECT 1 FROM payment_shifts WHERE payment_id=NEW.payment_id) BEGIN SELECT RAISE(ABORT,'Payment shift is immutable'); END;
    CREATE TRIGGER shift_closes_no_update BEFORE UPDATE ON shift_closes BEGIN SELECT RAISE(ABORT,'Shift close is immutable'); END;
    CREATE TRIGGER shift_closes_no_delete BEFORE DELETE ON shift_closes BEGIN SELECT RAISE(ABORT,'Shift close is immutable'); END;
    CREATE TRIGGER payment_shifts_no_update BEFORE UPDATE ON payment_shifts BEGIN SELECT RAISE(ABORT,'Payment shift is immutable'); END;
    CREATE TRIGGER payment_shifts_no_delete BEFORE DELETE ON payment_shifts BEGIN SELECT RAISE(ABORT,'Payment shift is immutable'); END;` },
  { version: 40, sql: `CREATE TABLE shift_print_attempts (id INTEGER PRIMARY KEY, shift_id INTEGER NOT NULL REFERENCES shift_closes(shift_id), request_id TEXT NOT NULL UNIQUE, actor_id INTEGER NOT NULL REFERENCES local_users(id), scope TEXT NOT NULL CHECK(scope IN ('A','B','combined')), queue TEXT NOT NULL, started_at INTEGER NOT NULL) STRICT;
    CREATE TABLE shift_print_results (attempt_id INTEGER PRIMARY KEY REFERENCES shift_print_attempts(id), result TEXT NOT NULL CHECK(result IN ('accepted','failed')), finished_at INTEGER NOT NULL) STRICT;
    CREATE TRIGGER shift_print_attempts_no_update BEFORE UPDATE ON shift_print_attempts BEGIN SELECT RAISE(ABORT,'Print attempts are retained'); END;
    CREATE TRIGGER shift_print_attempts_no_delete BEFORE DELETE ON shift_print_attempts BEGIN SELECT RAISE(ABORT,'Print attempts are retained'); END;
    CREATE TRIGGER shift_print_results_no_update BEFORE UPDATE ON shift_print_results BEGIN SELECT RAISE(ABORT,'Print results are retained'); END;
    CREATE TRIGGER shift_print_results_no_delete BEFORE DELETE ON shift_print_results BEGIN SELECT RAISE(ABORT,'Print results are retained'); END;` },
  { version: 41, sql: `CREATE TABLE wallet_baselines (shift_id INTEGER PRIMARY KEY REFERENCES restaurant_shifts(id), actor_id INTEGER NOT NULL REFERENCES local_users(id), recorded_at INTEGER NOT NULL, amount INTEGER NOT NULL CHECK(amount>=0), payment_boundary INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('opening','midshift','carry'))) STRICT;
    CREATE TABLE wallet_movements (id INTEGER PRIMARY KEY, shift_id INTEGER NOT NULL REFERENCES restaurant_shifts(id), actor_id INTEGER NOT NULL REFERENCES local_users(id), recorded_at INTEGER NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('in','out')), amount INTEGER NOT NULL CHECK(amount>0), reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 200)) STRICT;
    CREATE TABLE wallet_closings (shift_id INTEGER PRIMARY KEY REFERENCES restaurant_shifts(id), actor_id INTEGER NOT NULL REFERENCES local_users(id), recorded_at INTEGER NOT NULL, expected INTEGER NOT NULL, counted INTEGER NOT NULL CHECK(counted>=0), variance INTEGER NOT NULL, retained INTEGER CHECK(retained>=0), taken INTEGER CHECK(taken>=0), day_close INTEGER NOT NULL CHECK(day_close IN (0,1))) STRICT;
    CREATE TABLE wallet_requests (request_id TEXT PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES local_users(id), action TEXT NOT NULL, payload TEXT NOT NULL, result TEXT NOT NULL) STRICT;
    CREATE TABLE wallet_prepared (request_id TEXT PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES local_users(id), action TEXT NOT NULL, payload TEXT NOT NULL, operation TEXT NOT NULL) STRICT;
    CREATE TABLE wallet_cancellations (request_id TEXT PRIMARY KEY REFERENCES wallet_prepared(request_id), actor_id INTEGER NOT NULL REFERENCES local_users(id), cancelled_at INTEGER NOT NULL) STRICT;
    CREATE TRIGGER wallet_baselines_no_update BEFORE UPDATE ON wallet_baselines BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_baselines_no_delete BEFORE DELETE ON wallet_baselines BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_movements_no_update BEFORE UPDATE ON wallet_movements BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_movements_no_delete BEFORE DELETE ON wallet_movements BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_closings_no_update BEFORE UPDATE ON wallet_closings BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_closings_no_delete BEFORE DELETE ON wallet_closings BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_requests_no_update BEFORE UPDATE ON wallet_requests BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_requests_no_delete BEFORE DELETE ON wallet_requests BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_prepared_no_update BEFORE UPDATE ON wallet_prepared BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_prepared_no_delete BEFORE DELETE ON wallet_prepared BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_cancellations_no_update BEFORE UPDATE ON wallet_cancellations BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_cancellations_no_delete BEFORE DELETE ON wallet_cancellations BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_baselines_no_replace BEFORE INSERT ON wallet_baselines WHEN EXISTS(SELECT 1 FROM wallet_baselines WHERE shift_id=NEW.shift_id) BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_movements_no_replace BEFORE INSERT ON wallet_movements WHEN EXISTS(SELECT 1 FROM wallet_movements WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_closings_no_replace BEFORE INSERT ON wallet_closings WHEN EXISTS(SELECT 1 FROM wallet_closings WHERE shift_id=NEW.shift_id) BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_requests_no_replace BEFORE INSERT ON wallet_requests WHEN EXISTS(SELECT 1 FROM wallet_requests WHERE request_id=NEW.request_id) BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_prepared_no_replace BEFORE INSERT ON wallet_prepared WHEN EXISTS(SELECT 1 FROM wallet_prepared WHERE request_id=NEW.request_id) BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;
    CREATE TRIGGER wallet_cancellations_no_replace BEFORE INSERT ON wallet_cancellations WHEN EXISTS(SELECT 1 FROM wallet_cancellations WHERE request_id=NEW.request_id) BEGIN SELECT RAISE(ABORT,'Wallet history is retained'); END;` },
  { version: 42, sql: `CREATE TABLE verified_waiter_pins (
    user_id INTEGER PRIMARY KEY REFERENCES local_users(id)
  ) STRICT;` },
  { version: 43, sql: `CREATE TABLE order_waiter_ownership (
    order_id INTEGER PRIMARY KEY REFERENCES orders(id),
    waiter_id INTEGER NOT NULL REFERENCES local_users(id),
    assigned_by INTEGER NOT NULL REFERENCES local_users(id),
    assigned_at INTEGER NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('open','legacy'))
  ) STRICT;
  CREATE TABLE legacy_unassigned_orders (order_id INTEGER PRIMARY KEY REFERENCES orders(id)) STRICT;
  INSERT INTO legacy_unassigned_orders SELECT o.id FROM orders o WHERE (o.status='open' AND o.retired_empty=0) OR EXISTS(SELECT 1 FROM bills b JOIN payments p ON p.bill_id=b.id WHERE b.order_id=o.id) OR EXISTS(SELECT 1 FROM preparation_rounds r WHERE r.order_id=o.id);
  CREATE TRIGGER order_waiter_ownership_no_update BEFORE UPDATE ON order_waiter_ownership BEGIN SELECT RAISE(ABORT,'Order ownership is retained'); END;
  CREATE TRIGGER order_waiter_ownership_no_delete BEFORE DELETE ON order_waiter_ownership BEGIN SELECT RAISE(ABORT,'Order ownership is retained'); END;
  CREATE TRIGGER order_waiter_ownership_no_replace BEFORE INSERT ON order_waiter_ownership WHEN EXISTS(SELECT 1 FROM order_waiter_ownership WHERE order_id=NEW.order_id) BEGIN SELECT RAISE(ABORT,'Order ownership is retained'); END;` },
  { version: 44, run: require('./fiscal-tax-v44').migrateFiscalTax },
  { version: 45, run: require('./fiscal-checkout-schema').createFiscalCheckoutSchema },
  { version: 46, run: require('./fiscal-daily-schema').createFiscalDailySchema },
  { version: 47, run: require('./fiscal-origin-v47').migrateFiscalOrigin },
  { version: 48, run: require('./simulated-card-v48').migrateSimulatedCard },
];

// Rebuild constrained tables without changing their historic rows or references.
function addSecondKitchen(db) {
  const tables = ['menu_products','preparation_tickets','simulated_printers','test_printer_queues','test_print_jobs','cancellation_notice_jobs','cancellation_alert_settings'];
  for (const table of tables) {
    const schema = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(table)?.sql;
    if (!schema) throw new Error('Missing printer schema');
    const expanded = schema.replaceAll("'kitchen', 'bar'", "'kitchen', 'kitchen2', 'bar'").replaceAll("'kitchen','bar'", "'kitchen','kitchen2','bar'");
    if (expanded === schema && !schema.includes("'kitchen2'")) throw new Error('Unexpected printer schema');
    const triggers = db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=? AND sql IS NOT NULL").all(table);
    const definition = table === 'test_printer_queues' ? expanded.replace('length(trim(queue)) BETWEEN 1 AND 255', 'length(trim(queue)) BETWEEN 0 AND 255') : expanded;
    const create = definition.replace(/^CREATE TABLE (?:IF NOT EXISTS )?[\"\x60\[]?\w+[\"\x60\]]?/i, 'CREATE TABLE s075_new');
    if (create === definition) throw new Error('Unexpected printer table definition');
    db.exec(create);
    db.exec('INSERT INTO s075_new SELECT * FROM ' + table);
    db.exec('DROP TABLE ' + table);
    db.exec('ALTER TABLE s075_new RENAME TO ' + table);
    for (const trigger of triggers) db.exec(trigger.sql);
  }
  db.exec("INSERT OR IGNORE INTO simulated_printers VALUES('kitchen2','success'); INSERT OR IGNORE INTO test_printer_queues VALUES('kitchen2',''); INSERT OR IGNORE INTO cancellation_alert_settings VALUES('kitchen2',0)");
}

function migrate(db) {
  const foreignKeys = db.prepare('PRAGMA foreign_keys').get().foreign_keys;
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('PRAGMA user_version').get().user_version;
    const latest = migrations[migrations.length - 1].version;
    if (current > latest) throw new Error('Database version is newer than this application');
    for (const migration of migrations) {
      if (migration.version > current) {
        if (migration.run) migration.run(db); else db.exec(migration.sql);
        db.exec(`PRAGMA user_version = ${migration.version}`);
      }
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database foreign key check failed');
    db.exec('COMMIT');
  } catch (error) {
    // SQLite can automatically roll back on SQLITE_FULL and other I/O errors.
    // Do not mask the original failure with a second ROLLBACK error.
    if (db.isTransaction) {
      try { db.exec('ROLLBACK'); } catch { /* Closing the connection also rolls back. */ }
    }
    throw error;
  } finally {
    db.exec(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}

function openDatabase(dataDirectory) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const db = new DatabaseSync(path.join(dataDirectory, 'arra.sqlite'));
  try {
    // Another connection can be opening or upgrading this database at the same
    // time. Wait briefly for its migration transaction without changing the
    // lock behavior of subsequent service operations on this connection.
    const busyTimeout = db.prepare('PRAGMA busy_timeout').get().timeout;
    db.exec('PRAGMA busy_timeout = 5000');
    migrate(db);
    db.exec(`PRAGMA busy_timeout = ${busyTimeout}`);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

module.exports = { openDatabase, migrate };
