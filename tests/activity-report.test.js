const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {openDatabase} = require('../src/desktop/database');
const {registerActivityReport,CHANNEL} = require('../src/desktop/activity-report');
const {registerOrderHistory} = require('../src/desktop/order-history');
test('activity reconciles historical prices, repeated corrections, effective scope and direct authorization', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-activity-')),db=openDatabase(dir);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  for(const [id,scope] of [[1,'A'],[2,'B'],[3,'combined'],[4,'waiter'],[5,'waiter']]) {
    db.prepare('INSERT INTO local_users(id,username,salt,password_hash,active) VALUES(?,?,?,?,?)').run(id,'sample-'+id,Buffer.from([1]),Buffer.from([1]),id===5?0:1);
    db.prepare('INSERT INTO financial_scopes VALUES(?,?)').run(id,scope);
    if(id<4) db.prepare("INSERT INTO user_permissions VALUES(?,'employees.view')").run(id);
  }
  db.exec(`INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample'),(3,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'),(3,3,1,'open');
    INSERT INTO menu_categories(id,name,active) VALUES('c','Sample',1);
    INSERT INTO menu_products(id,category_id,name,price,active) VALUES('p','c','Current',999,1);
    INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,status) VALUES(1,1,'p','Historic',125,4,'sent'),(2,2,'p','Other',300,2,'sent'),(3,3,'p','Unpaid',70,1,'sent');
    INSERT INTO order_item_modifiers VALUES(1,'sample','choice',25);
    INSERT INTO sent_item_corrections(request_id,item_id,order_id,actor_id,quantity,reason,occurred_at) VALUES('a',1,1,4,1,'one',100),('b',1,1,4,1,'two',101),('c',2,2,5,1,'three',102),('d',3,3,4,1,'four',103);
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,4,1,250,'a'),(2,2,5,1,300,'b');
    INSERT INTO payments(id,bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,4,110,250,'card','A'),(2,2,5,111,300,'cash','B');`);
  db.prepare("INSERT INTO application_audit(actor_id,occurred_at,action,entity_type,entity_id,order_id,context) VALUES(4,100,'correct_sent','order_item','1',1,?)").run(JSON.stringify({correctionId:1,source:'administrator'}));
  let current=1,auth=1,handler; registerActivityReport({handle:(c,fn)=>{assert.equal(c,CHANNEL);handler=fn;}},e=>e.allowed,db,{currentUserId:()=>current,authenticatedUserId:()=>auth});
  let history; registerOrderHistory({handle:(_,fn)=>history=fn},e=>e.allowed,db,{currentUserId:()=>current,authenticatedUserId:()=>auth});
  const call=req=>handler({allowed:true},req), range={from:100,to:112};
  let result=call({action:'performance',...range,staffId:4});
  assert.equal(result.ok,true); assert.deepEqual([result.data.total,result.data.orders,result.data.cash,result.data.card,result.data.quantity,result.data.value],[250,1,0,250,2,250]);
  assert.deepEqual(result.data.cancellations.map(r=>r.unitPrice),[125,125]);
  assert.equal(result.data.cancellations[0].source,'administrator');
  assert.equal(result.data.cancellations[1].source,null);
  assert.equal(call({action:'cancellations',...range,staffId:null}).data.cancellations.length,2);
  assert.equal(history({allowed:true},{orderId:3}).ok,false);
  assert.equal(call({action:'staff'}).data.find(u=>u.id===5).active,0);
  current=auth=2; assert.equal(call({action:'performance',...range,staffId:4}).data.total,0);
  assert.equal(call({action:'cancellations',...range,staffId:null}).data.cancellations.length,1);
  assert.equal(call({action:'performance',...range,staffId:4}).data.quantity,0);
  assert.equal(history({allowed:true},{orderId:3}).ok,false);
  db.exec("INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(2,1,120,'sample');");
  assert.equal(call({action:'performance',...range,staffId:5}).data.total,0);
  current=auth=1; assert.equal(call({action:'performance',...range,staffId:5}).data.total,300);
  assert.equal(call({action:'cancellations',from:100,to:101,staffId:null}).data.cancellations.length,1);
  current=auth=3; assert.equal(call({action:'cancellations',...range,staffId:null}).data.cancellations.length,4);
  assert.equal(history({allowed:true},{orderId:3}).ok,true);
  result=call({action:'performance',...range,staffId:4});
  assert.equal(result.data.quantity,3); assert.equal(result.data.value,320);
  // A moved-item connection must not disclose a correction from an order paid
  // by another account, even through a shared unpaid order.
  db.prepare("INSERT INTO application_audit(actor_id,occurred_at,action,entity_type,entity_id,order_id,context) VALUES(1,1,'move_items','order','1',1,?)").run(JSON.stringify({destinationOrderId:3,itemIds:[1]}));
  current=auth=2; assert.equal(call({action:'cancellations',...range,staffId:null}).data.cancellations.length,0);
  current=auth=1; assert.equal(call({action:'cancellations',...range,staffId:null}).data.cancellations.length,1);
  current=auth=3; assert.equal(call({action:'cancellations',...range,staffId:null}).data.cancellations.length,4);
  db.prepare('INSERT INTO order_cancellations(order_id,actor_id,occurred_at,reason,items) VALUES(3,4,105,?,?)').run('whole order',JSON.stringify([{id:3,name:'Unpaid',quantity:1,status:'sent'}]));
  current=auth=3; const whole=call({action:'performance',...range,staffId:4}).data;
  assert.equal(whole.wholeUnavailable,true);
  assert.equal(whole.cancellations.find(c=>c.source==='order').unitPrice,null);
  assert.equal(whole.cancellations.find(c=>c.source==='order').quantity,1);
  current=auth=2; assert.equal(call({action:'cancellations',...range,staffId:null}).data.cancellations.length,0);
  current=auth=4; assert.equal(call({action:'staff'}).ok,false); current=1;auth=2; assert.equal(call({action:'staff'}).ok,false);
  assert.equal(handler({allowed:false},{action:'staff'}).ok,false);
  assert.equal(call({action:'performance',...range,staffId:4,extra:1}).ok,false);
});



