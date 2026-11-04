const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { authorizedDatabase } = require('./support/authorized-database');
const { seedTables } = require('../src/desktop/tables'); const { seedMenu } = require('../src/desktop/menu');
const { registerBills } = require('../src/desktop/bills');

test('review and generation preserve corrected snapshots, reject stale confirmation and retry safely', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-bill-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let db=authorizedDatabase(openDatabase(dir)); seedTables(db); seedMenu(db);
  db.exec("INSERT INTO orders (id,table_id,opened_at,status) VALUES (1,1,1,'open'); INSERT INTO order_items (id,order_id,product_id,name,unit_price,quantity,status) VALUES (1,1,'qebapa','Snapshot',230,3,'sent'),(2,1,'qebapa','Other',100,1,'sent'); INSERT INTO order_item_modifiers VALUES (1,'Size','Large',10); INSERT INTO sent_item_corrections (request_id,item_id,order_id,actor_id,quantity,reason,occurred_at) VALUES ('correction',1,1,1,1,'Sample',1);");
  const trusted={}; let call; const register=()=>registerBills({handle(_c,fn){call=fn;}},e=>e===trusted,db,{currentUserId: () => 1, authenticatedUserId: () => 1}); register();
  const review=()=>call(trusted,{action:'review',orderId:1}); const generate=fingerprint=>call(trusted,{action:'generate',orderId:1,fingerprint});
  assert.equal(call({}, {action:'review',orderId:1}).ok,false); assert.equal(call(trusted,{action:'generate',orderId:1,fingerprint:'bad'}).ok,false);
  db.prepare("DELETE FROM user_permissions WHERE user_id=1 AND permission='orders.change'").run(); assert.equal(review().error,'Access denied'); db.prepare("INSERT INTO user_permissions VALUES (1,'orders.change')").run();
  const first=review().data; assert.equal(first.total,560); assert.equal(first.lines[0].quantity,2); assert.equal(first.lines[0].modifiers[0].optionName,'Large');
  assert.equal(db.prepare('SELECT count(*) AS n FROM bills').get().n,0);
  db.exec("UPDATE order_items SET quantity=2 WHERE id=2"); assert.equal(generate(first.fingerprint).ok,false);
  const fresh=review().data; assert.equal(fresh.total,660); const result=generate(fresh.fingerprint); assert.equal(result.ok,true); assert.equal(generate(fresh.fingerprint).data.id,result.data.id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM bills').get().n,1); assert.throws(()=>db.exec("UPDATE order_items SET quantity=1 WHERE id=1"));
  assert.throws(()=>db.exec("INSERT INTO sent_item_corrections (request_id,item_id,order_id,actor_id,quantity,reason,occurred_at) VALUES ('later',1,1,1,1,'Sample',1)"));
  db.close(); db=authorizedDatabase(openDatabase(dir)); register(); assert.equal(review().data.total,660); assert.equal(review().data.lines[0].name,'Snapshot'); db.close();
});

test('pending and empty orders cannot be generated; failure rolls back all bill records', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-bill-fail-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); const db=authorizedDatabase(openDatabase(dir)); seedTables(db); seedMenu(db);
  db.exec("INSERT INTO orders (id,table_id,opened_at,status) VALUES (1,1,1,'open'); INSERT INTO order_items (id,order_id,product_id,name,unit_price,quantity,status) VALUES (1,1,'qebapa','Item',100,1,'pending');"); let call;registerBills({handle(_c,fn){call=fn;}},()=>true,db,{currentUserId: () => 1, authenticatedUserId: () => 1});const review=()=>call({}, {action:'review',orderId:1}); assert.equal(review().ok,false);
  db.exec("UPDATE order_items SET status='sent'; CREATE TRIGGER fail_bill_line BEFORE INSERT ON bill_lines BEGIN SELECT RAISE(ABORT,'failure'); END;");const preview=review().data; assert.equal(call({}, {action:'generate',orderId:1,fingerprint:preview.fingerprint}).ok,false);assert.equal(db.prepare('SELECT count(*) AS n FROM bills').get().n,0); db.close();
});
