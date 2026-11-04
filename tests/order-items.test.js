const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase: realOpenDatabase } = require('../src/desktop/database');
const { authorizedDatabase } = require('./support/authorized-database');
const openDatabase = directory => authorizedDatabase(realOpenDatabase(directory));
const { seedTables } = require('../src/desktop/tables');
const { seedMenu } = require('../src/desktop/menu');
const { registerOrderItems } = require('../src/desktop/order-items');

test('pending items persist with snapshots, safe totals, and validated mutations', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-items-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = openDatabase(dir); seedTables(db); seedMenu(db);
  db.prepare("INSERT INTO orders (table_id, opened_at, status) VALUES (1, 1, 'open'), (2, 1, 'completed')").run();
  const trusted = {}; let call;
  const register = () => registerOrderItems({ handle(_c, fn) { call = fn; } }, e => e === trusted, db, { currentUserId: () => 1, authenticatedUserId: () => 1 });
  register();
  const req = (action, extra = {}) => ({ action, orderId: 1, ...extra });
  for (const value of [null, {}, req('list', { extra: 1 }), req('add', { productId: 'missing' }), req('list', { orderId: 2 }), req('list', { orderId: 999 }), req('increment', { itemId: 999 }), req('add', { productId: 7 })])
    assert.equal(call(trusted, value).ok, false);
  assert.equal(call({}, req('list')).ok, false);
  const added = call(trusted, req('add', { productId: 'qebapa' }));
  assert.equal(added.ok, true); const item = added.data.items[0];
  assert.equal(added.data.total, 220);
  assert.equal(call(trusted, req('increment', { itemId: item.id })).data.total, 440);
  db.prepare("UPDATE menu_products SET name = 'Changed', price = 999, active = 0 WHERE id = 'qebapa'").run();
  assert.equal(call(trusted, req('add', { productId: 'qebapa' })).ok, false);
  db.close(); db = openDatabase(dir); register();
  const restored = call(trusted, req('list')).data;
  assert.equal(restored.items[0].name, 'Qebapa'); assert.equal(restored.items[0].unitPrice, 220);
  assert.equal(restored.items[0].quantity, 2); assert.equal(restored.total, 440);
  assert.equal(call(trusted, req('decrement', { itemId: item.id })).data.total, 220);
  assert.equal(call(trusted, req('remove', { itemId: item.id })).data.total, 0);
  assert.equal(call(trusted, req('remove', { itemId: item.id })).ok, false);
  db.prepare("UPDATE menu_products SET active = 1, price = 9007199254740991 WHERE id = 'qebapa'").run();
  const maximum = call(trusted, req('add', { productId: 'qebapa' })).data.items[0];
  assert.equal(call(trusted, req('increment', { itemId: maximum.id })).ok, false);
  assert.equal(call(trusted, req('list')).data.items[0].quantity, 1);
  db.prepare("UPDATE order_items SET status = 'sent' WHERE id = ?").run(maximum.id);
  assert.equal(call(trusted, req('remove', { itemId: maximum.id })).ok, false);
  db.close();
});

test('version 5 upgrade retains an open order and menu', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-item-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = openDatabase(dir); seedTables(db); seedMenu(db);
  db.exec("DROP TRIGGER IF EXISTS billed_item_insert; DROP TRIGGER IF EXISTS billed_item_update; DROP TRIGGER IF EXISTS billed_item_delete; DROP TRIGGER IF EXISTS billed_correction; DROP TRIGGER IF EXISTS billed_order_move; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS bill_lines; DROP TABLE IF EXISTS bills; DELETE FROM user_permissions WHERE permission IN ('employees.view','employees.change'); DROP TABLE application_audit; DROP TABLE employee_permission_audit; DROP TABLE employee_credential_audit; DROP TABLE employee_account_audit; INSERT INTO orders (table_id, opened_at, status) VALUES (1, 123, 'open'); DROP TABLE order_items; DROP TABLE user_permissions; DROP TABLE financial_scopes; DROP TABLE local_users; ALTER TABLE dining_tables DROP COLUMN active; ALTER TABLE dining_tables DROP COLUMN capacity; ALTER TABLE dining_tables DROP COLUMN area_id; DROP TABLE dining_areas; ALTER TABLE menu_categories DROP COLUMN parent_id; ALTER TABLE menu_categories DROP COLUMN sort_order; ALTER TABLE menu_products DROP COLUMN sort_order; DROP TABLE order_item_modifiers; DROP TABLE modifier_options; DROP TABLE modifier_groups; DROP TABLE print_attempts; DROP TABLE print_jobs; DROP TABLE simulated_printers; DROP TABLE preparation_ticket_items; DROP TABLE preparation_tickets; DROP TABLE preparation_rounds; ALTER TABLE menu_products DROP COLUMN destination; DROP TABLE IF EXISTS sent_item_corrections; DROP TABLE IF EXISTS payment_business_days; DROP TABLE IF EXISTS business_days; DROP TABLE IF EXISTS financial_scopes; PRAGMA user_version = 5;");
  db.close(); db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 23);
  assert.equal(db.prepare('SELECT opened_at FROM orders WHERE table_id = 1').get().opened_at, 123);
  assert.equal(db.prepare("SELECT price FROM menu_products WHERE id = 'qebapa'").get().price, 220);
  assert.equal(db.prepare('SELECT count(*) AS n FROM order_items').get().n, 0);
  db.close();
});
