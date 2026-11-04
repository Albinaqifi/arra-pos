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

test('order item boundaries and failed total changes preserve both orders', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-items-independent-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  seedTables(db); seedMenu(db);
  db.exec("INSERT INTO orders (id, table_id, opened_at, status) VALUES (1, 1, 1, 'open'), (2, 2, 1, 'open')");
  let invoke;
  registerOrderItems({ handle(_channel, handler) { invoke = handler; } }, () => true, db, { currentUserId: () => 1, authenticatedUserId: () => 1 });
  const call = request => invoke({}, request);
  const add = (orderId, productId) => call({ action: 'add', orderId, productId });
  const list = orderId => call({ action: 'list', orderId }).data;
  const item = add(1, 'qebapa').data.items[0];
  for (const action of ['increment', 'decrement', 'remove'])
    assert.equal(call({ action, orderId: 2, itemId: item.id }).ok, false);
  assert.equal(list(1).total, 220);
  assert.equal(list(2).total, 0);
  db.exec("UPDATE menu_categories SET active = 0 WHERE id = 'food'");
  assert.equal(add(2, 'shopska').ok, false);
  db.exec("UPDATE menu_products SET price = 9007199254740991 WHERE id = 'cola'");
  assert.equal(add(1, 'cola').ok, false);
  assert.equal(list(1).items.length, 1);
  assert.equal(list(1).total, 220);
  db.exec("UPDATE order_items SET status = 'sent' WHERE id = " + item.id);
  for (const action of ['increment', 'decrement', 'remove'])
    assert.equal(call({ action, orderId: 1, itemId: item.id }).ok, false);
  assert.equal(list(1).total, 220);
});
