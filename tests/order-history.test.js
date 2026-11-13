const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { openDatabase } = require('../src/desktop/database'), { authorizedDatabase } = require('./support/authorized-database');
const { recordAudit } = require('../src/desktop/audit');
// Reconstruct the stored rows from a move performed by an earlier version.
function historicalMove(db, orderId, sourceId, destinationId, destinationOrderId, itemId) {
  db.prepare("INSERT INTO orders(id, table_id, opened_at, status) VALUES (?, ?, 1, 'open')").run(destinationOrderId, destinationId);
  db.prepare('UPDATE order_items SET order_id=? WHERE id=?').run(destinationOrderId, itemId);
  db.prepare("UPDATE orders SET status='completed' WHERE id=?").run(orderId);
  recordAudit(db, 1, 'move_items', 'order', orderId, orderId, { sourceId, destinationId, destinationOrderId, expectedDestinationOrderId: null, itemIds: [itemId], requestId: 'historic' });
}
const { seedTables } = require('../src/desktop/tables'), { seedMenu } = require('../src/desktop/menu');
const { registerOrderItems } = require('../src/desktop/order-items'), { registerMoveOrder } = require('../src/desktop/move-order'), { registerOrderHistory } = require('../src/desktop/order-history');
test('history restricts direct access and projects operational events without financial fields', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-history-'));
  const db=authorizedDatabase(openDatabase(dir)); t.after(()=>{ db.close(); fs.rmSync(dir,{recursive:true,force:true}); }); seedTables(db); seedMenu(db);
  db.exec("INSERT INTO user_permissions VALUES(1,'employees.view'),(1,'orders.correct_sent'); INSERT INTO orders(table_id,opened_at,status) VALUES(1,1,'open');");
  let actor=1, auth=1; const session={currentUserId:()=>actor,authenticatedUserId:()=>auth}, event={};
  const handlers={}; const ipc={handle:(name,fn)=>handlers[name]=fn}; const trusted=e=>e===event;
  registerOrderItems(ipc,trusted,db,session); registerMoveOrder(ipc,trusted,db,session); registerOrderHistory(ipc,trusted,db,session);
  const item=r=>handlers['arra:order-items'](event,r), history=r=>handlers['arra:order-history'](event,r);
  assert.equal(item({action:'add',orderId:1,productId:'qebapa'}).ok,true);
  assert.equal(item({action:'send',orderId:1,requestId:'send'}).ok,true);
  assert.equal(item({action:'correct',orderId:1,itemId:1,quantity:1,reason:'mistake',requestId:'correct'}).ok,true);
  assert.equal(handlers['arra:move-order'](event,{orderId:1,sourceId:1,destinationId:2,requestId:'move'}).ok,true);
  const result=history({orderId:1}); assert.equal(result.ok,true); assert.deepEqual(result.data.events.filter(e=>e.action!=='print_attempt').map(e=>e.action),['add','send','correct_sent','move']); assert.ok(result.data.events.some(e=>e.action==='print_attempt' && e.adapter==='simulated' && e.result==='success'));
  assert.ok(result.data.events.every(e=>e.actor && e.occurredAt)); assert.equal(result.data.events.find(e=>e.action==='correct_sent').quantity,1); assert.equal(result.data.events.find(e=>e.action==='correct_sent').reason,'mistake');
  historicalMove(db, 1, 2, 3, 2, 1);
  const destination=history({orderId:2}); assert.equal(destination.ok,true);
  for (const action of ['add','send','correct_sent','move_items']) assert.ok(destination.data.events.some(e=>e.action===action),action);
  assert.ok(destination.data.events.some(e=>e.action==='add' && e.orderId===1));
  historicalMove(db, 2, 3, 4, 3, 1);
  const finalHistory=history({orderId:3}); assert.equal(finalHistory.ok,true);
  assert.deepEqual(finalHistory.data.events.filter(e=>e.action==='move_items').map(e=>e.orderId),[1,2]);
  assert.ok(finalHistory.data.events.some(e=>e.action==='add' && e.orderId===1));
  const json=JSON.stringify(result); for(const text of ['unitPrice','price','requestId','modifiers','note','account']) assert.equal(json.includes(text),false);
  assert.equal(history({orderId:null}).data.orders.length,3); assert.equal(history({orderId:999}).ok,false);
  for(const r of [null,{}, {orderId:0}, {orderId:1,extra:true}, [], Object.create(null)]) assert.equal(history(r).ok,false);
  assert.equal(handlers['arra:order-history']({}, {orderId:1}).ok,false); actor=null; assert.equal(history({orderId:1}).ok,false); actor=1; auth=2; assert.equal(history({orderId:1}).ok,false); auth=1;
  db.exec("DELETE FROM user_permissions WHERE user_id=1 AND permission='employees.view'"); assert.equal(history({orderId:1}).ok,false);
});
test('history reports original, corrected and remaining quantities after moves', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-history-quantity-')); const db=authorizedDatabase(openDatabase(dir)); t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})}); seedTables(db); seedMenu(db);
 db.exec("INSERT INTO user_permissions VALUES(1,'employees.view'),(1,'orders.correct_sent'); INSERT INTO orders(table_id,opened_at,status) VALUES(1,1,'open');");
 const handlers={}, ipc={handle:(n,f)=>handlers[n]=f}, event={}, session={currentUserId:()=>1,authenticatedUserId:()=>1}; for (const register of [registerOrderItems,registerOrderHistory]) register(ipc,e=>e===event,db,session);
 const item=r=>handlers['arra:order-items'](event,r), history=id=>handlers['arra:order-history'](event,{orderId:id}); item({action:'add',orderId:1,productId:'qebapa'}); item({action:'increment',orderId:1,itemId:1}); item({action:'send',orderId:1,requestId:'send'}); assert.equal(item({action:'correct',orderId:1,itemId:1,quantity:1,reason:'Sample',requestId:'first'}).ok,true);
 assert.deepEqual({...history(1).data.items[0]}, {id:1,name:'Qebapa',quantity:2,status:'sent',correctedQuantity:1}); historicalMove(db, 1, 1, 2, 2, 1); assert.equal(history(1).data.items.length,0); assert.equal(history(2).data.items[0].correctedQuantity,1);
 assert.equal(item({action:'correct',orderId:2,itemId:1,quantity:1,reason:'Sample',requestId:'second'}).ok,true); assert.equal(history(2).data.items[0].correctedQuantity,2);
});

