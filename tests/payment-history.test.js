const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { registerFinancialVisibility } = require('../src/desktop/financial-visibility');

test('history links immutable correction and bill records while enforcing effective scope', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-history-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, {recursive:true, force:true}); });
  for (const [id, scope] of [[1,'A'],[2,'B'],[3,'combined']]) {
    db.prepare('INSERT INTO local_users(id,username,salt,password_hash) VALUES(?,?,?,?)').run(id, `sample-${id}`, Buffer.from([1]), Buffer.from([1]));
    db.prepare("INSERT INTO user_permissions VALUES (?, 'employees.view')").run(id);
    db.prepare('INSERT INTO financial_scopes VALUES (?,?)').run(id, scope);
  }
  db.exec(`INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample'),(3,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,10,'open'),(2,2,11,'open'),(3,3,12,'open');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,20,100,'a'),(2,2,2,21,200,'b'),(3,3,3,22,300,'c');
    INSERT INTO payments(id,bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,2,30,100,'cash','B'),(2,2,2,31,200,'cash','B');
    INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(1,3,40,'sample reason');`);
  let user = 1, auth = 1, handler;
  registerFinancialVisibility({handle:(_, fn) => {handler=fn;}}, e => e.allowed, db, {currentUserId:()=>user, authenticatedUserId:()=>auth});
  const call = req => handler({allowed:true}, req);
  const detail = call({action:'detail',paymentId:1}).data;
  assert.equal(Object.hasOwn(detail.payment,'originalAccount'),false); assert.equal(detail.payment.account,'A'); assert.equal(detail.corrections,null);
  assert.equal(detail.payment.actorId,2); assert.equal(detail.payment.paidAt,30);
  assert.equal(detail.bill.orderId,1); assert.equal(detail.bill.actorId,1); assert.equal(detail.bill.generatedAt,20);
  assert.equal(call({action:'detail',paymentId:2}).ok,false);
  assert.deepEqual(call({action:'unpaid'}).data.map(x=>x.id),[3]); assert.equal(call({action:'unpaidDetail',billId:3}).data.bill.orderId,3);
  assert.deepEqual({...call({action:'aggregate',account:null}).data},{count:1,total:100});
  user=auth=2;
  assert.equal(call({action:'detail',paymentId:1}).ok,false); assert.equal(call({action:'unpaidDetail',billId:3}).data.bill.orderId,3);
  assert.deepEqual(call({action:'search',account:null}).data.map(x=>x.id),[2]);
  assert.deepEqual({...call({action:'aggregate',account:null}).data},{count:1,total:200});
  user=auth=3;
  const combinedDetail=call({action:'detail',paymentId:1}).data;
  assert.equal(combinedDetail.payment.originalAccount,'B'); assert.equal(combinedDetail.corrections[0].actorId,3); assert.equal(combinedDetail.corrections[0].occurredAt,40); assert.equal(combinedDetail.corrections[0].reason,'sample reason');
  assert.deepEqual({...call({action:'aggregate',account:null}).data},{count:2,total:300});
  assert.deepEqual(call({action:'search',account:null}).data.map(x=>x.id),[2,1]);
  assert.deepEqual(call({action:'unpaid'}).data.map(x=>x.id),[3]);
  assert.equal(call({action:'unpaidDetail',billId:3}).data.bill.orderId,3);
  assert.equal(call({action:'unpaidDetail',billId:1}).ok,false);
  auth=1; assert.equal(call({action:'unpaid'}).ok,false);
  auth=3; db.prepare("DELETE FROM user_permissions WHERE user_id=3").run();
  assert.equal(call({action:'unpaidDetail',billId:3}).ok,false);
});
