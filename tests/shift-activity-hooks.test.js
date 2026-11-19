const { removeFiscalSchemaSql } = require('./support/historical-database');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openDatabase}=require('../src/desktop/database');
const {seedTables}=require('../src/desktop/tables');
const {seedMenu}=require('../src/desktop/menu');
const {registerOrderItems}=require('../src/desktop/order-items');
const {registerBusinessDays}=require('../src/desktop/business-days');
const {registerPayments}=require('../src/desktop/payments');

test('real service mutations activate shifts atomically; reads and retries leave the successor idle',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-shift-hooks-')),db=openDatabase(dir);
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'combined',x'00',x'00'),(2,'waiter',x'00',x'00'); INSERT INTO financial_scopes VALUES(1,'combined'),(2,'waiter'); INSERT INTO user_permissions VALUES(1,'business_days.close'),(2,'orders.view'),(2,'orders.change');");
 seedTables(db);seedMenu(db);
 db.exec("INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'); INSERT INTO order_waiter_ownership SELECT id,2,2,1,'open' FROM orders WHERE id NOT IN (SELECT order_id FROM order_waiter_ownership); INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,2,1,1,100,'carried');");
 let actor=1;const handlers={},ipc={handle:(name,fn)=>handlers[name]=fn},session={currentUserId:()=>actor,authenticatedUserId:()=>actor};
 for(const register of [registerOrderItems,registerBusinessDays,registerPayments])register(ipc,()=>true,db,session);
 const waiter=fn=>{actor=2;try{return fn();}finally{actor=1;}};
 const order=req=>waiter(()=>handlers['arra:order-items']({},req)),day=req=>handlers['arra:business-days']({},req),pay=req=>waiter(()=>handlers['arra:payment']({},req));
 const active=()=>day({action:'shiftList'}).data.shifts[0];
 assert.equal(order({action:'list',orderId:1}).ok,true);assert.equal(day({action:'shiftList'}).data.shifts.length,0);
 assert.equal(order({action:'add',orderId:1,productId:'missing'}).ok,false);assert.equal(day({action:'shiftList'}).data.shifts.length,0);
 assert.equal(order({action:'add',orderId:1,productId:'qebapa'}).ok,true);
 assert.equal(order({action:'send',orderId:1,requestId:'round-1'}).ok,true);
 const pending=order({action:'add',orderId:1,productId:'qebapa'}).data.items.find(i=>i.status==='pending');
 const first=active();assert.equal(first.reportable,true);assert.equal(first.total,0);
 assert.equal(day({action:'shiftClose',shiftId:first.id}).ok,true);
 assert.equal(order({action:'send',orderId:1,requestId:'round-1'}).ok,true);assert.equal(active().reportable,false);
 assert.equal(order({action:'note',orderId:1,itemId:pending.id,note:pending.note}).ok,true);assert.equal(active().reportable,false);
 db.exec("CREATE TRIGGER fail_item_audit BEFORE INSERT ON application_audit WHEN NEW.action='add' BEGIN SELECT RAISE(ABORT,'sample'); END");
 assert.equal(order({action:'add',orderId:1,productId:'qebapa'}).ok,false);assert.equal(active().reportable,false);
 assert.equal(db.prepare("SELECT count(*) AS n FROM order_items WHERE status='pending'").get().n,1);db.exec('DROP TRIGGER fail_item_audit');
 db.exec("CREATE TRIGGER fail_payment AFTER INSERT ON payment_shifts BEGIN SELECT RAISE(ABORT,'sample'); END");
 const request={billId:1,method:'cash',account:'B'};
 assert.equal(pay(request).ok,false);assert.equal(active().reportable,false);assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n,0);
 db.exec('DROP TRIGGER fail_payment');assert.equal(pay(request).ok,true);let second=active();assert.equal(second.reportable,true);assert.equal(second.total,100);
 assert.equal(day({action:'shiftClose',shiftId:second.id}).ok,true);assert.equal(pay(request).ok,true);assert.equal(active().reportable,false);
 assert.equal(db.prepare('SELECT count(*) AS n FROM payment_shifts').get().n,1);
});