test('owner history protects effective account across moved-item timelines', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-history-scope-')), db=openDatabase(dir);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'a',x'01',x'01'),(2,'b',x'01',x'01'),(3,'combined',x'01',x'01');
    INSERT INTO financial_scopes VALUES(1,'A'),(2,'B'),(3,'combined');
    INSERT INTO user_permissions VALUES(1,'employees.view'),(2,'employees.view'),(3,'employees.view');
    INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample'),(3,'sample'),(4,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'),(3,3,1,'open'),(4,4,1,'open');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,100,'a'),(2,2,1,1,200,'b'),(3,3,1,1,0,'c'),(4,4,1,1,0,'d');
    INSERT INTO payments(id,bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,2,100,'card','A'),(2,2,1,2,200,'cash','B');`);
  recordAudit(db,1,'move_items','order',2,2,{sourceId:2,destinationId:3,destinationOrderId:3,itemIds:[99]});
  let actor=1, handler; registerOrderHistory({handle:(_,fn)=>handler=fn},()=>true,db,{currentUserId:()=>actor,authenticatedUserId:()=>actor});
  const history=id=>handler({}, {orderId:id});
  assert.deepEqual(history(null).data.orders.map(o=>o.id),[4,1]);
  assert.equal(history(2).ok,false); assert.equal(history(3).ok,false);
  actor=2; assert.deepEqual(history(null).data.orders.map(o=>o.id),[4,3,2]); assert.equal(history(1).ok,false);
  actor=3; assert.deepEqual(history(null).data.orders.map(o=>o.id),[4,3,2,1]); assert.equal(history(2).ok,true);
  // An indirect chain joining A and B hides every connected timeline from
  // both owners, while Combined can still inspect each end.
  recordAudit(db,1,'move_items','order',3,3,{sourceId:3,destinationId:1,destinationOrderId:1,itemIds:[99]});
  actor=1; assert.deepEqual(history(null).data.orders.map(o=>o.id),[4]); assert.equal(history(1).ok,false); assert.equal(history(3).ok,false);
  actor=2; assert.deepEqual(history(null).data.orders.map(o=>o.id),[4]); assert.equal(history(1).ok,false); assert.equal(history(2).ok,false);
  actor=3; assert.equal(history(1).ok,true); assert.equal(history(2).ok,true);
  db.exec("INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(2,3,3,'sample')");
  actor=1; assert.deepEqual(history(null).data.orders.map(o=>o.id),[4,3,2,1]); assert.equal(history(3).ok,true);
  actor=2; assert.deepEqual(history(null).data.orders.map(o=>o.id),[4]); assert.equal(history(3).ok,false);
});
