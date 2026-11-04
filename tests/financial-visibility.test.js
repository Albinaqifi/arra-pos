const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { registerFinancialVisibility, CHANNEL } = require('../src/desktop/financial-visibility');

test('financial records, search and totals are scoped and fail closed', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-scope-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  for (const [id, scope] of [[1,'A'],[2,'B'],[3,'combined'],[4,'waiter'],[5,null]]) {
    db.prepare('INSERT INTO local_users(id,username,salt,password_hash) VALUES(?,?,?,?)').run(id, `sample-${id}`, Buffer.from([1]), Buffer.from([1]));
    db.prepare("INSERT INTO user_permissions VALUES (?, 'employees.view')").run(id);
    if (scope) db.prepare('INSERT INTO financial_scopes VALUES (?,?)').run(id, scope);
  }
  db.exec("INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample'); INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'); INSERT INTO menu_categories(id,name,active) VALUES('c','Sample',1); INSERT INTO menu_products(id,category_id,name,price,active) VALUES('sample','c','Sample',100,1); INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,status) VALUES (1,1,'sample','A line',100,1,'sent'),(2,2,'sample','B line',200,1,'sent'); INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,100,'a'),(2,2,1,1,200,'b'); INSERT INTO bill_lines(bill_id,item_id,name,unit_price,quantity,modifiers) VALUES (1,1,'A line',100,1,'[]'),(2,2,'B line',200,1,'[]'); INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,100,'card','A'),(2,1,2,200,'cash','B');");
  let current = 1, auth = 1, handler;
  const session = { currentUserId: () => current, authenticatedUserId: () => auth };
  registerFinancialVisibility({ handle: (name, fn) => { assert.equal(name, CHANNEL); handler = fn; } }, e => e.allowed, db, session);
  const call = req => handler({ allowed:true }, req);
  assert.deepEqual(call({action:'search',account:null}).data.map(x => x.account), ['A']);
  assert.deepEqual({...call({action:'aggregate',account:null}).data}, {count:1,total:100});
  assert.equal(call({action:'detail',paymentId:2}).ok, false);
  assert.equal(call({action:'detail',paymentId:1}).data.lines[0].name, 'A line');
  assert.equal(call({action:'search',account:'B'}).ok, false);
  current = auth = 2;
  assert.deepEqual(call({action:'search',account:null}).data.map(x => x.account), ['B']);
  assert.deepEqual({...call({action:'aggregate',account:null}).data}, {count:1,total:200});
  assert.equal(call({action:'detail',paymentId:1}).ok, false);
  assert.equal(call({action:'detail',paymentId:2}).data.lines[0].name, 'B line');
  assert.equal(call({action:'aggregate',account:'A'}).ok, false);
  current = auth = 3;
  assert.equal(call({action:'search',account:null}).data.length, 2);
  assert.deepEqual({...call({action:'aggregate',account:null}).data}, {count:2,total:300});
  assert.equal(call({action:'detail',paymentId:2}).data.payment.account, 'B');
  assert.equal(call({action:'detail',paymentId:2}).data.lines[0].name, 'B line');
  assert.equal(call({action:'search',account:'A'}).data.length, 1);
  assert.equal(call({action:'aggregate',account:'B'}).data.total, 200);
  for (const request of [null, [], {}, {action:'search',account:'C'}, {action:'aggregate',account:1}, {action:'detail',paymentId:1.5}, {action:'detail',paymentId:Number.MAX_SAFE_INTEGER+1}, {action:'detail',paymentId:999}, Object.create({action:'search',account:null})]) assert.equal(call(request).ok, false);
  for (const id of [4,5]) { current = auth = id; assert.equal(call({action:'search',account:null}).ok, false); }
  current = 3; auth = 1;
  assert.equal(call({action:'aggregate',account:null}).ok, false);
  current = auth = 3;
  assert.equal(call({action:'detail',paymentId:0}).ok, false);
  assert.equal(call({action:'search',account:null,extra:true}).ok, false);
  assert.equal(handler({allowed:false}, {action:'search',account:null}).ok, false);
  db.prepare('DELETE FROM user_permissions WHERE user_id=3').run();
  assert.equal(call({action:'search',account:null}).ok, false);
  current = auth = 1; db.exec('DROP TABLE financial_scopes');
  assert.equal(call({action:'search',account:null}).ok, false);
  assert.equal(call({action:'aggregate',account:null}).ok, false);
  assert.equal(call({action:'detail',paymentId:1}).ok, false);
});
