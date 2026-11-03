const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {openDatabase}=require('../src/desktop/database'), {authorizedDatabase}=require('./support/authorized-database');
const {seedTables,registerTables}=require('../src/desktop/tables'), {seedMenu}=require('../src/desktop/menu');
const {registerOrderItems}=require('../src/desktop/order-items'), {registerMoveItems}=require('../src/desktop/move-items');
test('moves selected sent and pending lines atomically, retains history, supports confirmed occupied destinations and retries',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-items-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let db=authorizedDatabase(openDatabase(dir)); seedTables(db); seedMenu(db);
 db.exec("INSERT INTO orders(table_id,opened_at,status) VALUES (1,1,'open'),(3,1,'open'); UPDATE dining_tables SET active=0 WHERE id=4");
 let move,items,tables,actor=1; const event={};
 const register=()=>{const ipc=fn=>({handle:(_,f)=>fn(f)}), session={currentUserId:()=>actor}; registerMoveItems(ipc(f=>move=f),e=>e===event,db,session); registerOrderItems(ipc(f=>items=f),e=>e===event,db,session); registerTables(ipc(f=>tables=f),e=>e===event,db,session);}; register();
 const add=(orderId)=>items(event,{action:'add',orderId,productId:'qebapa'}); add(1); items(event,{action:'send',orderId:1,requestId:'send'}); add(1); add(1); add(2);
 const before=items(event,{action:'list',orderId:1}).data.items; const destBefore=items(event,{action:'list',orderId:2}).data.items;
 const req={orderId:1,sourceId:1,destinationId:3,destinationOrderId:2,itemIds:[before[0].id,before[1].id],requestId:'move-1'};
 for(const bad of [null,{}, {...req,extra:1}, {...req,itemIds:[]}, {...req,itemIds:[before[0].id,before[0].id]}, {...req,itemIds:[before[0].id,999]}, {...req,destinationId:1}, {...req,destinationId:4}, {...req,destinationOrderId:null}, {...req,sourceId:2}, {...req,requestId:'!'}]) assert.equal(move(event,bad).ok,false);
 assert.equal(move({},req).ok,false); actor=null; assert.equal(move(event,req).ok,false); actor=1; db.exec("DELETE FROM user_permissions WHERE permission='orders.change'"); assert.equal(move(event,req).ok,false); db.exec("INSERT INTO user_permissions VALUES(1,'orders.change')");
 assert.equal(move(event,req).ok,true); assert.equal(move(event,req).ok,true); assert.equal(move(event,{...req,itemIds:[before[0].id]}).ok,false); assert.equal(move(event,{...req,requestId:'stale'}).ok,false);
 assert.deepEqual(items(event,{action:'list',orderId:1}).data.items,[before[2]]); assert.deepEqual(items(event,{action:'list',orderId:2}).data.items,[...before.slice(0,2),...destBefore].sort((a,b)=>a.id-b.id));
 assert.equal(db.prepare('SELECT count(*) n FROM preparation_ticket_items').get().n,1); assert.equal(db.prepare('SELECT count(*) n FROM print_jobs').get().n,1);
 const audit=db.prepare("SELECT actor_id,occurred_at,context FROM application_audit WHERE action='move_items'").all(); assert.equal(audit.length,1); assert.equal(audit[0].actor_id,1); assert.ok(audit[0].occurred_at>0); assert.deepEqual(JSON.parse(audit[0].context).itemIds,req.itemIds);
 let rows=tables(event,{}).data; assert.equal(rows.find(x=>x.id===1).orderId,1); assert.equal(rows.find(x=>x.id===3).orderId,2);
 const last={orderId:1,sourceId:1,destinationId:2,destinationOrderId:null,itemIds:[before[2].id],requestId:'move-2'}; assert.equal(move(event,last).ok,true);
 rows=tables(event,{}).data; assert.equal(rows.find(x=>x.id===1).orderId,null); assert.ok(rows.find(x=>x.id===2).orderId); db.close(); db=authorizedDatabase(openDatabase(dir)); register(); assert.equal(move(event,last).ok,true); assert.equal(db.prepare('SELECT count(*) n FROM order_items').get().n,4); db.close();
});
test('audit failure rolls back destination creation and item move',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-items-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); const db=authorizedDatabase(openDatabase(dir)); seedTables(db); seedMenu(db); db.exec("INSERT INTO orders(table_id,opened_at,status) VALUES(1,1,'open'); INSERT INTO order_items(order_id,product_id,name,unit_price,quantity,status) VALUES(1,'qebapa','Sample',1,1,'pending'); CREATE TRIGGER fail_move_items BEFORE INSERT ON application_audit WHEN NEW.action='move_items' BEGIN SELECT RAISE(ABORT,'failure'); END");
 let move; registerMoveItems({handle:(_,f)=>move=f},()=>true,db,{currentUserId:()=>1}); const req={orderId:1,sourceId:1,destinationId:2,destinationOrderId:null,itemIds:[1],requestId:'retry'};
 assert.equal(move({},req).ok,false); assert.equal(db.prepare('SELECT order_id FROM order_items').get().order_id,1); assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,1); db.exec('DROP TRIGGER fail_move_items'); assert.equal(move({},req).ok,true); db.close();
});
test('rejects a merge that exceeds the safe integer total without changing either order',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-items-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); const db=authorizedDatabase(openDatabase(dir)); seedTables(db); seedMenu(db);
 db.exec("INSERT INTO orders(table_id,opened_at,status) VALUES(1,1,'open'),(2,1,'open'); INSERT INTO order_items(order_id,product_id,name,unit_price,quantity,status) VALUES(1,'qebapa','One',1,1,'pending'),(2,'qebapa','Large',9007199254740991,1,'pending')");
 let move; registerMoveItems({handle:(_,f)=>move=f},()=>true,db,{currentUserId:()=>1});
 assert.deepEqual(move({}, {orderId:1,sourceId:1,destinationId:2,destinationOrderId:2,itemIds:[1],requestId:'overflow'}),{ok:false,rejected:true});
 assert.deepEqual(db.prepare('SELECT order_id FROM order_items ORDER BY id').all().map(x=>x.order_id),[1,2]); assert.equal(db.prepare("SELECT count(*) n FROM application_audit WHERE action='move_items'").get().n,0); db.close();
});
