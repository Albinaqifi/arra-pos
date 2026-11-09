const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase: realOpenDatabase } = require('../src/desktop/database');
const { authorizedDatabase } = require('./support/authorized-database');
const openDatabase = directory => authorizedDatabase(realOpenDatabase(directory));
const { seedTables, registerTables } = require('../src/desktop/tables');
const { registerOrders } = require('../src/desktop/orders');

test('version 4 upgrade preserves existing tables and menu data', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = openDatabase(dir);
  seedTables(db);
  db.exec("DROP TRIGGER IF EXISTS billed_item_insert; DROP TRIGGER IF EXISTS billed_item_update; DROP TRIGGER IF EXISTS billed_item_delete; DROP TRIGGER IF EXISTS billed_correction; DROP TRIGGER IF EXISTS billed_order_move; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS bill_lines; DROP TABLE IF EXISTS bills; DELETE FROM user_permissions WHERE permission IN ('employees.view','employees.change'); DROP TABLE application_audit; DROP TABLE employee_permission_audit; DROP TABLE employee_credential_audit; DROP TABLE employee_account_audit; INSERT INTO menu_categories (id,name,active) VALUES ('c', 'Sample', 1); INSERT INTO menu_products (id,category_id,name,price,active) VALUES ('p', 'c', 'Sample product', 123, 1); DROP TABLE order_items; DROP TABLE orders; DROP TABLE user_permissions; DROP TABLE financial_scopes; DROP TABLE local_users; ALTER TABLE dining_tables DROP COLUMN active; ALTER TABLE dining_tables DROP COLUMN capacity; ALTER TABLE dining_tables DROP COLUMN area_id; DROP TABLE dining_areas; ALTER TABLE menu_categories DROP COLUMN parent_id; ALTER TABLE menu_categories DROP COLUMN sort_order; ALTER TABLE menu_products DROP COLUMN sort_order; DROP TABLE order_item_modifiers; DROP TABLE modifier_options; DROP TABLE modifier_groups; DROP TABLE print_attempts; DROP TABLE print_jobs; DROP TABLE simulated_printers; DROP TABLE preparation_ticket_items; DROP TABLE preparation_tickets; DROP TABLE preparation_rounds; ALTER TABLE menu_products DROP COLUMN destination; DROP TABLE IF EXISTS sent_item_corrections; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payment_business_days; DROP TABLE IF EXISTS business_days; DROP TABLE IF EXISTS financial_scopes; PRAGMA user_version = 4;");
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 25);
  assert.equal(db.prepare('SELECT count(*) AS n FROM dining_tables').get().n, 16);
  assert.equal(db.prepare("SELECT price FROM menu_products WHERE id = 'p'").get().price, 123);
  let open;
  registerOrders({ handle(_channel, fn) { open = fn; } }, () => true, db, { currentUserId: () => 1, authenticatedUserId: () => 1 });
  assert.equal(open({}, { tableId: 1 }).ok, true);
  db.close();
});

test('failed order insertion rolls back and permits a later retry', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-failure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(dir);
  seedTables(db);
  let open, list;
  registerOrders({ handle(_channel, fn) { open = fn; } }, () => true, db, { currentUserId: () => 1, authenticatedUserId: () => 1 });
  registerTables({ handle(_channel, fn) { list = fn; } }, () => true, db, { currentUserId: () => 1, authenticatedUserId: () => 1 });
  db.exec("CREATE TRIGGER fail_order BEFORE INSERT ON orders BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;");
  assert.equal(open({}, { tableId: 1 }).ok, false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 0);
  assert.equal(list({}, {}).data[0].orderId, null);
  db.exec('DROP TRIGGER fail_order');
  const first = open({}, { tableId: 1 });
  assert.equal(first.ok, true);
  assert.equal(open({}, { tableId: 1 }).data.id, first.data.id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 1);
  db.close();
});
