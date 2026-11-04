const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

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
];

function migrate(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('PRAGMA user_version').get().user_version;
    const latest = migrations[migrations.length - 1].version;
    if (current > latest) throw new Error('Database version is newer than this application');
    for (const migration of migrations) {
      if (migration.version > current) {
        db.exec(migration.sql);
        db.exec(`PRAGMA user_version = ${migration.version}`);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function openDatabase(dataDirectory) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const db = new DatabaseSync(path.join(dataDirectory, 'arra.sqlite'));
  try {
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

module.exports = { openDatabase };