test('v38 empty-table move does not disable shift coverage on upgrade',t=>{
 const {registerOrders}=require('../src/desktop/orders'),{registerMoveOrder}=require('../src/desktop/move-order');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-shift-v38-empty-move-'));let db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'combined',x'00',x'00'),(2,'waiter',x'00',x'00'); INSERT INTO financial_scopes VALUES(1,'combined'),(2,'waiter'); INSERT INTO user_permissions VALUES(1,'business_days.close'),(2,'orders.view'),(2,'orders.change');");seedTables(db);seedMenu(db);
 db.exec(removeFiscalSchemaSql + 'DROP TABLE IF EXISTS order_waiter_ownership; DROP TABLE IF EXISTS legacy_unassigned_orders; DROP TABLE IF EXISTS wallet_cancellations; DROP TABLE IF EXISTS wallet_prepared; DROP TABLE IF EXISTS wallet_requests; DROP TABLE IF EXISTS wallet_closings; DROP TABLE IF EXISTS wallet_movements; DROP TABLE IF EXISTS wallet_baselines; DROP TABLE IF EXISTS shift_print_results; DROP TABLE IF EXISTS shift_print_attempts; DROP TABLE payment_shifts; DROP TABLE shift_closes; DROP TABLE restaurant_shifts; DROP TABLE shift_coverage_unavailable; DROP TABLE IF EXISTS verified_waiter_pins; PRAGMA user_version=38');
 let actor=2,handlers={},session={currentUserId:()=>actor,authenticatedUserId:()=>actor};
 // Reconstruct the v38 open and empty move using the historical schema.
 db.exec(`INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
   INSERT INTO application_audit(actor_id,occurred_at,action,entity_type,entity_id,order_id,context) VALUES(2,(SELECT opened_at+1 FROM business_days WHERE closed_at IS NULL),'open','order','1',1,'{"tableId":1}');
   UPDATE orders SET table_id=2 WHERE id=1;
   INSERT INTO application_audit(actor_id,occurred_at,action,entity_type,entity_id,order_id,context) VALUES(2,(SELECT opened_at+2 FROM business_days WHERE closed_at IS NULL),'move','order','1',1,'{"sourceId":1,"destinationId":2,"requestId":"empty-move"}');`);
 const id=1;
 const timing=db.prepare("SELECT d.opened_at AS dayOpened,a.occurred_at AS movedAt FROM business_days d JOIN application_audit a ON a.action='move' WHERE d.closed_at IS NULL").get();
 assert.equal(timing.movedAt,timing.dayOpened+2);
 assert.equal(db.prepare("SELECT count(*) AS n FROM application_audit WHERE action='move'").get().n,1);db.close();db=openDatabase(dir);
 handlers={};for(const register of [registerOrders,registerOrderItems,registerBusinessDays])register({handle:(name,fn)=>handlers[name]=fn},()=>true,db,session);
 actor=1;assert.equal(handlers['arra:business-days']({}, {action:'shiftList'}).data.coverage,'available');
 actor=2;const reopened=handlers['arra:open-order']({}, {tableId:2});assert.equal(reopened.ok,true);assert.notEqual(reopened.data.id,id);
 assert.equal(db.prepare('SELECT retired_empty FROM orders WHERE id=?').get(id).retired_empty,1);
 assert.equal(handlers['arra:order-items']({}, {action:'add',orderId:reopened.data.id,productId:'qebapa'}).ok,true);
 actor=1;const shifts=handlers['arra:business-days']({}, {action:'shiftList'}).data.shifts;assert.equal(shifts.length,1);assert.equal(shifts[0].reportable,true);
});

