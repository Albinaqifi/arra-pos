const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {openDatabase} = require('../src/desktop/database');
const {authorizedDatabase} = require('./support/authorized-database');
const {seedTables,registerTables} = require('../src/desktop/tables');
const {seedMenu} = require('../src/desktop/menu');
const {registerOrders} = require('../src/desktop/orders');
const {registerOrderItems} = require('../src/desktop/order-items');
const {registerMoveOrder} = require('../src/desktop/move-order');
test('untouched orders remain free across restart, preserve history, and allow a move with rollback', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-untouched-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let db=authorizedDatabase(openDatabase(dir)), open, list, items, move; seedTables(db); seedMenu(db);
 const event={}, session={currentUserId:()=>1,authenticatedUserId:()=>1};
 const register=()=>{for(const [fn,set] of [[registerOrders,x=>open=x],[registerTables,x=>list=x],[registerOrderItems,x=>items=x],[registerMoveOrder,x=>move=x]]) fn({handle:(_,h)=>set(h)},e=>e===event,db,session);}; register();
 const first=open(event,{tableId:1}).data; assert.equal(first.untouched,1); assert.equal(list(event,{}).data[0].untouched,1);
 db.close(); db=authorizedDatabase(openDatabase(dir)); register(); assert.equal(list(event,{}).data[0].untouched,1); assert.equal(open(event,{tableId:1}).data.id,first.id);
 const second=open(event,{tableId:2}).data; assert.equal(items(event,{action:'add',orderId:second.id,productId:'qebapa'}).ok,true);
 assert.equal(list(event,{}).data[1].untouched,0);
 db.exec("CREATE TRIGGER fail_move BEFORE INSERT ON application_audit WHEN NEW.action='move' BEGIN SELECT RAISE(ABORT,'fail'); END");
 const req={orderId:second.id,sourceId:2,destinationId:1,requestId:'test-move'};
 assert.equal(move(event,req).ok,false); assert.equal(db.prepare('SELECT retired_empty FROM orders WHERE id=?').get(first.id).retired_empty,0);
 db.exec('DROP TRIGGER fail_move'); assert.equal(move(event,req).ok,true); assert.equal(move(event,req).ok,true);
 assert.equal(db.prepare('SELECT retired_empty FROM orders WHERE id=?').get(first.id).retired_empty,1); assert.equal(list(event,{}).data[0].orderId,second.id);
 assert.equal(items(event,{action:'list',orderId:first.id}).ok,false); assert.equal(db.prepare('SELECT count(*) n FROM application_audit WHERE order_id=?').get(first.id).n,1);
 assert.equal(items(event,{action:'send',orderId:second.id,requestId:'test-send'}).ok,true); db.close(); db=authorizedDatabase(openDatabase(dir)); register();
 assert.equal(list(event,{}).data[0].untouched,0); assert.equal(items(event,{action:'list',orderId:second.id}).data.items[0].status,'sent'); db.close();
});

