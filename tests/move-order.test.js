const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { authorizedDatabase } = require('./support/authorized-database');
const { seedTables, registerTables } = require('../src/desktop/tables');
const { seedMenu } = require('../src/desktop/menu');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerMoveOrder } = require('../src/desktop/move-order');

test('move preserves order and preparation history, rejects conflicts and is retry safe', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-move-')); t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  let db = authorizedDatabase(openDatabase(dir)); seedTables(db); seedMenu(db);
  db.exec("INSERT INTO orders (table_id,opened_at,status) VALUES (1,1,'open'),(3,2,'open'); UPDATE dining_tables SET active=0 WHERE id=4");
  let move, items, tables; const event = {}; let actor = 1;
  const register = () => {
    registerMoveOrder({handle:(_,fn)=>move=fn}, e=>e===event, db, {currentUserId: () => actor, authenticatedUserId: () => actor});
    registerOrderItems({handle:(_,fn)=>items=fn}, e=>e===event, db, {currentUserId: () => actor, authenticatedUserId: () => actor});
    registerTables({handle:(_,fn)=>tables=fn}, e=>e===event, db, {currentUserId: () => actor, authenticatedUserId: () => actor});
  }; register();
  items(event,{action:'add',orderId:1,productId:'qebapa'}); items(event,{action:'send',orderId:1,requestId:'send-1'});
  const before = items(event,{action:'list',orderId:1}).data;
  const req = {orderId:1,sourceId:1,destinationId:2,requestId:'move-1'};
  for (const bad of [null, {}, {...req, extra:1}, {...req, sourceId:2}, {...req, destinationId:1}, {...req,destinationId:3}, {...req,destinationId:4}, {...req,destinationId:99}, {...req,requestId:'!'}]) assert.equal(move(event,bad).ok,false);
  assert.equal(move({},req).ok,false); actor=null; assert.equal(move(event,req).ok,false); actor=1;
  db.exec("DELETE FROM user_permissions WHERE user_id=1 AND permission='orders.change'"); assert.equal(move(event,req).ok,false);
  db.exec("INSERT INTO user_permissions VALUES (1,'orders.change')");
  assert.equal(move(event,req).ok,true); assert.equal(move(event,req).ok,true);
  assert.equal(move(event,{...req,destinationId:5}).ok,false);
  assert.equal(move(event,{...req,requestId:'stale'}).ok,false);
  assert.deepEqual(items(event,{action:'list',orderId:1}).data,before);
  assert.equal(db.prepare('SELECT count(*) n FROM preparation_rounds').get().n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM preparation_tickets').get().n,1);
  const rows=tables(event,{}).data; assert.equal(rows.find(x=>x.id===1).orderId,null); assert.equal(rows.find(x=>x.id===2).orderId,1); assert.equal(rows.find(x=>x.id===3).orderId,2);
  const audit=db.prepare("SELECT actor_id, occurred_at, order_id, context FROM application_audit WHERE action='move'").all(); assert.equal(audit.length,1); assert.equal(audit[0].actor_id,1); assert.ok(audit[0].occurred_at>0); assert.equal(audit[0].order_id,1); assert.deepEqual(JSON.parse(audit[0].context),{sourceId:1,destinationId:2,requestId:'move-1'});
  db.close(); db=authorizedDatabase(openDatabase(dir)); register(); assert.equal(move(event,req).ok,true); assert.equal(db.prepare('SELECT table_id FROM orders WHERE id=1').get().table_id,2); db.close();
});

test('failed audit rolls back the move and permits retry', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-move-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const db=authorizedDatabase(openDatabase(dir)); seedTables(db); db.exec("INSERT INTO orders (table_id,opened_at,status) VALUES (1,1,'open'); CREATE TRIGGER fail_move BEFORE INSERT ON application_audit WHEN NEW.action='move' BEGIN SELECT RAISE(ABORT,'failure'); END");
  let move; registerMoveOrder({handle:(_,fn)=>move=fn},()=>true,db,{currentUserId: () => 1, authenticatedUserId: () => 1});
  const req={orderId:1,sourceId:1,destinationId:2,requestId:'retry'};
  assert.equal(move({},req).ok,false); assert.equal(db.prepare('SELECT table_id FROM orders').get().table_id,1);
  db.exec('DROP TRIGGER fail_move'); assert.equal(move({},req).ok,true); db.close();
});
