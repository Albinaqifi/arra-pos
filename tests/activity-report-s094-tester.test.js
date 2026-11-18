const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { registerActivityReport } = require('../src/desktop/activity-report');

// Deliberately permits multiple bills per order without altering production migrations.
function setup(t) {
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
    INSERT INTO local_users VALUES(1,'A',1),(2,'B',1),(3,'Combined',1),(4,'Waiter',1);
    INSERT INTO financial_scopes VALUES(1,'A'),(2,'B'),(3,'combined'),(4,'waiter');
    INSERT INTO user_permissions VALUES(1,'employees.view'),(2,'employees.view'),(3,'employees.view');
    INSERT INTO orders VALUES(1,1),(2,2);
    INSERT INTO order_items VALUES(1,'Example',125),(2,'Example two',200);
    INSERT INTO sent_item_corrections VALUES(1,1,1,4,100,'sample',1),(2,2,2,4,100,'sample',1);
    INSERT INTO bills VALUES(1,1),(2,1),(3,2);
    INSERT INTO payments VALUES(1,1,4,110,125,'cash','A'),(2,2,4,200,200,'cash','B');
    INSERT INTO application_audit VALUES(4,1,'move_items','order','1',1,'{"destinationOrderId":2}');
  `);
  let current = 1, authenticated = 1, handler;
  registerActivityReport({handle: (_, fn) => handler = fn}, event => event.allowed, db,
    {currentUserId: () => current, authenticatedUserId: () => authenticated});
  return {db, select: (a, b = a) => { current = a; authenticated = b; },
    call: (request, allowed = true) => handler({allowed}, request)};
}

test('connected mixed-account history is hidden even when the outside payment is outside the report dates', t => {
  const {db,select,call} = setup(t);
  const req = {action:'performance',from:90,to:120,staffId:4};
  select(1);
  let result = call(req);
  assert.equal(result.ok, true);
  assert.deepEqual([result.data.total,result.data.payments,result.data.orders], [125,1,1]);
  assert.deepEqual([result.data.quantity,result.data.value,result.data.cancellations.length], [0,0,0]);
  select(2);
  result = call(req);
  assert.deepEqual([result.data.total,result.data.payments,result.data.quantity,result.data.value], [0,0,0,0]);
  select(3);
  result = call(req);
  assert.deepEqual([result.data.total,result.data.payments,result.data.quantity,result.data.value], [125,1,2,325]);
  assert.deepEqual(result.data.cancellations.map(row => row.orderId), [1,2]);
  db.exec('INSERT INTO payment_account_corrections VALUES(1,2)');
  select(1);
  result = call(req);
  assert.deepEqual([result.data.quantity,result.data.value], [2,325]);
  select(2);
  assert.equal(call(req).data.cancellations.length, 0);
});

test('direct requests reject untrusted callers and malformed connected history fails closed', t => {
  const {db,select,call} = setup(t);
  const req = {action:'cancellations',from:90,to:120,staffId:null};
  assert.deepEqual(call(req, false), {ok:false});
  assert.deepEqual(call({...req,extra:true}), {ok:false});
  select(4); assert.deepEqual(call(req), {ok:false});
  select(1,2); assert.deepEqual(call(req), {ok:false});
  select(1); db.exec("DELETE FROM user_permissions WHERE user_id=1 AND permission='employees.view'");
  assert.deepEqual(call(req), {ok:false});
  db.exec("INSERT INTO user_permissions VALUES(1,'employees.view'); UPDATE application_audit SET context='{}'");
  assert.deepEqual(call(req), {ok:false});
});
