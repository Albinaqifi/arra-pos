const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {openDatabase} = require('../src/desktop/database');
const {registerActivityReport} = require('../src/desktop/activity-report');

test('unpaid billed history is shared but an unbilled connected order restricts A and B', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-access-')), db=openDatabase(dir);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample-a',x'01',x'01'),(2,'sample-b',x'01',x'01'),(3,'sample-combined',x'01',x'01'),(4,'sample-waiter',x'01',x'01');
    INSERT INTO financial_scopes VALUES(1,'A'),(2,'B'),(3,'combined'),(4,'waiter');
    INSERT INTO user_permissions VALUES(1,'employees.view'),(2,'employees.view'),(3,'employees.view');
    INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open');
    INSERT INTO menu_categories(id,name,active) VALUES('c','Sample',1);
    INSERT INTO menu_products(id,category_id,name,price,active) VALUES('p','c','Sample',10,1);
    INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,status) VALUES(1,1,'p','Sample',10,1,'sent');
    INSERT INTO sent_item_corrections(request_id,item_id,order_id,actor_id,quantity,reason,occurred_at) VALUES('one',1,1,4,1,'sample',100);
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,4,1,0,'sample');`);
  let user=1,handler; registerActivityReport({handle:(_,fn)=>handler=fn},()=>true,db,{currentUserId:()=>user,authenticatedUserId:()=>user});
  const request={action:'performance',from:1,to:200,staffId:4};
  for (user of [1,2,3]) {const r=handler({},request); assert.equal(r.ok,true); assert.equal(r.data.quantity,1); assert.equal(r.data.value,10);}
  db.prepare("INSERT INTO application_audit(actor_id,occurred_at,action,entity_type,entity_id,order_id,context) VALUES(1,2,'move_items','order','1',1,?)").run(JSON.stringify({destinationOrderId:2,itemIds:[1]}));
  for (user of [1,2]) {const r=handler({},request); assert.equal(r.ok,true); assert.equal(r.data.quantity,0); assert.equal(r.data.cancellations.length,0);}
  user=3; const r=handler({},request); assert.equal(r.ok,true); assert.equal(r.data.quantity,1); assert.equal(r.data.value,10);
});
