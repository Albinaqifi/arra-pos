const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { registerOperationalReports, CHANNEL } = require('../src/desktop/operational-reports');

test('paid bill reports enforce account scope, dates, authorization and snapshot values', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-report-')), db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  for (const [id,scope] of [[1,'A'],[2,'B'],[3,'combined'],[4,'waiter'],[5,null]]) {
    db.prepare('INSERT INTO local_users(id,username,salt,password_hash) VALUES(?,?,?,?)').run(id, `sample-${id}`, Buffer.from([1]), Buffer.from([1]));
    db.prepare("INSERT INTO user_permissions VALUES (?, 'employees.view')").run(id);
    if (scope) db.prepare('INSERT INTO financial_scopes VALUES (?,?)').run(id,scope);
  }
  db.exec(`INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample'),(3,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'),(3,3,1,'open');
    INSERT INTO menu_categories(id,name,active) VALUES('c','Sample',1);
    INSERT INTO menu_products(id,category_id,name,price,active) VALUES('p','c','Current',999,1),('p2','c','Current',999,1);
    INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,status) VALUES (1,1,'p','Old',100,2,'sent'),(2,2,'p','Other',200,1,'sent'),(3,3,'p','Unpaid',300,1,'sent'),(4,1,'p2','Old',0,1,'sent'),(5,1,'p','Renamed',0,1,'sent');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,200,'a'),(2,2,2,1,200,'b'),(3,3,1,1,300,'c');
    INSERT INTO bill_lines(bill_id,item_id,name,unit_price,quantity,modifiers) VALUES (1,1,'Old',100,2,'[]'),(2,2,'Other',200,1,'[]'),(3,3,'Unpaid',300,1,'[]'),(1,4,'Old',0,1,'[]'),(1,5,'Renamed',0,1,'[]');
    INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,100,200,'card','A'),(2,2,200,200,'cash','B');`);
  let current=1, auth=1, handler;
  registerOperationalReports({handle:(channel,fn) => { assert.equal(channel,CHANNEL); handler=fn; }}, e => e.allowed, db, {currentUserId:()=>current,authenticatedUserId:()=>auth});
  const call = req => handler({allowed:true},req), range={from:100,to:201,account:null};
  assert.deepEqual(call(range).data, {products:[{productId:'p',name:'Renamed',quantity:3,value:200},{productId:'p2',name:'Old',quantity:1,value:0}],tables:[{tableId:1,count:1}],waiters:[{actor:'sample-1',count:1}]});
  assert.equal(call({...range,account:'B'}).ok,false);
  current=auth=2;
  assert.deepEqual(call(range).data, {products:[{productId:'p',name:'Other',quantity:1,value:200}],tables:[{tableId:2,count:1}],waiters:[{actor:'sample-2',count:1}]});
  current=auth=3;
  assert.equal(call(range).data.products.length,2);
  assert.deepEqual(call({from:101,to:200,account:null}).data, {products:[],tables:[],waiters:[]});
  assert.equal(call({...range,account:'A'}).data.products.length,2);
  assert.deepEqual(call(range).data.products, [{productId:'p',name:'Other',quantity:4,value:400},{productId:'p2',name:'Old',quantity:1,value:0}]);
  for (const req of [null, [], {}, {...range,extra:1}, {...range,from:-1}, {...range,to:100}, {...range,account:'C'}, {...range,from:1.5}]) assert.equal(call(req).ok,false);
  assert.equal(handler({allowed:false},range).ok,false);
  for (const id of [4,5]) { current=auth=id; assert.equal(call(range).ok,false); }
  current=3; auth=1; assert.equal(call(range).ok,false);
  current=auth=3; db.prepare('DELETE FROM user_permissions WHERE user_id=3').run(); assert.equal(call(range).ok,false);
});

test('report fails closed if its database becomes unavailable', () => {
  let handler;
  const db = { prepare() { throw new Error('simulated database failure'); } };
  registerOperationalReports({handle: (_channel, fn) => { handler = fn; }}, () => true, db,
    {currentUserId: () => 1, authenticatedUserId: () => 1});
  assert.deepEqual(handler({}, {from: 0, to: 1, account: null}), {ok:false});
});

