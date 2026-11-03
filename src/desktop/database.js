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
