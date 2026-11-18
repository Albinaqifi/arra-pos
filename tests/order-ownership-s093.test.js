const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomInt } = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { authorizedDatabase } = require('./support/authorized-database');
const { seedTables, registerTables } = require('../src/desktop/tables');
const { seedMenu } = require('../src/desktop/menu');
const { registerOrders } = require('../src/desktop/orders');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerMoveOrder } = require('../src/desktop/move-order');
const { registerBills } = require('../src/desktop/bills');
const { registerPayments } = require('../src/desktop/payments');
const { registerPrintJobs } = require('../src/desktop/print-jobs');
const { registerTestPrinting } = require('../src/desktop/test-printing');
const { registerLegacyOrderAssignment } = require('../src/desktop/legacy-order-assignment');

function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-ownership-'));
  let db=authorizedDatabase(openDatabase(dir)); seedTables(db); seedMenu(db);
  db.exec("INSERT INTO local_users(id,username,salt,password_hash,pin_salt,pin_hash) VALUES(2,'other',x'01',x'01',x'01',x'01'),(3,'combined',x'01',x'01',NULL,NULL); INSERT INTO financial_scopes VALUES(2,'waiter'),(3,'combined'); INSERT INTO user_permissions VALUES(2,'tables.view'),(2,'orders.view'),(2,'orders.change'),(3,'orders.correct_sent');");
  let actor=1, handlers={}; const event={};
  const session={currentUserId:()=>actor,authenticatedUserId:()=>actor};
  function register() {
    handlers={}; const ipc={handle:(name,fn)=>handlers[name]=fn};
    for(const fn of [registerTables,registerOrders,registerOrderItems,registerMoveOrder,registerBills,registerPayments,registerPrintJobs,registerLegacyOrderAssignment]) fn(ipc,e=>e===event,db,session);
    registerTestPrinting(ipc,e=>e===event,db,session,()=> 'accepted',true);
  }
  register();
  const call=(channel,req,sender=event)=>handlers['arra:'+channel](sender,req);
  t.after(()=>{ db.close(); fs.rmSync(dir,{recursive:true,force:true}); });
  return { get db(){return db;}, call, actor:id=>actor=id, reopen:()=>{db.close();db=openDatabase(dir);register();}, downgrade:()=>{db.exec('DROP TABLE legacy_unassigned_orders; DROP TABLE order_waiter_ownership; PRAGMA user_version=42');db.close();db=openDatabase(dir);register();} };
}

