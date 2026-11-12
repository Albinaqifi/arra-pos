const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { authorizedDatabase } = require('./support/authorized-database');
const { seedTables } = require('../src/desktop/tables');
const { registerPayments } = require('../src/desktop/payments');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-payment-'));
  const db = authorizedDatabase(openDatabase(dir)); seedTables(db);
  db.exec("INSERT INTO orders (id,table_id,opened_at,status) VALUES (1,1,1,'open'),(2,2,1,'open'),(3,3,1,'open'); INSERT INTO bills (id,order_id,actor_id,generated_at,total,fingerprint) VALUES (1,1,1,1,1250,'one'),(2,2,1,1,500,'two'),(3,3,1,1,0,'three');");
  const trusted = {}; let call;
  registerPayments({ handle(_channel, fn) { call = fn; } }, e => e === trusted, db, { currentUserId: () => 1, authenticatedUserId: () => 1 });
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { db, call: request => call(trusted, request), untrusted: request => call({}, request) };
}

test('payments enforce direct requests, full amounts, classification, retry, and immutable history', t => {
  const { db, call, untrusted } = setup(t);
  const req = { billId: 1, method: 'card', account: 'A' };
  assert.equal(untrusted(req).ok, false);
  for (const bad of [{ ...req, account: 'B' }, { ...req, amount: 1 }, { ...req, method: 'other' }, { ...req, billId: 99 }]) assert.equal(call(bad).ok, false);
  db.prepare("DELETE FROM user_permissions WHERE user_id=1 AND permission='orders.change'").run();
  assert.equal(call(req).error, 'Access denied');
  db.prepare("INSERT INTO user_permissions VALUES (1,'orders.change')").run();
  const first = call(req); assert.equal(first.ok, true);
  assert.deepEqual(call(req), first);
  assert.equal(call({ ...req, method: 'cash' }).ok, false);
  assert.deepEqual({ ...db.prepare('SELECT amount,method,account FROM payments WHERE bill_id=1').get() }, { amount: 1250, method: 'card', account: 'A' });
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=1').get().status, 'completed');
  assert.equal(db.prepare('SELECT count(*) n FROM application_audit WHERE entity_type=\'payment\'').get().n, 1);
  assert.throws(() => db.exec("UPDATE payments SET account='B'"));
  assert.throws(() => db.exec('DELETE FROM payments'));
  assert.throws(() => db.exec("INSERT INTO payments (bill_id,actor_id,paid_at,amount,method,account) VALUES (2,1,1,500,'card','B')"));
  assert.throws(() => db.exec("INSERT INTO payments (bill_id,actor_id,paid_at,amount,method,account) VALUES (2,1,1,1,'cash','A')"));
  assert.equal(call({ billId: 2, method: 'cash', account: 'B' }).ok, true);
  assert.equal(call({ billId: 3, method: 'cash', account: 'A' }).ok, true);
});

test('transaction failure rolls payment, order closure, and audit back together', t => {
  const { db, call } = setup(t);
  db.exec("CREATE TRIGGER fail_payment_audit BEFORE INSERT ON application_audit WHEN NEW.entity_type='payment' BEGIN SELECT RAISE(ABORT,'fail'); END;");
  const req = { billId: 1, method: 'cash', account: 'A' };
  assert.equal(call(req).ok, false);
  assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n, 0);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=1').get().status, 'open');
  db.exec('DROP TRIGGER fail_payment_audit'); assert.equal(call(req).ok, true);
});

test('version 20 upgrades without changing existing bills and orders', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-payment-upgrade-'));
  let db = authorizedDatabase(openDatabase(dir)); seedTables(db);
  db.exec("INSERT INTO orders (id,table_id,opened_at,status) VALUES (1,1,1,'open'); INSERT INTO bills (id,order_id,actor_id,generated_at,total,fingerprint) VALUES (1,1,1,1,123,'saved'); DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE payments; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payment_business_days; DROP TABLE IF EXISTS business_days; DROP TABLE IF EXISTS financial_scopes; DROP INDEX one_open_order_per_table; ALTER TABLE orders DROP COLUMN retired_empty; CREATE UNIQUE INDEX one_open_order_per_table ON orders(table_id) WHERE status=char(111,112,101,110); DROP TABLE IF EXISTS test_print_results; DROP TABLE IF EXISTS test_print_attempts; DROP TABLE IF EXISTS test_print_jobs; DROP TABLE IF EXISTS test_printer_queues; DROP TABLE IF EXISTS day_print_settings; DROP TABLE IF EXISTS day_print_results; DROP TABLE IF EXISTS day_print_attempts; DROP TABLE IF EXISTS day_print_jobs; DROP TABLE IF EXISTS pending_staff; PRAGMA user_version=20;");
  db.close(); db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 30);
  assert.equal(db.prepare('SELECT total FROM bills WHERE id=1').get().total, 123);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=1').get().status, 'open');
  assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n, 0);
  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
