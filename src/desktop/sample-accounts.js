// Development sample identities only. Never call this against an operational database.
const { randomBytes } = require('node:crypto');
const { hashPassword, validPassword } = require('./session');
const identities = [['sample-waiter', 'waiter'], ['sample-owner-a', 'A'], ['sample-owner-b', 'B'], ['sample-combined', 'combined']];
function createSampleAccounts(db, passwords) {
  if (!Array.isArray(passwords) || passwords.length !== identities.length || !passwords.every(validPassword) || new Set(passwords).size !== identities.length) throw new Error('Four distinct passwords are required');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['local_users', 'orders', 'payments']) if (db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) throw new Error('Sample setup requires an empty database');
    const insert = db.prepare('INSERT INTO local_users(username, salt, password_hash) VALUES (?, ?, ?)');
    const scope = db.prepare('INSERT INTO financial_scopes VALUES (?, ?)');
    const grant = db.prepare('INSERT INTO user_permissions VALUES (?, ?)');
    const operational = ['tables.view', 'tables.change', 'menu.view', 'menu.change', 'orders.view', 'orders.change', 'employees.view', 'employees.change', 'orders.correct_sent'];
    identities.forEach(([name, role], i) => {
      const salt = randomBytes(16); const id = insert.run(name, salt, hashPassword(passwords[i], salt)).lastInsertRowid;
      scope.run(id, role);
      for (const permission of role === 'waiter' ? operational : role === 'combined' ? ['tables.change', 'menu.change', 'employees.view', 'employees.change', 'business_days.close'] : ['tables.change', 'menu.change', 'employees.view', 'employees.change']) grant.run(id, permission);
    });
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { createSampleAccounts, identities };
