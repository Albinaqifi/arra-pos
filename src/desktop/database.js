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