test('owners are enforced for direct access, printing, moves and payment retries', t=>{
  const f=setup(t), call=f.call;
  const opened=call('open-order',{tableId:1}); assert.equal(opened.ok,true); const orderId=opened.data.id;
  const add=call('order-items',{action:'add',orderId,productId:'qebapa'}); assert.equal(add.ok,true);
  const itemId=add.data.items[0].id;
  assert.equal(call('order-items',{action:'send',orderId,requestId:'send-one'}).ok,true);
  const preview=call('bill',{action:'review',orderId}); assert.equal(preview.ok,true);
  const bill=call('bill',{action:'generate',orderId,fingerprint:preview.data.fingerprint}); assert.equal(bill.ok,true);
  const jobs=call('print-jobs',{action:'list'}).data.jobs; assert.equal(jobs.length,1);
  f.actor(2);
  const table=call('tables',{}).data.find(row=>row.id===1); assert.equal(table.occupied,1); assert.equal(table.orderId,null); assert.equal(table.openedAt,null);
  for(const req of [{action:'list',orderId},{action:'add',orderId,productId:'qebapa'},{action:'send',orderId,requestId:'send-one'},{action:'correct',orderId,itemId,quantity:1,reason:'sample',requestId:'bad'}]) assert.equal(call('order-items',req).ok,false);
  assert.equal(call('open-order',{tableId:1}).ok,false);
  assert.equal(call('authorize-cancellation',{orderId,itemId,pin:String(randomInt(1000000)).padStart(6,'0')}).ok,false);
  assert.equal(call('bill',{action:'review',orderId}).ok,false);
  assert.equal(call('payment',{billId:bill.data.id,method:'cash',account:'A'}).ok,false);
  assert.equal(call('move-order',{orderId,sourceId:1,destinationId:2,requestId:'move'}).ok,false);
  assert.equal(call('print-jobs',{action:'list'}).data.jobs.length,0);
  assert.equal(call('print-jobs',{action:'retry',jobId:jobs[0].id,requestId:'other'}).ok,false);
  assert.equal(call('test-printing',{action:'bill',billId:bill.data.id,requestId:'other'}).ok,false);
  f.actor(1);
  assert.equal(call('payment',{billId:bill.data.id,method:'cash',account:'A'}).ok,true);
  assert.equal(call('payment',{billId:bill.data.id,method:'cash',account:'A'}).ok,true);
  assert.equal(call('order-items',{action:'send',orderId,requestId:'send-one'}).ok,true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM preparation_rounds WHERE order_id=?').get(orderId).n,1);
  f.actor(2); assert.equal(call('payment',{billId:bill.data.id,method:'cash',account:'A'}).ok,false);
  assert.equal(call('order-items',{action:'send',orderId,requestId:'send-one'}).ok,false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,1);
  const next=call('open-order',{tableId:1}); assert.equal(next.ok,true); assert.notEqual(next.data.id,orderId);
  assert.equal(f.db.prepare('SELECT waiter_id FROM order_waiter_ownership WHERE order_id=?').get(orderId).waiter_id,1);
});

test('untouched orders are retired without transferring history and moved orders retain ownership',t=>{
  const f=setup(t),call=f.call; const first=call('open-order',{tableId:1}).data;
  f.actor(2); const replacement=call('open-order',{tableId:1}).data; assert.notEqual(first.id,replacement.id);
  assert.equal(f.db.prepare('SELECT retired_empty FROM orders WHERE id=?').get(first.id).retired_empty,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM application_audit WHERE order_id=?').get(first.id).n,1);
  assert.equal(call('order-items',{action:'add',orderId:first.id,productId:'qebapa'}).ok,false);
  assert.equal(call('order-items',{action:'add',orderId:replacement.id,productId:'qebapa'}).ok,true);
  const move={orderId:replacement.id,sourceId:1,destinationId:2,requestId:'same-move'};
  assert.equal(call('move-order',move).ok,true); assert.equal(call('move-order',move).ok,true);
  f.reopen(); f.actor(1); assert.equal(call('move-order',move).ok,false); assert.equal(call('open-order',{tableId:2}).ok,false);
  f.actor(2); assert.equal(call('open-order',{tableId:2}).data.id,replacement.id);
});

test('legacy orders stay unassigned until an authorized explicit one-time assignment',t=>{
  const f=setup(t),call=f.call;
  f.db.exec("INSERT INTO orders(id,table_id,opened_at,status) VALUES(20,1,1,'open'); INSERT INTO order_items(order_id,product_id,name,unit_price,quantity,status) VALUES(20,'qebapa','sample',10,1,'pending')");
  f.downgrade();
  assert.equal(f.db.prepare('SELECT count(*) n FROM order_waiter_ownership').get().n,0);
  assert.equal(call('open-order',{tableId:1}).ok,false); assert.equal(call('order-items',{action:'list',orderId:20}).ok,false);
  assert.equal(call('legacy-order-assignment',{action:'list'}).ok,false);
  f.actor(3); const list=call('legacy-order-assignment',{action:'list'}); assert.equal(list.ok,true); assert.deepEqual(list.data.orders.map(o=>o.orderId),[20]);
  const assign={action:'assign',orderId:20,waiterId:2};
  assert.equal(call('legacy-order-assignment',assign,{}).ok,false);
  assert.equal(call('legacy-order-assignment',assign).ok,true); assert.equal(call('legacy-order-assignment',assign).ok,true);
  assert.equal(call('legacy-order-assignment',{...assign,waiterId:1}).ok,false);
  assert.equal(f.db.prepare("SELECT count(*) n FROM application_audit WHERE action='assign_legacy_waiter'").get().n,1);
  f.actor(2); assert.equal(call('order-items',{action:'list',orderId:20}).ok,true);
  f.actor(1); assert.equal(call('order-items',{action:'list',orderId:20}).ok,false);
  f.reopen(); f.actor(2); assert.equal(call('open-order',{tableId:1}).data.id,20);
});

test('only the original payer can reconcile a committed legacy payment after upgrade',t=>{
  const f=setup(t),call=f.call;
  const orderId=call('open-order',{tableId:1}).data.id;
  assert.equal(call('order-items',{action:'add',orderId,productId:'qebapa'}).ok,true);
  assert.equal(call('order-items',{action:'send',orderId,requestId:'old-send'}).ok,true);
  const preview=call('bill',{action:'review',orderId}).data;
  const bill=call('bill',{action:'generate',orderId,fingerprint:preview.fingerprint}).data;
  const request={billId:bill.id,method:'cash',account:'A'};
  const original=call('payment',request); assert.equal(original.ok,true);
  f.downgrade(); f.reopen();
  assert.equal(f.db.prepare('SELECT count(*) n FROM order_waiter_ownership').get().n,0);
  assert.deepEqual(call('payment',request),original);
  assert.equal(call('payment',{...request,account:'B'}).ok,false);
  assert.equal(call('payment',{...request,method:'card'}).ok,false);
  f.actor(2); assert.equal(call('payment',request).ok,false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,1);
  assert.equal(call('bill',{action:'review',orderId}).ok,false);
});

test('unknown send can be reconciled after explicit legacy assignment without a second round',t=>{
  const f=setup(t),call=f.call;
  const orderId=call('open-order',{tableId:1}).data.id;
  assert.equal(call('order-items',{action:'add',orderId,productId:'qebapa'}).ok,true);
  const send={action:'send',orderId,requestId:'legacy-unknown-send'};
  assert.equal(call('order-items',send).ok,true); f.downgrade();
  assert.equal(call('order-items',send).ok,false);
  f.actor(3); assert.equal(call('legacy-order-assignment',{action:'assign',orderId,waiterId:1}).ok,false);
  // Add an eligible credential to this synthetic pre-upgrade waiter.
  f.db.prepare("UPDATE local_users SET pin_salt=x'01',pin_hash=x'01' WHERE id=1").run();
  assert.equal(call('legacy-order-assignment',{action:'assign',orderId,waiterId:1}).ok,true);
  f.actor(1); assert.equal(call('order-items',send).ok,true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM preparation_rounds WHERE order_id=?').get(orderId).n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM preparation_tickets').get().n,1);
});

test('completed legacy print jobs remain recoverable only by the recorded sender',t=>{
  const f=setup(t),call=f.call;
  assert.equal(call('print-jobs',{action:'simulate',destination:'kitchen',result:'failed'}).ok,true);
  const orderId=call('open-order',{tableId:1}).data.id;
  assert.equal(call('order-items',{action:'add',orderId,productId:'qebapa'}).ok,true);
  assert.equal(call('order-items',{action:'send',orderId,requestId:'legacy-send'}).ok,true);
  const simJob=call('print-jobs',{action:'list'}).data.jobs[0];
  const ticket=f.db.prepare('SELECT id FROM preparation_tickets').get().id;
  const printing=require('../src/desktop/test-printing');
  const realJob=printing.createPreparationJob(f.db,ticket);
  printing.reserveAttempt(f.db,realJob,'old-uncertain',1);
  const preview=call('bill',{action:'review',orderId}).data;
  const bill=call('bill',{action:'generate',orderId,fingerprint:preview.fingerprint}).data;
  assert.equal(call('payment',{billId:bill.id,method:'cash',account:'A'}).ok,true);
  f.downgrade(); f.reopen();
  assert.equal(call('print-jobs',{action:'list'}).data.jobs.find(j=>j.id===simJob.id).result,'failed');
  assert.equal(call('test-printing',{action:'list'}).data.jobs.find(j=>j.id===realJob).result,'uncertain');
  f.actor(2);
  assert.equal(call('print-jobs',{action:'list'}).data.jobs.length,0);
  assert.equal(call('print-jobs',{action:'retry',jobId:simJob.id,requestId:'foreign'}).ok,false);
  assert.equal(call('test-printing',{action:'retry',jobId:realJob,requestId:'foreign',checked:true}).ok,false);
  f.actor(1);
  assert.equal(call('print-jobs',{action:'retry',jobId:simJob.id,requestId:'same'}).ok,true);
  assert.equal(call('print-jobs',{action:'retry',jobId:simJob.id,requestId:'same'}).ok,true);
  assert.equal(call('test-printing',{action:'retry',jobId:realJob,requestId:'paper',checked:false}).ok,false);
  assert.equal(call('test-printing',{action:'retry',jobId:realJob,requestId:'paper',checked:true}).ok,true);
  assert.equal(f.db.prepare("SELECT count(*) n FROM test_print_attempts WHERE request_id='retry-paper'").get().n,1);
});

test('failed waiter selection revokes the prior waiter but leaves a direct owner signed in',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-identity-')), db=openDatabase(dir);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  const {bootstrap,registerSession}=require('../src/desktop/session');
  const {registerEmployeeConfig}=require('../src/desktop/employee-config');
  const secret=()=>randomBytes(20).toString('hex');
  const ownerPassword=secret(), restaurantPassword=secret(), staffPassword=secret();
  const firstPin='0'+String(randomInt(1000)).padStart(3,'0'), badPin='1'+String(randomInt(1000)).padStart(3,'0');
  bootstrap(db,'owner',ownerPassword);
  const handlers={},event={},ipc={handle:(name,fn)=>handlers[name]=fn};
  const session=registerSession(ipc,e=>e===event,db); registerEmployeeConfig(ipc,e=>e===event,db,session);
  const call=(name,req)=>handlers['arra:'+name](event,req);
  assert.equal(call('sign-in',{username:'owner',password:ownerPassword}).ok,true);
  assert.equal(call('select-waiter',{id:1,pin:firstPin}).ok,false); assert.equal(session.currentUserId(),1);
  assert.equal(call('employee-config',{action:'createRestaurant',username:'restaurant',password:restaurantPassword}).ok,true);
  assert.equal(call('employee-config',{action:'create',username:'staff',password:staffPassword,pin:firstPin}).ok,true);
  const waiter=db.prepare("SELECT id FROM local_users WHERE username='staff'").get().id;
  call('sign-out',{}); assert.equal(call('sign-in',{username:'restaurant',password:restaurantPassword}).ok,true);
  assert.equal(call('select-waiter',{id:waiter,pin:firstPin}).ok,true); assert.equal(session.currentUserId(),waiter);
  assert.equal(call('select-waiter',{id:waiter,pin:badPin}).ok,false); assert.equal(session.currentUserId(),null);
});
