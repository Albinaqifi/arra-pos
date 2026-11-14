const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../src/desktop/database');
const { bootstrap, createSession } = require('../src/desktop/session');
const { registerTables, seedTables } = require('../src/desktop/tables');
const { registerMenu, seedMenu } = require('../src/desktop/menu');
const { registerOrders } = require('../src/desktop/orders');
const { registerOrderItems } = require('../src/desktop/order-items');
const entryFixture = require('./entry-fixture');

test('each direct boundary rejects an untrusted sender and grant lookup fails closed', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-permission-check-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  bootstrap(db, 'sample', 'sample password'); db.exec("UPDATE financial_scopes SET scope='waiter' WHERE user_id=1; DELETE FROM user_permissions WHERE user_id=1 AND permission='business_days.close'"); seedTables(db); seedMenu(db);
  const entry = entryFixture(db);
  const session = createSession(db);
  assert.equal(session.signIn({ username: 'sample restaurant', password: entry.password }).ok, true);
  assert.equal(session.selectWaiter({ id: 1, pin: entry.pin }).ok, true);
  const handlers = {}; const trusted = {};
  for (const register of [registerTables, registerMenu, registerOrders, registerOrderItems])
    register({ handle: (channel, fn) => { handlers[channel] = fn; } }, event => event === trusted, db, session);
  const requests = [['tables', {}], ['menu', {}], ['open-order', { tableId: 1 }],
    ['order-items', { action: 'list', orderId: 1 }]];
  for (const [channel, request] of requests) assert.equal(handlers['arra:' + channel]({}, request).ok, false, channel);
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 0);
  db.exec('DROP TABLE user_permissions');
  for (const [channel, request] of requests) assert.equal(handlers['arra:' + channel](trusted, request).ok, false, channel);
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 0);
});

test('failed version 9 migration rolls back and preserves existing order data', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-permission-rollback-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = openDatabase(dir); bootstrap(db, 'sample', 'sample password'); db.exec("UPDATE financial_scopes SET scope='waiter' WHERE user_id=1; DELETE FROM user_permissions WHERE user_id=1 AND permission='business_days.close'"); seedTables(db);
  db.prepare("INSERT INTO orders (table_id, opened_at, status) VALUES (1, 123, 'open')").run();
  db.exec('DROP TABLE IF EXISTS order_cancellations; DROP TABLE IF EXISTS restaurant_accounts; DROP TRIGGER IF EXISTS billed_item_insert; DROP TRIGGER IF EXISTS billed_item_update; DROP TRIGGER IF EXISTS billed_item_delete; DROP TRIGGER IF EXISTS billed_correction; DROP TRIGGER IF EXISTS billed_order_move; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS bill_lines; DROP TABLE IF EXISTS bills; DROP TABLE IF EXISTS sent_item_corrections; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payment_business_days; DROP TABLE IF EXISTS business_days; DROP TABLE IF EXISTS financial_scopes; DROP INDEX one_open_order_per_table; ALTER TABLE orders DROP COLUMN retired_empty; CREATE UNIQUE INDEX one_open_order_per_table ON orders(table_id) WHERE status=char(111,112,101,110); DROP TABLE IF EXISTS test_print_results; DROP TABLE IF EXISTS test_print_attempts; DROP TABLE IF EXISTS test_print_jobs; DROP TABLE IF EXISTS test_printer_queues; DROP TABLE IF EXISTS day_print_settings; DROP TABLE IF EXISTS day_print_results; DROP TABLE IF EXISTS day_print_attempts; DROP TABLE IF EXISTS day_print_jobs; DROP TABLE IF EXISTS pending_staff; PRAGMA user_version = 8'); db.close();
  assert.throws(() => openDatabase(dir));
  db = new DatabaseSync(path.join(dir, 'arra.sqlite'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 8);
  assert.equal(db.prepare('SELECT opened_at FROM orders WHERE table_id = 1').get().opened_at, 123);
  assert.equal(db.prepare('SELECT count(*) AS n FROM user_permissions').get().n, 9);
  db.close();
});
