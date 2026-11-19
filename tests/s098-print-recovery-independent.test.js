const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { authorizedDatabase } = require('./support/authorized-database');
const { openDatabase } = require('../src/desktop/database');
const { seedTables } = require('../src/desktop/tables');
const { seedMenu } = require('../src/desktop/menu');
const { registerOrders } = require('../src/desktop/orders');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerOrderHistory } = require('../src/desktop/order-history');
const { registerBills } = require('../src/desktop/bills');
const { registerPayments } = require('../src/desktop/payments');
const { createTrainingPf700 } = require('../src/desktop/training-pf700');
const { selectPreparationPrinting } = require('../src/desktop/preparation-printing');
const { registerTestPrinting } = require('../src/desktop/test-printing');

const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-s098-independent-'));
  const db = authorizedDatabase(openDatabase(directory));
  t.after(() => { db.close(); fs.rmSync(directory, {recursive:true, force:true}); });
  seedTables(db);
  seedMenu(db);
  db.exec(`UPDATE menu_products SET destination='bar' WHERE id='espresso';
    INSERT INTO menu_product_fiscal_origin SELECT id,1 FROM menu_products`);
  let actor = 1;
  const session = {currentUserId:() => actor, authenticatedUserId:() => actor};
  const handlers = new Map(), event = {};
  const registration = [{handle:(name, handler) => handlers.set(name,handler)}, e => e === event, db, session];
  const call = (name, req) => handlers.get('arra:' + name)(event,req);
  const ok = (name, req) => {
    const reply = call(name,req);
    assert.equal(reply.ok,true,name + ' ' + (req.action || ''));
    return reply.data;
  };
  registerOrders(...registration);
  const orderId = ok('open-order',{tableId:1}).id;
  return {directory, db, registration, call, ok, orderId, switchWaiter(id) { actor = id; }};
}