test('untouched placeholders do not block configuration or appear in day issues, and retired history stays readable', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-untouched-config-')); const db=authorizedDatabase(openDatabase(dir)); t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});}); seedTables(db); seedMenu(db);
 db.exec("INSERT INTO user_permissions VALUES(1,'tables.change'),(1,'employees.view'),(1,'business_days.close')");
 const handlers={}, ipc={handle:(n,f)=>handlers[n]=f}, event={}, session={currentUserId:()=>1,authenticatedUserId:()=>1};
 const {registerTableConfig}=require('../src/desktop/table-config'), {registerBusinessDays}=require('../src/desktop/business-days'), {registerOrderHistory}=require('../src/desktop/order-history');
 for(const f of [registerOrders,registerOrderItems,registerMoveOrder,registerTableConfig,registerBusinessDays,registerOrderHistory]) f(ipc,e=>e===event,db,session);
 const call=(channel,req)=>handlers['arra:'+channel](event,req), empty=call('open-order',{tableId:1}).data, area=db.prepare('SELECT area_id FROM dining_tables WHERE id=1').get().area_id;
 db.exec("UPDATE financial_scopes SET scope='combined' WHERE user_id=1"); assert.deepEqual(call('business-days',{action:'list'}).data.issues.orders,[]); db.exec("UPDATE financial_scopes SET scope='waiter' WHERE user_id=1");
 assert.equal(call('table-config',{action:'list'}).data.tables.find(x=>x.id===1).hasOrder,0);
 assert.equal(call('table-config',{action:'area',id:area,name:'Inside',active:false}).ok,true);
 assert.equal(call('open-order',{tableId:1}).ok,false);
 assert.equal(call('table-config',{action:'area',id:area,name:'Inside',active:true}).ok,true);
 const source=call('open-order',{tableId:2}).data; assert.equal(call('order-items',{action:'add',orderId:source.id,productId:'qebapa'}).ok,true);
 db.exec("UPDATE financial_scopes SET scope='combined' WHERE user_id=1"); assert.equal(call('business-days',{action:'list'}).data.issues.orders.length,1); db.exec("UPDATE financial_scopes SET scope='waiter' WHERE user_id=1");
 assert.equal(call('table-config',{action:'area',id:area,name:'Inside',active:false}).ok,false);
 assert.equal(call('move-order',{orderId:source.id,sourceId:2,destinationId:1,requestId:'move'}).ok,true);
 db.prepare("UPDATE financial_scopes SET scope='waiter' WHERE user_id=1").run();
 assert.equal(call('order-history',{orderId:null}).data.orders.find(x=>x.id===empty.id).status,'retired empty');
 const history=call('order-history',{orderId:empty.id}); assert.equal(history.data.order.status,'retired empty'); assert.equal(history.data.events[0].action,'open');
});

test('v24 migration preserves records and rolls back a partial migration failure', t => {
 const {DatabaseSync}=require('node:sqlite'); const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-v24-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let db=authorizedDatabase(openDatabase(dir)); seedTables(db); seedMenu(db);
 db.exec("INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,2,'open'); INSERT INTO application_audit(actor_id,occurred_at,action,entity_type,entity_id,order_id,context) VALUES(1,1,'open','order','1',1,'{\"tableId\":1}'); INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,2,1,1,10,'sample'); INSERT INTO payments(id,bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,1,10,'cash','A'); UPDATE orders SET status='completed' WHERE id=2; DROP INDEX one_open_order_per_table; ALTER TABLE orders DROP COLUMN retired_empty; CREATE UNIQUE INDEX one_open_order_per_table ON orders(table_id) WHERE status='open'; DROP TABLE IF EXISTS test_print_results; DROP TABLE IF EXISTS test_print_attempts; DROP TABLE IF EXISTS test_print_jobs; DROP TABLE IF EXISTS test_printer_queues; PRAGMA user_version=24;"); db.close();
 db=openDatabase(dir); assert.equal(db.prepare('PRAGMA user_version').get().user_version,26); assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,2); assert.equal(db.prepare('SELECT count(*) n FROM application_audit').get().n,1); assert.equal(db.prepare('SELECT amount FROM payments').get().amount,10); db.exec("DROP INDEX one_open_order_per_table; ALTER TABLE orders DROP COLUMN retired_empty; DROP TABLE IF EXISTS test_print_results; DROP TABLE IF EXISTS test_print_attempts; DROP TABLE IF EXISTS test_print_jobs; DROP TABLE IF EXISTS test_printer_queues; PRAGMA user_version=24"); db.close();
 assert.throws(()=>openDatabase(dir)); db=new DatabaseSync(path.join(dir,'arra.sqlite')); assert.equal(db.prepare('PRAGMA user_version').get().user_version,24); assert.equal(db.prepare('SELECT count(*) n FROM pragma_table_info(\'orders\') WHERE name=\'retired_empty\'').get().n,0); assert.equal(db.prepare('SELECT amount FROM payments').get().amount,10); db.close();
});

