const { randomBytes, randomInt } = require('node:crypto');
const { hashPassword } = require('../src/desktop/session');

// Synthetic shared account and PIN for a pre-existing waiter fixture.
module.exports = function entryFixture(db, waiterId = 1) {
  const password = randomBytes(24).toString('hex');
  const pin = String(randomInt(10000)).padStart(4, '0');
  const salt = randomBytes(16), pinSalt = randomBytes(16);
  const id = db.prepare('INSERT INTO local_users(username,salt,password_hash) VALUES(?,?,?)').run('sample restaurant',salt,hashPassword(password,salt)).lastInsertRowid;
  db.prepare("INSERT INTO financial_scopes VALUES(?,'waiter')").run(id);
  db.prepare('INSERT INTO restaurant_accounts VALUES(?)').run(id);
  db.prepare('UPDATE local_users SET pin_salt=?,pin_hash=? WHERE id=?').run(pinSalt,hashPassword(pin,pinSalt),waiterId);
  return {password,pin};
};