test('a pre-upgrade PF700 simulator cancellation cannot produce Windows output after a mode change', async t => {
  const {db, registration, ok, call, orderId} = fixture(t);
  // Before S-098 this launcher created a simulated print job only. Its
  // persisted cancellation snapshot had no preparationMode or queue attempt.
  registerOrderItems(...registration);
  const itemId = ok('order-items',{action:'add',orderId,productId:'espresso'}).items[0].id;
  ok('order-items',{action:'send',orderId,requestId:'original-round'});
  const correction = db.prepare(`INSERT INTO sent_item_corrections
    (request_id,item_id,order_id,actor_id,quantity,reason,occurred_at)
    VALUES('original-correction',?,?,1,1,'Sample correction',1)`).run(itemId,orderId);
  const snapshot = {tableId:1, round:1, lines:[{name:'Espresso',note:'',quantity:1,modifiers:[]}], cancellation:true};
  const notice = db.prepare(`INSERT INTO cancellation_notice_jobs(correction_id,destination,snapshot,created_at)
    VALUES(?,'bar',?,1)`).run(correction.lastInsertRowid,JSON.stringify(snapshot));
  db.prepare("UPDATE test_printer_queues SET queue='Sample Windows Bar' WHERE destination='bar'").run();
  const windows = [];
  registerTestPrinting(...registration, job => { windows.push(job); return 'accepted'; }, true, false, 'routine');
  const retry = {action:'retryNotice',jobId:notice.lastInsertRowid,requestId:'ticket-check',checked:true};
  const reply = call('test-printing',retry);
  await tick();
  assert.deepEqual({ok:reply.ok, output:windows.map(job => job.queue)}, {ok:false,output:[]});

  const simulated = selectPreparationPrinting([],db,{mode:'simulation'},assert.fail);
  registerTestPrinting(...registration, simulated.adapter, true, false, 'training');
  assert.equal(ok('test-printing',{action:'list'}).notices[0].result,'unattempted');
  ok('test-printing',retry);
  await tick();
  const job = ok('test-printing',{action:'list'}).notices[0];
  assert.deepEqual([job.queue,job.result,job.attempts],['bar','accepted',1]);
  db.exec("INSERT INTO user_permissions VALUES(1,'employees.view')");
  registerOrderHistory(...registration);
  const attempts = ok('order-history',{orderId}).events.filter(event => event.action === 'cancellation_print_attempt');
  assert.deepEqual(attempts.map(event => [event.adapter,event.destination,event.result]),[['simulated','bar','accepted']]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments').get().n,0);
});

test('a checked bar retry during lost Card A acknowledgement does not repeat the kitchen ticket or card sale', async t => {
  const offline = () => { throw Error('Network unavailable in this rehearsal'); };
  const network = [
    t.mock.method(require('node:net').Socket.prototype,'connect',offline),
    t.mock.method(require('node:dgram').Socket.prototype,'send',offline),
    t.mock.method(globalThis,'fetch',offline),
  ];
  const {db,directory,registration,ok,call,orderId,switchWaiter} = fixture(t);
  const pf700 = createTrainingPf700(directory);
  const preparation = selectPreparationPrinting([],db,pf700,assert.fail);
  registerOrderItems(...registration,preparation);
  registerTestPrinting(...registration,preparation.adapter,true,false,'training');
  registerBills(...registration,pf700);
  let fiscalDispatches = 0;
  registerPayments(...registration,null,{...pf700,async registerSale(receipt,context) {
    fiscalDispatches++;
    await pf700.registerSale(receipt,context);
    throw Error('Simulated lost fiscal reply');
  }});

  db.exec("UPDATE simulated_printers SET result='uncertain' WHERE destination='bar'");
  for (const productId of ['espresso','qebapa']) ok('order-items',{action:'add',orderId,productId});
  ok('order-items',{action:'send',orderId,requestId:'mixed'});
  await tick();
  const list = () => ok('test-printing',{action:'list'}).jobs;
  const outcomes = () => list().map(j => [j.destination,j.result,j.attempts]).sort();
  assert.deepEqual(outcomes(),[['bar','uncertain',1],['kitchen','accepted',1]]);
  assert.equal(fs.existsSync(path.join(directory,'simulated-pf700.sqlite')),false);
  const review = ok('bill',{action:'review',orderId});
  const bill = ok('bill',{action:'generate',orderId,fingerprint:review.fingerprint});
  const payment = {billId:bill.id,method:'card',account:'A'};
  const approval = ok('payment',{...payment,prepareSimulated:true});
  assert.equal((await call('payment',{...payment,terminalApproved:true,intentId:approval.intentId})).fiscalStatus,'uncertain');
  assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n,0);

  db.exec("UPDATE simulated_printers SET result='success' WHERE destination='bar'");
  const retry = {action:'retry',jobId:list().find(j => j.destination === 'bar').id,requestId:'checked-bar',checked:true};
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'second-fixture',x'00',x'00');
    INSERT INTO financial_scopes VALUES(2,'waiter');
    INSERT INTO user_permissions VALUES(2,'orders.change'),(2,'orders.view')`);
  switchWaiter(2);
  assert.deepEqual(list(),[]);
  assert.equal(call('test-printing',retry).ok,false);
  switchWaiter(1);
  ok('test-printing',retry);
  await tick();
  ok('test-printing',retry);
  assert.deepEqual(outcomes(),[['bar','accepted',2],['kitchen','accepted',1]]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n,0);
  const recover = {...payment,recoverSimulated:true};
  assert.equal((await call('payment',recover)).ok,true);
  assert.equal((await call('payment',recover)).ok,true);
  assert.equal(fiscalDispatches,1);
  assert.deepEqual(outcomes(),[['bar','accepted',2],['kitchen','accepted',1]]);
  assert.deepEqual(db.prepare('SELECT amount,account,method FROM payments').all().map(r => ({...r})),
    [{amount:290,account:'A',method:'card'}]);
  const device = new DatabaseSync(path.join(directory,'simulated-pf700.sqlite'),{readOnly:true});
  try {
    assert.deepEqual(device.prepare('SELECT bill,cash,card FROM documents WHERE bill IS NOT NULL').all().map(r => ({...r})),
      [{bill:bill.id,cash:0,card:290}]);
  } finally {device.close();}
  assert.deepEqual(network.map(spy => spy.mock.callCount()),[0,0,0]);
});
