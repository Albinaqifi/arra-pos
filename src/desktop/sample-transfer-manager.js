// Development sample databases only; never provision an operational account with this helper.
const { randomBytes } = require('node:crypto');
const { hashPassword } = require('./session');
function createSampleTransferManager(db, pin) {
  if (!/^\d{4}$/.test(pin)) throw new Error('A four-digit sample PIN is required');
  const salt = randomBytes(16), pinSalt = randomBytes(16), password = randomBytes(32).toString('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT 1 FROM transfer_managers').get()) throw new Error('Transfer manager already exists');
    const id = db.prepare('INSERT INTO local_users(username,salt,password_hash,pin_salt,pin_hash) VALUES(?,?,?,?,?)').run('sample-transfer-manager', salt, hashPassword(password,salt), pinSalt, hashPassword(pin,pinSalt)).lastInsertRowid;
    db.prepare('INSERT INTO transfer_managers VALUES (?)').run(id);
    db.exec('COMMIT'); return id;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { createSampleTransferManager };
