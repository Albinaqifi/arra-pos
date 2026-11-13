const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { bootstrap, registerSession, hashPassword } = require('../src/desktop/session');
const { randomBytes, randomInt } = require('node:crypto');

function provisionSampleEntry(db) {
  const password = randomBytes(24).toString('hex'), pin = String(randomInt(10000)).padStart(4, '0');
  const salt = randomBytes(16), pinSalt = randomBytes(16);
  const restaurant = db.prepare('INSERT INTO local_users(username,salt,password_hash) VALUES(?,?,?)').run('sample restaurant', salt, hashPassword(password, salt)).lastInsertRowid;
  db.prepare("INSERT INTO financial_scopes VALUES(?,'waiter')").run(restaurant);
  db.prepare('INSERT INTO restaurant_accounts VALUES(?)').run(restaurant);
  db.prepare("INSERT INTO financial_scopes(user_id,scope) VALUES(1,'waiter') ON CONFLICT(user_id) DO NOTHING").run();
  db.prepare('UPDATE local_users SET pin_salt=?,pin_hash=? WHERE id=1').run(pinSalt,hashPassword(pin,pinSalt));
  return { password, pin, restaurant };
}

test('waiter requests reject malformed input and a deactivated restaurant session', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-waiter-boundary-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  bootstrap(db, 'sample', 'sample password'); db.exec("UPDATE financial_scopes SET scope='waiter' WHERE user_id=1; DELETE FROM user_permissions WHERE user_id=1 AND permission='business_days.close'");
  const entry = provisionSampleEntry(db);
  const handlers = {}, trusted = {};
  const session = registerSession({ handle(c, f) { handlers[c] = f; } }, e => e === trusted, db);
  const call = (channel, request, event = trusted) => handlers['arra:' + channel](event, request);
  assert.equal(call('sign-in', { username: 'sample restaurant', password: entry.password }).ok, true);
  const wrongPin = String((Number(entry.pin) + 1) % 10000).padStart(4, '0');
  for (const request of [null, [], {}, { id: 0, pin: '' }, { id: 1.5, pin: '' }, { id: 1, pin: 1234 }, { id: 1, pin: '', extra: true }, { id: 1, pin: wrongPin }]) {
    assert.equal(call('select-waiter', request).ok, false);
    assert.equal(session.currentUserId(), null);
  }
  assert.equal(call('waiters', { extra: true }).ok, false);
  assert.equal(call('waiters', {}, {}).ok, false);
  assert.equal(call('select-waiter', { id: 1, pin: entry.pin }).ok, true);
  db.prepare('UPDATE local_users SET active = 0 WHERE id = ?').run(entry.restaurant);
  assert.equal(session.currentUserId(), null);
  assert.equal(call('waiters', {}).ok, false);
  assert.equal(call('select-waiter', { id: 1, pin: '' }).ok, false);
});

test('version 9 database upgrades with existing user and grants intact', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-waiter-upgrade-'));
  let db = openDatabase(dir);
  bootstrap(db, 'sample', 'sample password'); db.exec("UPDATE financial_scopes SET scope='waiter' WHERE user_id=1; DELETE FROM user_permissions WHERE user_id=1 AND permission='business_days.close'");
  db.exec("DROP TABLE IF EXISTS restaurant_accounts; DROP TRIGGER IF EXISTS billed_item_insert; DROP TRIGGER IF EXISTS billed_item_update; DROP TRIGGER IF EXISTS billed_item_delete; DROP TRIGGER IF EXISTS billed_correction; DROP TRIGGER IF EXISTS billed_order_move; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS bill_lines; DROP TABLE IF EXISTS bills; DELETE FROM user_permissions WHERE permission IN ('employees.view','employees.change'); DROP TABLE application_audit; DROP TABLE employee_permission_audit; DROP TABLE employee_credential_audit; DROP TABLE employee_account_audit; DELETE FROM user_permissions WHERE permission IN ('tables.change', 'menu.change', 'orders.correct_sent'); ALTER TABLE local_users DROP COLUMN pin_hash; ALTER TABLE local_users DROP COLUMN pin_salt; ALTER TABLE dining_tables DROP COLUMN active; ALTER TABLE dining_tables DROP COLUMN capacity; ALTER TABLE dining_tables DROP COLUMN area_id; DROP TABLE dining_areas; ALTER TABLE menu_categories DROP COLUMN parent_id; ALTER TABLE menu_categories DROP COLUMN sort_order; ALTER TABLE menu_products DROP COLUMN sort_order; DROP TABLE order_item_modifiers; DROP TABLE modifier_options; DROP TABLE modifier_groups; DROP TABLE print_attempts; DROP TABLE print_jobs; DROP TABLE simulated_printers; DROP TABLE preparation_ticket_items; DROP TABLE preparation_tickets; DROP TABLE preparation_rounds; ALTER TABLE menu_products DROP COLUMN destination; DROP TABLE IF EXISTS sent_item_corrections; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payment_business_days; DROP TABLE IF EXISTS business_days; DROP TABLE IF EXISTS financial_scopes; DROP INDEX one_open_order_per_table; ALTER TABLE orders DROP COLUMN retired_empty; CREATE UNIQUE INDEX one_open_order_per_table ON orders(table_id) WHERE status=char(111,112,101,110); DROP TABLE IF EXISTS test_print_results; DROP TABLE IF EXISTS test_print_attempts; DROP TABLE IF EXISTS test_print_jobs; DROP TABLE IF EXISTS test_printer_queues; DROP TABLE IF EXISTS day_print_settings; DROP TABLE IF EXISTS day_print_results; DROP TABLE IF EXISTS day_print_attempts; DROP TABLE IF EXISTS day_print_jobs; DROP TABLE IF EXISTS pending_staff; PRAGMA user_version = 9");
  db.close();
  db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 31);
  assert.equal(db.prepare('SELECT count(*) AS count FROM user_permissions WHERE user_id = 1').get().count, 9);
  const handlers = {}, trusted = {};
  registerSession({ handle(c, f) { handlers[c] = f; } }, e => e === trusted, db);
  assert.equal(handlers['arra:sign-in'](trusted, { username: 'sample', password: 'sample password' }).ok, false);
  const entry = provisionSampleEntry(db);
  assert.equal(handlers['arra:sign-in'](trusted, { username: 'sample restaurant', password: entry.password }).ok, true);
  assert.equal(handlers['arra:select-waiter'](trusted, { id: 1, pin: entry.pin }).ok, true);
});
