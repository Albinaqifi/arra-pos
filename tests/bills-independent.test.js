const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { authorizedDatabase } = require('./support/authorized-database');
const { seedTables } = require('../src/desktop/tables');
const { seedMenu } = require('../src/desktop/menu');
const { registerBills } = require('../src/desktop/bills');

test('audit failure leaves no bill or lines and the same review can be retried', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-bill-independent-'));
  const db = authorizedDatabase(openDatabase(dir));
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  seedTables(db); seedMenu(db);
  db.exec("INSERT INTO orders (id,table_id,opened_at,status) VALUES (1,1,1,'open'); INSERT INTO order_items (id,order_id,product_id,name,unit_price,quantity,status) VALUES (1,1,'qebapa','Sample',100,2,'sent');");
  let handle;
  registerBills({ handle(_channel, callback) { handle = callback; } }, () => true, db, { currentUserId: () => 1, authenticatedUserId: () => 1 });
  const preview = handle({}, { action: 'review', orderId: 1 }).data;
  const request = { action: 'generate', orderId: 1, fingerprint: preview.fingerprint };
  db.exec("CREATE TRIGGER fail_bill_audit BEFORE INSERT ON application_audit BEGIN SELECT RAISE(ABORT,'failure'); END");
  assert.equal(handle({}, request).ok, false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM bills').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM bill_lines').get().n, 0);
  db.exec('DROP TRIGGER fail_bill_audit');
  assert.equal(handle({}, request).ok, true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM bills').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM bill_lines').get().n, 1);
});

test('version 19 upgrade preserves an open order and corrections for billing', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-bill-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = authorizedDatabase(openDatabase(dir));
  seedTables(db); seedMenu(db);
  db.exec("INSERT INTO orders (id,table_id,opened_at,status) VALUES (1,1,1,'open'); INSERT INTO order_items (id,order_id,product_id,name,unit_price,quantity,status) VALUES (1,1,'qebapa','Old snapshot',100,3,'sent'); INSERT INTO order_item_modifiers VALUES (1,'Size','Large',10); INSERT INTO sent_item_corrections (request_id,item_id,order_id,actor_id,quantity,reason,occurred_at) VALUES ('old-correction',1,1,1,1,'Sample',1);");
  // Migration 20 only adds these tables and triggers; removing them recreates
  // the populated version 19 schema before reopening through the migrator.
  db.exec(`DROP TRIGGER billed_item_insert; DROP TRIGGER billed_item_update; DROP TRIGGER billed_item_delete;
    DROP TRIGGER billed_correction; DROP TRIGGER billed_order_move; DROP TRIGGER bills_no_update;
    DROP TRIGGER bills_no_delete; DROP TRIGGER bill_lines_no_update; DROP TRIGGER bill_lines_no_delete;
    DROP TABLE payments; DROP TABLE bill_lines; DROP TABLE bills; DROP TABLE IF EXISTS financial_scopes; PRAGMA user_version = 19;`);
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('SELECT count(*) AS n FROM financial_scopes').get().n, 0);
  db.exec("INSERT INTO financial_scopes SELECT id, 'waiter' FROM local_users");
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 22);
    assert.equal(db.prepare('SELECT name FROM order_items WHERE id=1').get().name, 'Old snapshot');
    assert.equal(db.prepare('SELECT quantity FROM sent_item_corrections WHERE request_id=?').get('old-correction').quantity, 1);
    let handle;
    registerBills({ handle(_channel, callback) { handle = callback; } }, () => true, db, { currentUserId: () => 1, authenticatedUserId: () => 1 });
    const review = handle({}, { action: 'review', orderId: 1 });
    assert.equal(review.ok, true);
    assert.equal(review.data.total, 200);
    assert.equal(review.data.lines[0].quantity, 2);
    assert.equal(review.data.lines[0].modifiers[0].optionName, 'Large');
    const generated = handle({}, { action: 'generate', orderId: 1, fingerprint: review.data.fingerprint });
    assert.equal(generated.ok, true);
    assert.equal(db.prepare('SELECT total FROM bills').get().total, 200);
    assert.equal(db.prepare('SELECT quantity FROM bill_lines').get().quantity, 2);
  } finally { db.close(); }
});
