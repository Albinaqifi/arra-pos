// Development sample identities only. Never call this against an operational database.
const { randomBytes } = require('node:crypto');
const { hashPassword, validPassword } = require('./session');
const identities = [['sample-waiter', 'waiter'], ['sample-owner-a', 'A'], ['sample-owner-b', 'B'], ['sample-combined', 'combined']];
const entryIdentities = [['sample-restaurant', 'waiter'], ['sample-owner-a', 'A'], ['sample-owner-b', 'B'], ['sample-combined', 'combined']];
// Call only for a new or explicitly marked sample database. Existing names are
// left entirely untouched, including their roles, grants and credentials.
function seedSampleIdentities(db, passwords, waiterPin, transferPin) {
  if (!Array.isArray(passwords) || passwords.length !== 4 || !passwords.every(validPassword) || new Set(passwords).size !== 4 || !/^\d{4}$/.test(waiterPin) || !/^\d{6}$/.test(transferPin)) throw new Error('Invalid sample credentials');
  db.exec('BEGIN IMMEDIATE');
  try {
    const lookup = db.prepare('SELECT id FROM local_users WHERE username=?');
    const insert = db.prepare('INSERT INTO local_users(username,salt,password_hash,pin_salt,pin_hash) VALUES(?,?,?,?,?)');
    const scope = db.prepare('INSERT INTO financial_scopes VALUES (?,?)');
    const grant = db.prepare('INSERT INTO user_permissions VALUES (?,?)');
    function add(name, password, pin) {
      if (lookup.get(name)) return null;
      const salt = randomBytes(16), pinSalt = pin == null ? null : randomBytes(16);
      return insert.run(name, salt, hashPassword(password, salt), pinSalt, pinSalt ? hashPassword(pin, pinSalt) : null).lastInsertRowid;
    }
    entryIdentities.forEach(([name, role], i) => {
      const id = add(name, passwords[i], null);
      if (id === null) return;
      scope.run(id, role);
      if (i === 0) db.prepare('INSERT INTO restaurant_accounts VALUES (?)').run(id);
      else for (const permission of role === 'combined' ? ['tables.change','menu.change','employees.view','employees.change','orders.correct_sent','business_days.close'] : ['tables.change','menu.change','employees.view','employees.change']) grant.run(id, permission);
    });
    const waiter = add('sample-waiter', randomBytes(32).toString('hex'), waiterPin);
    if (waiter !== null) {
      scope.run(waiter, 'waiter');
      for (const permission of ['tables.view','menu.view','orders.view','orders.change','orders.correct_sent']) grant.run(waiter, permission);
    }
    // Do not create a second transfer manager or modify an existing one.
    if (!db.prepare('SELECT 1 FROM transfer_managers LIMIT 1').get()) {
      const manager = add('sample-transfer-manager', randomBytes(32).toString('hex'), transferPin);
      if (manager !== null) db.prepare('INSERT INTO transfer_managers VALUES (?)').run(manager);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
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
      for (const permission of role === 'waiter' ? operational : role === 'combined' ? ['tables.change', 'menu.change', 'employees.view', 'employees.change', 'orders.correct_sent', 'business_days.close'] : ['tables.change', 'menu.change', 'employees.view', 'employees.change']) grant.run(id, permission);
    });
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { createSampleAccounts, identities, seedSampleIdentities, entryIdentities };