test('v38 moved carried order with surviving items remains conservatively unavailable',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-shift-v38-carried-'));let db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'combined',x'00',x'00'); INSERT INTO financial_scopes VALUES(1,'combined'); INSERT INTO user_permissions VALUES(1,'business_days.close');");seedTables(db);seedMenu(db);
 db.exec(removeFiscalSchemaSql + `INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,2,1,'open'); INSERT INTO order_items(order_id,product_id,name,unit_price,quantity,status) VALUES(1,'qebapa','sample',100,1,'pending');
 INSERT INTO application_audit(actor_id,occurred_at,action,entity_type,entity_id,order_id,context) VALUES(1,unixepoch()*1000+1000,'move','order','1',1,'{"sourceId":1,"destinationId":2,"requestId":"move"}');
 DROP TABLE IF EXISTS order_waiter_ownership; DROP TABLE IF EXISTS legacy_unassigned_orders; DROP TABLE IF EXISTS wallet_cancellations; DROP TABLE IF EXISTS wallet_prepared; DROP TABLE IF EXISTS wallet_requests; DROP TABLE IF EXISTS wallet_closings; DROP TABLE IF EXISTS wallet_movements; DROP TABLE IF EXISTS wallet_baselines; DROP TABLE IF EXISTS shift_print_results; DROP TABLE IF EXISTS shift_print_attempts; DROP TABLE payment_shifts; DROP TABLE shift_closes; DROP TABLE restaurant_shifts; DROP TABLE shift_coverage_unavailable; DROP TABLE IF EXISTS verified_waiter_pins; PRAGMA user_version=38`);
 db.close();db=openDatabase(dir);let handler;registerBusinessDays({handle:(_,fn)=>handler=fn},()=>true,db,{currentUserId:()=>1,authenticatedUserId:()=>1});
 assert.equal(handler({}, {action:'shiftList'}).data.coverage,'unavailable');
});

test('v38 carried order with prior-day activity does not make an idle day unavailable',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-shift-v38-carried-idle-'));let db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'combined',x'00',x'00'),(2,'waiter',x'00',x'00'); INSERT INTO financial_scopes VALUES(1,'combined'),(2,'waiter'); INSERT INTO user_permissions VALUES(1,'business_days.close'),(2,'orders.view'),(2,'orders.change');");seedTables(db);seedMenu(db);
 db.exec(removeFiscalSchemaSql + `UPDATE business_days SET opened_at=1000 WHERE closed_at IS NULL;
 INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'); INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,status) VALUES(1,1,'qebapa','sample',100,1,'pending');
 INSERT INTO application_audit(actor_id,occurred_at,action,entity_type,entity_id,order_id,context) VALUES(2,1,'open','order','1',1,'{}'),(2,2,'add','order_item','1',1,'{}');
 DROP TABLE IF EXISTS order_waiter_ownership; DROP TABLE IF EXISTS legacy_unassigned_orders; DROP TABLE IF EXISTS wallet_cancellations; DROP TABLE IF EXISTS wallet_prepared; DROP TABLE IF EXISTS wallet_requests; DROP TABLE IF EXISTS wallet_closings; DROP TABLE IF EXISTS wallet_movements; DROP TABLE IF EXISTS wallet_baselines; DROP TABLE IF EXISTS shift_print_results; DROP TABLE IF EXISTS shift_print_attempts; DROP TABLE payment_shifts; DROP TABLE shift_closes; DROP TABLE restaurant_shifts; DROP TABLE shift_coverage_unavailable; DROP TABLE IF EXISTS verified_waiter_pins; PRAGMA user_version=38`);
 db.close();db=openDatabase(dir);require('./support/assign-legacy-order').assignLegacyOrder(db,1,2);let actor=1,handlers={},session={currentUserId:()=>actor,authenticatedUserId:()=>actor};for(const register of [registerBusinessDays,registerOrderItems])register({handle:(name,fn)=>handlers[name]=fn},()=>true,db,session);
 assert.equal(handlers['arra:business-days']({}, {action:'shiftList'}).data.coverage,'available');actor=2;
 assert.equal(handlers['arra:order-items']({}, {action:'add',orderId:1,productId:'qebapa'}).ok,true);actor=1;
 const list=handlers['arra:business-days']({}, {action:'shiftList'}).data;assert.equal(list.shifts.length,1);assert.equal(list.shifts[0].reportable,true);
});