test('deactivated table or area rejects stale order changes without hiding items', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-inactive-order-')); const db=authorizedDatabase(openDatabase(dir)); t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});}); seedTables(db); seedMenu(db);
 db.exec("INSERT INTO user_permissions VALUES(1,'tables.change')"); const handlers={}, event={}, session={currentUserId:()=>1,authenticatedUserId:()=>1}, ipc={handle:(n,f)=>handlers[n]=f};
 for(const f of [registerOrders,registerOrderItems,registerMoveOrder,require('../src/desktop/table-config').registerTableConfig]) f(ipc,e=>e===event,db,session);
 const call=(channel,req)=>handlers['arra:'+channel](event,req), order=call('open-order',{tableId:1}).data, area=db.prepare('SELECT area_id FROM dining_tables WHERE id=1').get().area_id;
 const table={action:'table',id:1,areaId:area,capacity:4,active:false,create:false};
 const reject=()=>{ assert.equal(call('order-items',{action:'add',orderId:order.id,productId:'qebapa'}).ok,false); assert.equal(call('move-order',{orderId:order.id,sourceId:1,destinationId:2,requestId:'stale'}).ok,false); assert.equal(db.prepare('SELECT count(*) n FROM order_items WHERE order_id=?').get(order.id).n,0); };
 assert.equal(call('table-config',table).ok,true); reject(); assert.equal(call('table-config',{...table,active:true}).ok,true);
 assert.equal(call('table-config',{action:'area',id:area,name:'Inside',active:false}).ok,true); reject(); assert.equal(call('table-config',{action:'area',id:area,name:'Inside',active:true}).ok,true);
 assert.equal(call('open-order',{tableId:1}).data.id,order.id); assert.equal(call('order-items',{action:'add',orderId:order.id,productId:'qebapa'}).ok,true);
 assert.equal(call('table-config',table).ok,false); assert.equal(call('table-config',{action:'area',id:area,name:'Inside',active:false}).ok,false);
});

test('removing all pending items frees the table, keeps history, and permits safe reuse', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-empty-pending-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); let db=authorizedDatabase(openDatabase(dir)); seedTables(db); seedMenu(db);
 db.exec("INSERT INTO user_permissions VALUES(1,'tables.change'),(1,'employees.view'),(1,'business_days.close')"); const h={},event={},session={currentUserId:()=>1,authenticatedUserId:()=>1}, ipc={handle:(n,f)=>h[n]=f};
 const regs=[registerOrders,registerOrderItems,registerTables,registerMoveOrder,require('../src/desktop/table-config').registerTableConfig,require('../src/desktop/business-days').registerBusinessDays,require('../src/desktop/order-history').registerOrderHistory]; const register=()=>regs.forEach(f=>f(ipc,e=>e===event,db,session)); register();
 const call=(name,req)=>h['arra:'+name](event,req), one=call('open-order',{tableId:1}).data;
 let add=call('order-items',{action:'add',orderId:one.id,productId:'qebapa'}); assert.equal(add.ok,true); let id=add.data.items[0].id;
 assert.equal(call('tables',{}).data[0].untouched,0); db.exec("CREATE TRIGGER fail_remove BEFORE INSERT ON application_audit WHEN NEW.action='remove' BEGIN SELECT RAISE(ABORT,'fail'); END");
 assert.equal(call('order-items',{action:'remove',orderId:one.id,itemId:id}).ok,false); assert.equal(call('tables',{}).data[0].untouched,0); db.exec('DROP TRIGGER fail_remove');
 assert.equal(call('order-items',{action:'remove',orderId:one.id,itemId:id}).ok,true); assert.equal(call('tables',{}).data[0].untouched,1);
 assert.deepEqual(call('order-history',{orderId:one.id}).data.events.map(x=>x.action),['open','add','remove']);
 assert.equal(call('table-config',{action:'list'}).data.tables[0].hasOrder,0);
 db.exec("UPDATE financial_scopes SET scope='combined' WHERE user_id=1"); assert.deepEqual(call('business-days',{action:'list'}).data.issues.orders,[]); db.exec("UPDATE financial_scopes SET scope='waiter' WHERE user_id=1");
 db.close(); db=authorizedDatabase(openDatabase(dir)); register(); assert.equal(call('tables',{}).data[0].untouched,1); assert.equal(call('open-order',{tableId:1}).data.id,one.id);
 add=call('order-items',{action:'add',orderId:one.id,productId:'qebapa'}); id=add.data.items[0].id; assert.equal(call('order-items',{action:'decrement',orderId:one.id,itemId:id}).ok,true); assert.equal(call('tables',{}).data[0].untouched,1);
 const two=call('open-order',{tableId:2}).data; assert.equal(call('order-items',{action:'add',orderId:two.id,productId:'qebapa'}).ok,true);
 assert.equal(call('move-order',{orderId:two.id,sourceId:2,destinationId:1,requestId:'move-empty'}).ok,true); const history=call('order-history',{orderId:one.id}).data; assert.equal(history.order.status,'retired empty'); assert.equal(history.events.filter(e=>e.action==='remove').length,2);
 assert.equal(call('order-items',{action:'send',orderId:two.id,requestId:'sent'}).ok,true); assert.equal(call('tables',{}).data[0].untouched,0); db.close();
});

