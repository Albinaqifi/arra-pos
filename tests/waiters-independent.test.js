const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { bootstrap, registerSession } = require('../src/desktop/session');

test('waiter requests reject malformed input and a deactivated restaurant session', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-waiter-boundary-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  bootstrap(db, 'sample', 'sample password');
  const handlers = {}, trusted = {};
  const session = registerSession({ handle(c, f) { handlers[c] = f; } }, e => e === trusted, db);
  const call = (channel, request, event = trusted) => handlers['arra:' + channel](event, request);
  assert.equal(call('sign-in', { username: 'sample', password: 'sample password' }).ok, true);
  for (const request of [null, [], {}, { id: 0, pin: '' }, { id: 1.5, pin: '' }, { id: 1, pin: 1234 }, { id: 1, pin: '', extra: true }, { id: 1, pin: '1234' }]) {
    assert.equal(call('select-waiter', request).ok, false);
    assert.equal(session.currentUserId(), null);
  }
  assert.equal(call('waiters', { extra: true }).ok, false);
  assert.equal(call('waiters', {}, {}).ok, false);
  assert.equal(call('select-waiter', { id: 1, pin: '' }).ok, true);
  db.prepare('UPDATE local_users SET active = 0 WHERE id = 1').run();
  assert.equal(session.currentUserId(), null);
  assert.equal(call('waiters', {}).ok, false);
  assert.equal(call('select-waiter', { id: 1, pin: '' }).ok, false);
});

test('version 9 database upgrades with existing user and grants intact', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-waiter-upgrade-'));
  let db = openDatabase(dir);
  bootstrap(db, 'sample', 'sample password');
  db.exec("DROP TRIGGER IF EXISTS billed_item_insert; DROP TRIGGER IF EXISTS billed_item_update; DROP TRIGGER IF EXISTS billed_item_delete; DROP TRIGGER IF EXISTS billed_correction; DROP TRIGGER IF EXISTS billed_order_move; DROP TABLE IF EXISTS bill_lines; DROP TABLE IF EXISTS bills; DELETE FROM user_permissions WHERE permission IN ('employees.view','employees.change'); DROP TABLE application_audit; DROP TABLE employee_permission_audit; DROP TABLE employee_credential_audit; DROP TABLE employee_account_audit; DELETE FROM user_permissions WHERE permission IN ('tables.change', 'menu.change', 'orders.correct_sent'); ALTER TABLE local_users DROP COLUMN pin_hash; ALTER TABLE local_users DROP COLUMN pin_salt; ALTER TABLE dining_tables DROP COLUMN active; ALTER TABLE dining_tables DROP COLUMN capacity; ALTER TABLE dining_tables DROP COLUMN area_id; DROP TABLE dining_areas; ALTER TABLE menu_categories DROP COLUMN parent_id; ALTER TABLE menu_categories DROP COLUMN sort_order; ALTER TABLE menu_products DROP COLUMN sort_order; DROP TABLE order_item_modifiers; DROP TABLE modifier_options; DROP TABLE modifier_groups; DROP TABLE print_attempts; DROP TABLE print_jobs; DROP TABLE simulated_printers; DROP TABLE preparation_ticket_items; DROP TABLE preparation_tickets; DROP TABLE preparation_rounds; ALTER TABLE menu_products DROP COLUMN destination; DROP TABLE IF EXISTS sent_item_corrections; PRAGMA user_version = 9");
  db.close();
  db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 20);
  assert.equal(db.prepare('SELECT count(*) AS count FROM user_permissions WHERE user_id = 1').get().count, 9);
  const handlers = {}, trusted = {};
  registerSession({ handle(c, f) { handlers[c] = f; } }, e => e === trusted, db);
  assert.equal(handlers['arra:sign-in'](trusted, { username: 'sample', password: 'sample password' }).ok, true);
  assert.equal(handlers['arra:select-waiter'](trusted, { id: 1, pin: '' }).ok, true);
});
