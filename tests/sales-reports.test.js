const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { registerFinancialVisibility } = require('../src/desktop/financial-visibility');
test('sales reports reconcile payments and corrections within scope and period', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-sales-')), db=openDatabase(dir);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  for (const [id,scope] of [[1,'A'],[2,'B'],[3,'combined'],[4,'waiter']]) {
    db.prepare('INSERT INTO local_users(id,username,salt,password_hash) VALUES(?,?,?,?)').run(id,`sample-${id}`,Buffer.from([1]),Buffer.from([1]));
    db.prepare("INSERT INTO user_permissions VALUES (?, 'employees.view')").run(id);
    db.prepare('INSERT INTO financial_scopes VALUES (?,?)').run(id,scope);
  }
  db.exec(`INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample'),(3,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'),(3,3,1,'open');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,100,'a'),(2,2,1,1,200,'b'),(3,3,1,1,300,'c');
    INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,100,100,'card','A'),(2,1,200,200,'cash','B'),(3,1,300,300,'cash','B');
    INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(2,1,250,'sample');`);
  const day=db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id;
  let current=3, auth=3, handler;
  registerFinancialVisibility({handle:(_n,fn)=>handler=fn},e=>e.allowed,db,{currentUserId:()=>current,authenticatedUserId:()=>auth});
  const call=r=>handler({allowed:true},r), range={action:'report',from:100,to:301,dayId:null,account:null,method:null};
  const all=call(range).data;
  assert.deepEqual(all.groups,[{account:'A',method:'card',count:1,total:100},{account:'A',method:'cash',count:1,total:200},{account:'B',method:'cash',count:1,total:300}]);
  assert.equal(all.records[0].tableId,1); assert.equal(all.records[0].waiter,'sample-1');
  assert.equal(all.records.reduce((sum,r)=>sum+r.amount,0),600);
  assert.equal(all.corrections.length,1); assert.equal(all.corrections[0].paymentId,2);
  assert.equal(call({...range,to:200}).data.records.length,1);
  assert.equal(call({...range,from:200,to:201,method:'card'}).data.records.length,0);
  assert.equal(call({...range,from:null,to:null,dayId:day,account:'A',method:'cash'}).data.groups[0].total,200);
  assert.equal(call({...range,from:null,to:null,dayId:day+999}).ok,false);
  current=auth=1; assert.equal(call(range).data.records.length,2); assert.equal(call(range).data.corrections,null); assert.equal(call({action:'detail',paymentId:2}).data.corrections,null); assert.equal(Object.hasOwn(call({action:'detail',paymentId:2}).data.payment,'originalAccount'),false); assert.equal(call({...range,account:'B'}).ok,false);
  current=auth=2; assert.deepEqual(call(range).data.records.map(x=>x.amount),[300]); assert.equal(call(range).data.corrections,null); assert.equal(call({...range,account:'A'}).ok,false);
  for (const req of [{...range,method:'other'},{...range,from:-1},{...range,to:100},{...range,extra:1},{...range,dayId:day},{...range,from:null,to:null,dayId:0}]) assert.equal(call(req).ok,false);
  assert.equal(handler({allowed:false},range).ok,false);
  current=auth=4; assert.equal(call(range).ok,false); current=3; auth=1; assert.equal(call(range).ok,false);
  current=auth=3; db.prepare('DELETE FROM user_permissions WHERE user_id=3').run(); assert.equal(call(range).ok,false);
});