test('fully corrected sent items free the table while history and retries remain intact', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-corrected-free-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); let db=authorizedDatabase(openDatabase(dir)); seedTables(db); seedMenu(db);
 db.exec("INSERT INTO user_permissions VALUES(1,'tables.change'),(1,'employees.view'),(1,'orders.correct_sent'),(1,'business_days.close')"); const h={},event={},session={currentUserId:()=>1,authenticatedUserId:()=>1}, ipc={handle:(n,f)=>h[n]=f};
 const regs=[registerOrders,registerOrderItems,registerTables,registerMoveOrder,require('../src/desktop/table-config').registerTableConfig,require('../src/desktop/business-days').registerBusinessDays,require('../src/desktop/order-history').registerOrderHistory,require('../src/desktop/bills').registerBills]; const register=()=>regs.forEach(f=>f(ipc,e=>e===event,db,session)); register(); const call=(n,r)=>h['arra:'+n](event,r);
 const o=call('open-order',{tableId:1}).data, add=call('order-items',{action:'add',orderId:o.id,productId:'qebapa'}); let id=add.data.items[0].id;
 assert.equal(call('order-items',{action:'increment',orderId:o.id,itemId:id}).ok,true); assert.equal(call('order-items',{action:'send',orderId:o.id,requestId:'send-c'}).ok,true);
 const correct={action:'correct',orderId:o.id,itemId:id,quantity:1,reason:'Sample',requestId:'correction-1'};
 assert.equal(call('order-items',correct).ok,true); assert.equal(call('order-items',correct).ok,true); assert.equal(call('tables',{}).data[0].untouched,0);
 assert.equal(call('order-items',{action:'add',orderId:o.id,productId:'qebapa'}).ok,true); assert.equal(call('order-items',{...correct,requestId:'correction-2'}).ok,true);
 assert.equal(call('tables',{}).data[0].untouched,0); const pending=call('order-items',{action:'list',orderId:o.id}).data.items.find(x=>x.status==='pending');
 assert.equal(call('order-items',{action:'remove',orderId:o.id,itemId:pending.id}).ok,true); assert.equal(call('tables',{}).data[0].untouched,1);
 assert.equal(call('bill',{action:'review',orderId:o.id}).ok,false); assert.equal(call('table-config',{action:'list'}).data.tables[0].hasOrder,0);
 db.exec("UPDATE financial_scopes SET scope='combined' WHERE user_id=1"); assert.deepEqual(call('business-days',{action:'list'}).data.issues.orders,[]); db.exec("UPDATE financial_scopes SET scope='waiter' WHERE user_id=1");
 db.close(); db=authorizedDatabase(openDatabase(dir)); register(); assert.equal(call('tables',{}).data[0].untouched,1); assert.equal(call('open-order',{tableId:1}).data.id,o.id);
 assert.equal(call('order-items',correct).ok,true); assert.equal(db.prepare('SELECT count(*) n FROM sent_item_corrections').get().n,2);
 const table={action:'table',id:1,areaId:db.prepare('SELECT area_id FROM dining_tables WHERE id=1').get().area_id,capacity:4,active:false,create:false}; assert.equal(call('table-config',table).ok,true); assert.equal(call('order-items',{action:'add',orderId:o.id,productId:'qebapa'}).ok,false); assert.equal(call('table-config',{...table,active:true}).ok,true);
 const again=call('order-items',{action:'add',orderId:o.id,productId:'qebapa'}).data.items.find(i=>i.status==='pending'); assert.equal(call('tables',{}).data[0].untouched,0); assert.equal(call('order-items',{action:'remove',orderId:o.id,itemId:again.id}).ok,true); assert.equal(call('tables',{}).data[0].untouched,1);
 const history=call('order-history',{orderId:o.id}).data; assert.equal(history.items[0].correctedQuantity,2); assert.equal(history.events.filter(e=>e.action==='correct_sent').length,2); assert.equal(db.prepare('SELECT count(*) n FROM preparation_tickets').get().n,1);
 const incoming=call('open-order',{tableId:2}).data; assert.equal(call('order-items',{action:'add',orderId:incoming.id,productId:'qebapa'}).ok,true); assert.equal(call('move-order',{orderId:incoming.id,sourceId:2,destinationId:1,requestId:'move-c'}).ok,true);
 assert.equal(call('order-history',{orderId:o.id}).data.order.status,'retired empty'); assert.equal(call('order-items',correct).ok,false); assert.equal(db.prepare('SELECT count(*) n FROM sent_item_corrections').get().n,2); db.close();
});

