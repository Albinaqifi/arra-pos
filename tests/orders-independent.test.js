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
  db.exec("INSERT INTO menu_categories (id,name,active) VALUES ('c', 'Sample', 1); INSERT INTO menu_products (id,category_id,name,price,active) VALUES ('p', 'c', 'Sample product', 123, 1); DROP TABLE order_items; DROP TABLE orders; DROP TABLE user_permissions; DROP TABLE local_users; ALTER TABLE dining_tables DROP COLUMN active; ALTER TABLE dining_tables DROP COLUMN capacity; ALTER TABLE dining_tables DROP COLUMN area_id; DROP TABLE dining_areas; ALTER TABLE menu_categories DROP COLUMN parent_id; ALTER TABLE menu_categories DROP COLUMN sort_order; ALTER TABLE menu_products DROP COLUMN sort_order; PRAGMA user_version = 4;");
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 12);
  assert.equal(db.prepare('SELECT count(*) AS n FROM dining_tables').get().n, 16);
  assert.equal(db.prepare("SELECT price FROM menu_products WHERE id = 'p'").get().price, 123);
  let open;
  registerOrders({ handle(_channel, fn) { open = fn; } }, () => true, db, { currentUserId: () => 1 });
  assert.equal(open({}, { tableId: 1 }).ok, true);
  db.close();
});

test('failed order insertion rolls back and permits a later retry', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-failure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(dir);
  seedTables(db);
  let open, list;
  registerOrders({ handle(_channel, fn) { open = fn; } }, () => true, db, { currentUserId: () => 1 });
  registerTables({ handle(_channel, fn) { list = fn; } }, () => true, db, { currentUserId: () => 1 });
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