test('large move history fails closed with a bounded request', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-activity-limit-')),db=openDatabase(dir); t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01'); INSERT INTO financial_scopes VALUES(1,'A'); INSERT INTO user_permissions VALUES(1,'employees.view'); INSERT INTO dining_tables(id,area) VALUES(1,'sample'); INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<5001) INSERT INTO application_audit(actor_id,occurred_at,action,entity_type,entity_id,order_id,context) SELECT 1,x,'move_items','order','1',1,'{"destinationOrderId":1}' FROM n;`);
  let handler; registerActivityReport({handle:(_,fn)=>handler=fn},()=>true,db,{currentUserId:()=>1,authenticatedUserId:()=>1});
  assert.deepEqual(handler({}, {action:'cancellations',from:1,to:2,staffId:null}),{ok:true,data:{cancellations:[]}});
  db.exec(`INSERT INTO menu_categories(id,name,active) VALUES('c','Sample',1); INSERT INTO menu_products(id,category_id,name,price,active) VALUES('p','c','Sample',1,1); INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,status) VALUES(1,1,'p','Sample',1,1,'sent'); INSERT INTO sent_item_corrections(request_id,item_id,order_id,actor_id,quantity,reason,occurred_at) VALUES('sample',1,1,1,1,'sample',1);`);
  assert.deepEqual(handler({}, {action:'cancellations',from:1,to:2,staffId:null}),{ok:false,tooLarge:true});
});
test('version 34 adds report indexes without altering history and rolls back invalid audit', t=>{
  const {DatabaseSync}=require('node:sqlite');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-activity-upgrade-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let db=openDatabase(dir);
  db.exec(`DROP TABLE IF EXISTS wallet_cancellations; DROP TABLE IF EXISTS wallet_prepared; DROP TABLE IF EXISTS wallet_requests; DROP TABLE IF EXISTS wallet_closings; DROP TABLE IF EXISTS wallet_movements; DROP TABLE IF EXISTS wallet_baselines; DROP TABLE IF EXISTS shift_print_results; DROP TABLE IF EXISTS shift_print_attempts; DROP TABLE IF EXISTS payment_shifts; DROP TABLE IF EXISTS shift_closes; DROP TABLE IF EXISTS restaurant_shifts; DROP TABLE IF EXISTS shift_coverage_unavailable; INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01'); INSERT INTO dining_tables(id,area) VALUES(1,'sample'); INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'); DROP INDEX activity_move_source; DROP INDEX activity_move_destination; DROP INDEX activity_correction_source; DROP INDEX activity_correction_date; DROP INDEX activity_correction_actor_date; DROP INDEX activity_order_cancellation_date; DROP INDEX activity_order_cancellation_actor_date; DROP INDEX activity_payment_actor_date; INSERT INTO application_audit(actor_id,occurred_at,action,entity_type,entity_id,order_id,context) VALUES(1,1,'move_items','order','1',1,'not-json'); PRAGMA user_version=34;`); db.close();
  assert.throws(()=>openDatabase(dir));
  db=new DatabaseSync(path.join(dir,'arra.sqlite')); assert.equal(db.prepare('PRAGMA user_version').get().user_version,34); assert.equal(db.prepare('SELECT context FROM application_audit').get().context,'not-json'); assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='index' AND name LIKE 'activity_%'").get().n,0); db.close();
});
test('version 34 upgrade preserves valid move history and adds lookup indexes', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-activity-upgrade-ok-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); let db=openDatabase(dir);
  db.exec(`DROP TABLE IF EXISTS wallet_cancellations; DROP TABLE IF EXISTS wallet_prepared; DROP TABLE IF EXISTS wallet_requests; DROP TABLE IF EXISTS wallet_closings; DROP TABLE IF EXISTS wallet_movements; DROP TABLE IF EXISTS wallet_baselines; DROP TABLE IF EXISTS shift_print_results; DROP TABLE IF EXISTS shift_print_attempts; DROP TABLE IF EXISTS payment_shifts; DROP TABLE IF EXISTS shift_closes; DROP TABLE IF EXISTS restaurant_shifts; DROP TABLE IF EXISTS shift_coverage_unavailable; INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01'); INSERT INTO dining_tables(id,area) VALUES(1,'sample'); INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'); INSERT INTO application_audit(actor_id,occurred_at,action,entity_type,entity_id,order_id,context) VALUES(1,1,'move_items','order','1',1,'{"destinationOrderId":1}'); DROP INDEX activity_move_source; DROP INDEX activity_move_destination; DROP INDEX activity_correction_source; DROP INDEX activity_correction_date; DROP INDEX activity_correction_actor_date; DROP INDEX activity_order_cancellation_date; DROP INDEX activity_order_cancellation_actor_date; DROP INDEX activity_payment_actor_date; PRAGMA user_version=34;`); db.close();
  db=openDatabase(dir); assert.equal(db.prepare('PRAGMA user_version').get().user_version,41); assert.equal(db.prepare('SELECT context FROM application_audit').get().context,'{"destinationOrderId":1}'); assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='index' AND name LIKE 'activity_%'").get().n,8); db.close();
});
test('sparse actor and connected-history lookups use report indexes', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-activity-plan-')), db=openDatabase(dir); t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  const cases=[
    ["SELECT c.id FROM sent_item_corrections c JOIN order_items i ON i.id=c.item_id JOIN orders o ON o.id=c.order_id JOIN local_users u ON u.id=c.actor_id WHERE c.actor_id=? AND c.occurred_at>=? AND c.occurred_at<? ORDER BY c.occurred_at,c.id LIMIT ?",'activity_correction_actor_date',[1,1,2,5001]],
    ["SELECT c.order_id FROM order_cancellations c JOIN orders o ON o.id=c.order_id JOIN local_users u ON u.id=c.actor_id WHERE c.actor_id=? AND c.occurred_at>=? AND c.occurred_at<? LIMIT ?",'activity_order_cancellation_actor_date',[1,1,2,5001]],
    ["SELECT p.id FROM payments p JOIN bills b ON b.id=p.bill_id LEFT JOIN payment_account_corrections c ON c.payment_id=p.id WHERE p.actor_id=? AND p.paid_at>=? AND p.paid_at<? LIMIT ?",'activity_payment_actor_date',[1,1,2,5001]],
    ["SELECT order_id FROM application_audit WHERE action='move_items' AND entity_type='order' AND json_extract(context,'$.destinationOrderId')=? LIMIT ?",'activity_move_destination',[1,5001]],
    ["SELECT context FROM application_audit WHERE action='correct_sent' AND entity_type='order_item' AND json_extract(context,'$.correctionId')=? LIMIT 2",'activity_correction_source',[1]]
  ];
  for(const [sql,index,args] of cases) assert.ok(db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args).some(r=>r.detail.includes(index)),index);
});
