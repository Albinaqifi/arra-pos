const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { registerActivityReport } = require('../src/desktop/activity-report');

// Isolated future-shape fixture: production still has a unique order_id on bills.
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE local_users(id INTEGER PRIMARY KEY, username TEXT, active INTEGER);
    CREATE TABLE financial_scopes(user_id INTEGER, scope TEXT);
    CREATE TABLE user_permissions(user_id INTEGER, permission TEXT);
    CREATE TABLE transfer_managers(user_id INTEGER);
    CREATE TABLE orders(id INTEGER PRIMARY KEY, table_id INTEGER);
    CREATE TABLE order_items(id INTEGER PRIMARY KEY, name TEXT, unit_price INTEGER);
    CREATE TABLE sent_item_corrections(id INTEGER PRIMARY KEY, order_id INTEGER, item_id INTEGER, actor_id INTEGER, occurred_at INTEGER, reason TEXT, quantity INTEGER);
    CREATE TABLE application_audit(actor_id INTEGER, occurred_at INTEGER, action TEXT, entity_type TEXT, entity_id TEXT, order_id INTEGER, context TEXT);
    CREATE TABLE order_cancellations(order_id INTEGER, actor_id INTEGER, occurred_at INTEGER, reason TEXT, items TEXT);
    CREATE TABLE bills(id INTEGER PRIMARY KEY, order_id INTEGER);
    CREATE TABLE payments(id INTEGER PRIMARY KEY, bill_id INTEGER, actor_id INTEGER, paid_at INTEGER, amount INTEGER, method TEXT, account TEXT);
    CREATE TABLE payment_account_corrections(id INTEGER PRIMARY KEY, payment_id INTEGER);
    INSERT INTO local_users VALUES(1,'A owner',1),(2,'B owner',1),(3,'Combined',1),(4,'Waiter',1);
    INSERT INTO financial_scopes VALUES(1,'A'),(2,'B'),(3,'combined'),(4,'waiter');
    INSERT INTO user_permissions VALUES(1,'employees.view'),(2,'employees.view'),(3,'employees.view');
    INSERT INTO orders VALUES(1,1),(2,2);
    INSERT INTO order_items VALUES(1,'Sample',100),(2,'Second',200);
    INSERT INTO sent_item_corrections VALUES(1,1,1,4,100,'sample',1),(2,2,2,4,100,'sample',1);
  `);
  let actor = 1, handler;
  registerActivityReport({handle: (_, fn) => handler = fn}, () => true, db,
    {currentUserId: () => actor, authenticatedUserId: () => actor});
  const call = (who, action = 'cancellations') => {
    actor = who;
    return handler({}, { action, from: 90, to: 120, staffId: action === 'performance' ? 4 : null });
  };
  const bill = (id, order, account) => {
    db.prepare('INSERT INTO bills VALUES(?,?)').run(id, order);
    if (account) db.prepare("INSERT INTO payments VALUES(?,?,4,110,100,'cash',?)").run(id, id, account);
  };
  return {db, call, bill};
}

test('restricted activity checks every bill regardless of insertion order', t => {
  for (const accounts of [['A','B'], ['B','A'], [null,'B'], ['B',null]]) {
    const {call,bill} = fixture(t);
    bill(1,1,accounts[0]); bill(2,1,accounts[1]);
    assert.deepEqual(call(1).data.cancellations, [], JSON.stringify(accounts));
    if (accounts.includes('A')) assert.deepEqual(call(2).data.cancellations, [], JSON.stringify(accounts));
    assert.deepEqual(call(3).data.cancellations.map(c => c.orderId), [1,2]);
  }
});

test('effective account, linked orders, and missing bills govern correction visibility', t => {
  const {db,call,bill} = fixture(t);
  bill(1,1,'A'); bill(2,1,'B'); bill(3,2,null);
  db.prepare("INSERT INTO application_audit VALUES(4,1,'move_items','order','1',1,?)")
    .run(JSON.stringify({destinationOrderId:2,itemIds:[1]}));
  assert.deepEqual(call(1).data.cancellations, []);
  assert.deepEqual(call(2).data.cancellations, []);
  db.exec('INSERT INTO payment_account_corrections VALUES(1,2)');
  assert.deepEqual(call(1).data.cancellations.map(c => c.orderId), [1,2]);
  assert.deepEqual(call(2).data.cancellations, []);
  assert.deepEqual(call(3).data.cancellations.map(c => c.orderId), [1,2]);
  const report = call(1,'performance');
  assert.equal(report.ok,true);
  assert.deepEqual([report.data.total,report.data.payments,report.data.orders,report.data.quantity,report.data.value], [200,2,1,2,300]);
});

test('a connected order without any bill remains hidden from restricted owners', t => {
  const {db,call,bill} = fixture(t);
  bill(1,1,'A');
  db.prepare("INSERT INTO application_audit VALUES(4,1,'move_items','order','1',1,?)")
    .run(JSON.stringify({destinationOrderId:2,itemIds:[1]}));
  assert.deepEqual(call(1).data.cancellations, []);
  assert.deepEqual(call(3).data.cancellations.map(c => c.orderId), [1,2]);
});
