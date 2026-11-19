const { removeFiscalSchemaSql } = require('./support/historical-database');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDatabase } = require('../src/desktop/database');
const { createBackup, restoreBackup } = require('../src/desktop/backup');
const { authorizedDatabase } = require('./support/authorized-database');
const { seedTables } = require('../src/desktop/tables');
const { seedMenu } = require('../src/desktop/menu');
const { registerOrders } = require('../src/desktop/orders');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerBills } = require('../src/desktop/bills');
const { registerPayments } = require('../src/desktop/payments');
const { registerLegacyOrderAssignment } = require('../src/desktop/legacy-order-assignment');
const { registerPrintJobs } = require('../src/desktop/print-jobs');
const printing = require('../src/desktop/test-printing');
const { registerOrderHistory } = require('../src/desktop/order-history');
const { recordAudit } = require('../src/desktop/audit');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-ownership-independent-'));
  const live = path.join(root, 'live'); fs.mkdirSync(live);
  let db = authorizedDatabase(openDatabase(live)), actor = 1, authenticated = 1, handlers;
  seedTables(db); seedMenu(db);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash,pin_salt,pin_hash) VALUES
    (2,'waiter-two',x'01',x'01',x'01',x'01'),(3,'combined',x'01',x'01',NULL,NULL),
    (4,'scoped',x'01',x'01',NULL,NULL),(5,'inactive',x'01',x'01',x'01',x'01');
    UPDATE local_users SET active=0 WHERE id=5;
    INSERT INTO financial_scopes VALUES(2,'waiter'),(3,'combined'),(4,'A'),(5,'waiter');
    INSERT INTO user_permissions VALUES(2,'tables.view'),(2,'orders.view'),(2,'orders.change'),
      (3,'orders.correct_sent'),(4,'orders.correct_sent'),
      (1,'employees.view'),(2,'employees.view'),(3,'employees.view'),(4,'employees.view');`);
  const event = {};
  function register() {
    handlers = {};
    const ipc = {handle: (name, handler) => { handlers[name] = handler; }};
    const session = {currentUserId: () => actor, authenticatedUserId: () => authenticated};
    for (const fn of [registerOrders, registerOrderItems, registerBills, registerPayments, registerLegacyOrderAssignment, registerPrintJobs, registerOrderHistory]) fn(ipc, e => e === event, db, session);
    printing.registerTestPrinting(ipc, e => e === event, db, session, () => 'accepted', true);
  }
  register();
  t.after(() => { db.close(); fs.rmSync(root, {recursive:true, force:true}); });
  return {
    root, live, db: () => db,
    call: (name, req, sender = event) => handlers['arra:' + name](sender, req),
    as: (id, auth = id) => { actor = id; authenticated = auth; },
    use: dir => { db.close(); db = openDatabase(dir); register(); },
    upgrade: () => { db.exec(removeFiscalSchemaSql + 'DROP TABLE legacy_unassigned_orders; DROP TABLE order_waiter_ownership; PRAGMA user_version=42'); db.close(); db = openDatabase(live); register(); }
  };
}

test('legacy assignment is explicit, role restricted, durable and survives backup restore', async t => {
  const f = fixture(t), call = f.call;
  const order = call('open-order', {tableId:1}).data.id;
  assert.equal(call('order-items', {action:'add',orderId:order,productId:'qebapa'}).ok, true);
  const before = f.db().prepare('SELECT id,order_id,product_id,name,quantity,status FROM order_items WHERE order_id=?').all(order);
  f.upgrade();
  const assignment = {action:'assign',orderId:order,waiterId:2};
  assert.equal(call('order-items', {action:'list',orderId:order}).ok, false);
  for (const id of [1,2,4,5]) { f.as(id); assert.equal(call('legacy-order-assignment', assignment).ok, false); }
  f.as(3,1); assert.equal(call('legacy-order-assignment', assignment).ok, false);
  f.as(3); assert.equal(call('legacy-order-assignment', assignment, {}).ok, false);
  assert.equal(call('legacy-order-assignment', {...assignment,waiterId:5}).ok, false);
  assert.equal(call('legacy-order-assignment', assignment).ok, true);
  assert.equal(call('legacy-order-assignment', assignment).ok, true);
  assert.equal(call('legacy-order-assignment', {...assignment,waiterId:1}).ok, false);
  const audit = f.db().prepare("SELECT actor_id,order_id,context FROM application_audit WHERE action='assign_legacy_waiter'").all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_id, 3);
  assert.deepEqual(f.db().prepare('SELECT id,order_id,product_id,name,quantity,status FROM order_items WHERE order_id=?').all(order), before);
  assert.throws(() => f.db().prepare('UPDATE order_waiter_ownership SET waiter_id=1 WHERE order_id=?').run(order));
  assert.throws(() => f.db().prepare('DELETE FROM order_waiter_ownership WHERE order_id=?').run(order));
  assert.throws(() => f.db().prepare("INSERT OR REPLACE INTO order_waiter_ownership VALUES(?,1,3,1,'legacy')").run(order));
  const backup = path.join(f.root,'sample.enc'), restored = path.join(f.root,'restored');
  fs.mkdirSync(restored);
  const phrase = crypto.randomBytes(24).toString('hex');
  await createBackup(f.live, backup, phrase);
  restoreBackup(backup, restored, phrase);
  f.use(restored);
  assert.equal(f.db().prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(f.db().prepare('PRAGMA foreign_key_check').all(), []);
  assert.deepEqual(f.db().prepare('SELECT id,order_id,product_id,name,quantity,status FROM order_items WHERE order_id=?').all(order), before);
  assert.deepEqual(f.db().prepare("SELECT actor_id,order_id,context FROM application_audit WHERE action='assign_legacy_waiter'").all(), audit);
  f.as(1); assert.equal(call('open-order',{tableId:1}).ok,false);
  f.as(2); assert.equal(call('open-order',{tableId:1}).data.id,order);
  assert.equal(call('order-items',{action:'list',orderId:order}).ok,true);
});

test('direct order history and moved-item events respect waiter ownership while Combined retains access', t => {
  const f = fixture(t), call = f.call;
  const first = call('open-order',{tableId:1}).data.id;
  const item = call('order-items',{action:'add',orderId:first,productId:'qebapa'}).data.items[0].id;
  f.as(2);
  const second = call('open-order',{tableId:2}).data.id;
  assert.equal(call('order-items',{action:'add',orderId:second,productId:'qebapa'}).ok,true);
  // Earlier versions allowed item moves between shared orders. Preserve that
  // history but do not reveal the former order's events to its new owner.
  f.db().prepare('UPDATE order_items SET order_id=? WHERE id=?').run(second,item);
  recordAudit(f.db(),1,'move_items','order',first,first,{sourceId:1,destinationId:2,destinationOrderId:second,itemIds:[item]});
  assert.equal(call('order-history',{orderId:first}).ok,false);
  assert.deepEqual(call('order-history',{orderId:null}).data.orders.map(row=>row.id),[second]);
  const history = call('order-history',{orderId:second});
  assert.equal(history.ok,true);
  assert.ok(history.data.items.some(row=>row.id===item));
  assert.ok(history.data.events.every(row=>row.orderId===second));
  assert.equal(call('order-history',{orderId:second},{}).ok,false);
  f.as(1);
  assert.equal(call('order-history',{orderId:second}).ok,false);
  assert.deepEqual(call('order-history',{orderId:null}).data.orders.map(row=>row.id),[first]);
  f.as(3);
  assert.deepEqual(call('order-history',{orderId:null}).data.orders.map(row=>row.id),[second,first]);
  assert.equal(call('order-history',{orderId:first}).ok,true);
  assert.equal(call('order-history',{orderId:second}).ok,true);
});

test('legacy committed payment retry is limited to payer and identical method/account across restart', t => {
  const f = fixture(t), call = f.call;
  const order = call('open-order',{tableId:1}).data.id;
  assert.equal(call('order-items',{action:'add',orderId:order,productId:'qebapa'}).ok,true);
  assert.equal(call('order-items',{action:'send',orderId:order,requestId:'send'}).ok,true);
  const review = call('bill',{action:'review',orderId:order}).data;
  const bill = call('bill',{action:'generate',orderId:order,fingerprint:review.fingerprint}).data;
  const payment = {billId:bill.id,method:'cash',account:'A'};
  const original = call('payment',payment); assert.equal(original.ok,true);
  f.upgrade(); f.use(f.live);
  f.as(2); assert.equal(call('payment',payment).ok,false);
  f.as(1);
  assert.equal(call('payment',{...payment,account:'B'}).ok,false);
  assert.equal(call('payment',{...payment,method:'card'}).ok,false);
  assert.deepEqual(call('payment',payment),original);
  assert.deepEqual(call('payment',payment),original);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM payments').get().n,1);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM order_waiter_ownership WHERE order_id=?').get(order).n,0);
  assert.equal(call('bill',{action:'review',orderId:order}).ok,false);
});

test('committed send replays after payment or retirement only for its owner without duplicate rounds', t => {
  const f = fixture(t), call = f.call;
  const paid = call('open-order',{tableId:1}).data.id;
  assert.equal(call('order-items',{action:'add',orderId:paid,productId:'qebapa'}).ok,true);
  const send = {action:'send',orderId:paid,requestId:'paid-send'};
  assert.equal(call('order-items',send).ok,true);
  const review = call('bill',{action:'review',orderId:paid}).data;
  const bill = call('bill',{action:'generate',orderId:paid,fingerprint:review.fingerprint}).data;
  assert.equal(call('payment',{billId:bill.id,method:'cash',account:'A'}).ok,true);
  const empty = call('open-order',{tableId:2}).data.id;
  const item = call('order-items',{action:'add',orderId:empty,productId:'qebapa'}).data.items[0].id;
  const retiredSend = {action:'send',orderId:empty,requestId:'retired-send'};
  assert.equal(call('order-items',retiredSend).ok,true);
  assert.equal(call('order-items',{action:'correct',orderId:empty,itemId:item,quantity:1,reason:'sample',requestId:'correct'}).ok,true);
  f.as(2);
  assert.notEqual(call('open-order',{tableId:2}).data.id,empty);
  assert.equal(f.db().prepare('SELECT retired_empty FROM orders WHERE id=?').get(empty).retired_empty,1);
  f.use(f.live);
  for (const req of [send,retiredSend]) assert.equal(call('order-items',req).ok,false);
  f.as(1);
  for (const req of [send,retiredSend]) {
    assert.equal(call('order-items',req,{}).ok,false);
    assert.equal(call('order-items',req).ok,true);
    assert.equal(call('order-items',req).ok,true);
    assert.equal(call('order-items',{...req,requestId:'new-'+req.requestId}).ok,false);
  }
  assert.equal(call('order-items',{...send,orderId:empty}).ok,false);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM preparation_rounds').get().n,2);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM preparation_tickets').get().n,2);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM print_attempts').get().n,2);
  assert.equal(f.db().prepare("SELECT count(*) AS n FROM application_audit WHERE action='send'").get().n,2);
});

test('completed shared legacy order exposes each failed preparation job only to its recorded sender', async t => {
  const f = fixture(t), call = f.call;
  assert.equal(call('print-jobs',{action:'simulate',destination:'kitchen',result:'failed'}).ok,true);
  const order = call('open-order',{tableId:1}).data.id;
  for (const requestId of ['round-one','round-two']) {
    assert.equal(call('order-items',{action:'add',orderId:order,productId:'qebapa'}).ok,true);
    assert.equal(call('order-items',{action:'send',orderId:order,requestId}).ok,true);
  }
  // Synthetic pre-upgrade history: the second round was sent by another waiter.
  f.db().prepare("UPDATE preparation_rounds SET actor_id=2 WHERE request_id='round-two'").run();
  const rows = f.db().prepare('SELECT r.actor_id, j.id AS job, t.id AS ticket FROM print_jobs j JOIN preparation_tickets t ON t.id=j.ticket_id JOIN preparation_rounds r ON r.id=t.round_id ORDER BY r.number').all();
  const realJobs = rows.map(row => {
    const job = printing.createPreparationJob(f.db(),row.ticket);
    printing.reserveAttempt(f.db(),job,'pre-upgrade-'+job,row.actor_id);
    return job;
  });
  const review = call('bill',{action:'review',orderId:order}).data;
  const bill = call('bill',{action:'generate',orderId:order,fingerprint:review.fingerprint}).data;
  assert.equal(call('payment',{billId:bill.id,method:'cash',account:'A'}).ok,true);
  f.upgrade(); f.use(f.live);
  for (const [actor, own, other] of [[1,0,1],[2,1,0]]) {
    f.as(actor);
    assert.deepEqual(call('print-jobs',{action:'list'}).data.jobs.map(job=>job.id),[rows[own].job]);
    assert.deepEqual(call('test-printing',{action:'list'}).data.jobs.map(job=>job.id),[realJobs[own]]);
    assert.equal(call('print-jobs',{action:'retry',jobId:rows[other].job,requestId:'foreign-'+actor}).ok,false);
    assert.equal(call('test-printing',{action:'retry',jobId:realJobs[other],requestId:'foreign-'+actor,checked:true}).ok,false);
    assert.equal(call('print-jobs',{action:'retry',jobId:rows[own].job,requestId:'own-'+actor}).ok,true);
    assert.equal(call('test-printing',{action:'retry',jobId:realJobs[own],requestId:'own-'+actor,checked:false}).ok,false);
    assert.equal(call('test-printing',{action:'retry',jobId:realJobs[own],requestId:'own-'+actor,checked:true}).ok,true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(call('test-printing',{action:'retry',jobId:realJobs[own],requestId:'own-'+actor,checked:true}).ok,true);
  }
  assert.equal(f.db().prepare("SELECT count(*) AS n FROM test_print_attempts WHERE request_id LIKE 'retry-own-%'").get().n,2);
});
