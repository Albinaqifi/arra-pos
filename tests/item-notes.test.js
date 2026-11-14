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
const { registerOrders } = require('../src/desktop/orders');
const { registerOrderItems } = require('../src/desktop/order-items');

test('offline table and items recover notes after restart; only pending notes are editable', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-notes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = openDatabase(dir); seedTables(db); seedMenu(db);
  const trusted = {}; let open, items;
  function register() {
    registerOrders({ handle(_c, fn) { open = fn; } }, e => e === trusted, db, { currentUserId: () => 1, authenticatedUserId: () => 1 });
    registerOrderItems({ handle(_c, fn) { items = fn; } }, e => e === trusted, db, { currentUserId: () => 1, authenticatedUserId: () => 1 });
  }
  register();
  const order = open(trusted, { tableId: 1 }).data;
  const req = (action, extra = {}) => ({ action, orderId: order.id, ...extra });
  assert.deepEqual(items(trusted, req('list')).data.items, []);
  const first = items(trusted, req('add', { productId: 'qebapa' })).data.items[0];
  items(trusted, req('add', { productId: 'qebapa' }));
  assert.equal(items(trusted, req('note', { itemId: first.id, note: 'Less salt' })).data.items[0].note, 'Less salt');
  assert.equal(items(trusted, req('note', { itemId: first.id, note: 4 })).ok, false);
  assert.equal(items({}, req('note', { itemId: first.id, note: 'x' })).ok, false);
  db.close(); db = openDatabase(dir); register();
  assert.equal(open(trusted, { tableId: 1 }).data.id, order.id);
  const restored = items(trusted, req('list')).data;
  assert.equal(restored.items.length, 2); assert.equal(restored.items[0].note, 'Less salt');
  assert.equal(restored.items[1].note, ''); assert.equal(restored.total, 440);
  assert.equal(items(trusted, req('note', { itemId: first.id, note: '' })).data.items[0].note, '');
  db.prepare("UPDATE order_items SET status = 'sent' WHERE id = ?").run(first.id);
  assert.equal(items(trusted, req('note', { itemId: first.id, note: 'x' })).ok, false);
  db.close();
});

test('version 6 upgrade preserves existing item and initializes its note', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-note-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = openDatabase(dir); seedTables(db); seedMenu(db);
  db.exec("DROP TABLE IF EXISTS order_cancellations; DROP TABLE IF EXISTS restaurant_accounts; DROP TRIGGER IF EXISTS billed_item_insert; DROP TRIGGER IF EXISTS billed_item_update; DROP TRIGGER IF EXISTS billed_item_delete; DROP TRIGGER IF EXISTS billed_correction; DROP TRIGGER IF EXISTS billed_order_move; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS bill_lines; DROP TABLE IF EXISTS bills; DELETE FROM user_permissions WHERE permission IN ('employees.view','employees.change'); DROP TABLE application_audit; DROP TABLE employee_permission_audit; DROP TABLE employee_credential_audit; DROP TABLE employee_account_audit; INSERT INTO orders (table_id, opened_at, status) VALUES (1, 1, 'open'); INSERT INTO order_items (order_id, product_id, name, unit_price, quantity, status) VALUES (1, 'qebapa', 'Qebapa', 220, 2, 'pending'); ALTER TABLE order_items DROP COLUMN note; DROP TABLE user_permissions; DROP TABLE financial_scopes; DROP TABLE local_users; ALTER TABLE dining_tables DROP COLUMN active; ALTER TABLE dining_tables DROP COLUMN capacity; ALTER TABLE dining_tables DROP COLUMN area_id; DROP TABLE dining_areas; ALTER TABLE menu_categories DROP COLUMN parent_id; ALTER TABLE menu_categories DROP COLUMN sort_order; ALTER TABLE menu_products DROP COLUMN sort_order; DROP TABLE order_item_modifiers; DROP TABLE modifier_options; DROP TABLE modifier_groups; DROP TABLE print_attempts; DROP TABLE print_jobs; DROP TABLE simulated_printers; DROP TABLE preparation_ticket_items; DROP TABLE preparation_tickets; DROP TABLE preparation_rounds; ALTER TABLE menu_products DROP COLUMN destination; DROP TABLE IF EXISTS sent_item_corrections; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payment_business_days; DROP TABLE IF EXISTS business_days; DROP TABLE IF EXISTS financial_scopes; DROP INDEX one_open_order_per_table; ALTER TABLE orders DROP COLUMN retired_empty; CREATE UNIQUE INDEX one_open_order_per_table ON orders(table_id) WHERE status=char(111,112,101,110); DROP TABLE IF EXISTS test_print_results; DROP TABLE IF EXISTS test_print_attempts; DROP TABLE IF EXISTS test_print_jobs; DROP TABLE IF EXISTS test_printer_queues; DROP TABLE IF EXISTS day_print_settings; DROP TABLE IF EXISTS day_print_results; DROP TABLE IF EXISTS day_print_attempts; DROP TABLE IF EXISTS day_print_jobs; DROP TABLE IF EXISTS pending_staff; PRAGMA user_version = 6;");
  db.close(); db = openDatabase(dir);
  assert.deepEqual({ ...db.prepare('SELECT name, quantity, note FROM order_items').get() }, { name: 'Qebapa', quantity: 2, note: '' });
  db.close();
});