test('a generated bill keeps its table taken and prevents correction', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-billed-free-')); const db=authorizedDatabase(openDatabase(dir)); t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})}); seedTables(db); seedMenu(db); db.exec("INSERT INTO user_permissions VALUES(1,'orders.correct_sent')");
 const h={},event={},session={currentUserId:()=>1,authenticatedUserId:()=>1},ipc={handle:(n,f)=>h[n]=f}; for(const f of [registerOrders,registerOrderItems,registerTables,require('../src/desktop/bills').registerBills]) f(ipc,e=>e===event,db,session);
 const call=(n,r)=>h['arra:'+n](event,r), order=call('open-order',{tableId:1}).data; const item=call('order-items',{action:'add',orderId:order.id,productId:'qebapa'}).data.items[0]; call('order-items',{action:'send',orderId:order.id,requestId:'bill-send'});
 const review=call('bill',{action:'review',orderId:order.id}); assert.equal(review.ok,true); assert.equal(call('bill',{action:'generate',orderId:order.id,fingerprint:review.data.fingerprint}).ok,true);
 assert.equal(call('order-items',{action:'correct',orderId:order.id,itemId:item.id,quantity:1,reason:'Sample',requestId:'billed-correction'}).ok,false);
 assert.equal(call('tables',{}).data[0].untouched,0); assert.equal(db.prepare('SELECT count(*) n FROM sent_item_corrections').get().n,0);
});

test('fully corrected moved orders become free and retain move and correction history', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-moved-corrected-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); let db=authorizedDatabase(openDatabase(dir)); seedTables(db); seedMenu(db); db.exec("INSERT INTO user_permissions VALUES(1,'orders.correct_sent'),(1,'employees.view')");
 const h={},event={},session={currentUserId:()=>1,authenticatedUserId:()=>1},ipc={handle:(n,f)=>h[n]=f}; const regs=[registerOrders,registerOrderItems,registerTables,registerMoveOrder,require('../src/desktop/order-history').registerOrderHistory]; const register=()=>regs.forEach(f=>f(ipc,e=>e===event,db,session)); register(); const call=(n,r)=>h['arra:'+n](event,r);
 const o=call('open-order',{tableId:1}).data, item=call('order-items',{action:'add',orderId:o.id,productId:'qebapa'}).data.items[0]; assert.equal(call('order-items',{action:'send',orderId:o.id,requestId:'sent'}).ok,true);
 const move={orderId:o.id,sourceId:1,destinationId:2,requestId:'first-move'}; assert.equal(call('move-order',move).ok,true); assert.equal(call('move-order',move).ok,true); assert.equal(call('tables',{}).data[1].untouched,0);
 const correction={action:'correct',orderId:o.id,itemId:item.id,quantity:1,reason:'Sample',requestId:'correct'}; assert.equal(call('order-items',correction).ok,true); assert.equal(call('tables',{}).data[1].untouched,1);
 db.close(); db=authorizedDatabase(openDatabase(dir)); register(); assert.equal(call('tables',{}).data[1].untouched,1); assert.equal(call('open-order',{tableId:2}).data.id,o.id); assert.equal(call('order-items',correction).ok,true);
 const incoming=call('open-order',{tableId:3}).data; assert.equal(call('order-items',{action:'add',orderId:incoming.id,productId:'qebapa'}).ok,true); assert.equal(call('move-order',{orderId:incoming.id,sourceId:3,destinationId:2,requestId:'second-move'}).ok,true);
 const history=call('order-history',{orderId:o.id}).data; assert.equal(history.order.status,'retired empty'); assert.equal(history.events.filter(e=>e.action==='move').length,1); assert.equal(history.events.filter(e=>e.action==='correct_sent').length,1); assert.equal(history.items[0].correctedQuantity,1); db.close();
});
