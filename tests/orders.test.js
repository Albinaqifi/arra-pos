const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { seedTables, registerTables } = require('../src/desktop/tables');
const { registerOrders } = require('../src/desktop/orders');

test('opening is persistent, idempotent, validated and reflected in table state', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-orders-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = openDatabase(dir); seedTables(db);
  const trusted = {}; let open, list;
  const register = () => {
    registerOrders({ handle(_c, fn) { open = fn; } }, e => e === trusted, db);
    registerTables({ handle(_c, fn) { list = fn; } }, e => e === trusted, db);
  };
  register();
  for (const request of [null, [], {}, { tableId: 0 }, { tableId: 1, extra: 1 }, { tableId: '1' }])
    assert.equal(open(trusted, request).ok, false);
  assert.equal(open({}, { tableId: 1 }).ok, false);
  assert.equal(open(trusted, { tableId: 99 }).ok, false);
  const first = { ...open(trusted, { tableId: 1 }).data };
  assert.deepEqual({ ...open(trusted, { tableId: 1 }).data }, first);
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 1);
  assert.throws(() => db.prepare("INSERT INTO orders (table_id, opened_at, status) VALUES (1, 1, 'open')").run());
  db.close(); db = openDatabase(dir); register();
  assert.deepEqual({ ...open(trusted, { tableId: 1 }).data }, first);
  const rows = list(trusted, {}).data;
  assert.equal(rows[0].orderId, first.id);
  assert.equal(rows[1].orderId, null);
  db.close();
  assert.equal(open(trusted, { tableId: 1 }).ok, false);
});
