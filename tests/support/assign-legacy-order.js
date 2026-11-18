const assert = require('node:assert/strict');
const { randomBytes, randomInt } = require('node:crypto');
const { hashPassword } = require('../../src/desktop/session');
const { registerLegacyOrderAssignment } = require('../../src/desktop/legacy-order-assignment');

// Establish the explicit Combined transition for tests of pre-ownership orders.
function assignLegacyOrder(db, orderId, waiterId = 1) {
  const salt = randomBytes(16), pin = String(randomInt(10000)).padStart(4, '0');
  db.prepare('UPDATE local_users SET pin_salt=?, pin_hash=? WHERE id=?').run(salt, hashPassword(pin, salt), waiterId);
  const admin = Number(db.prepare("INSERT INTO local_users(username,salt,password_hash) VALUES(?,?,?)").run('fixture-transition-owner', randomBytes(16), randomBytes(32)).lastInsertRowid);
  db.prepare("INSERT INTO financial_scopes(user_id,scope) VALUES(?,'combined')").run(admin);
  db.prepare("INSERT INTO user_permissions(user_id,permission) VALUES(?,'orders.correct_sent')").run(admin);
  let invoke;
  registerLegacyOrderAssignment({handle:(_channel, fn) => invoke = fn}, () => true, db, {currentUserId:() => admin, authenticatedUserId:() => admin});
  const eligible = invoke({}, {action:'list'});
  assert.equal(eligible.ok, true);
  assert.ok(eligible.data.orders.some(order => order.orderId === orderId));
  assert.ok(eligible.data.waiters.some(waiter => waiter.id === waiterId));
  assert.equal(invoke({}, {action:'assign',orderId,waiterId}).ok, true);
}
module.exports = {assignLegacyOrder};
