const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { registerFinancialVisibility } = require('../src/desktop/financial-visibility');

test('unpaid bills become scoped immediately on payment and correction', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-unpaid-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  for (const [id, scope] of [[1, 'A'], [2, 'B'], [3, 'combined'], [4, 'waiter']]) {
    db.prepare('INSERT INTO local_users(id,username,salt,password_hash) VALUES(?,?,?,?)').run(id, `sample-${id}`, Buffer.from([1]), Buffer.from([1]));
    db.prepare('INSERT INTO financial_scopes VALUES(?,?)').run(id, scope);
    db.prepare("INSERT INTO user_permissions VALUES(?,'employees.view')").run(id);
  }
  db.exec(`INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample'),(3,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'),(3,3,1,'open');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,2,100,'a'),(2,2,1,2,200,'b'),(3,3,1,2,300,'c');`);
  let user = 1, auth = 1, handler;
  registerFinancialVisibility({ handle: (_, fn) => { handler = fn; } }, e => e.allowed, db, { currentUserId: () => user, authenticatedUserId: () => auth });
  const call = req => handler({ allowed: true }, req);
  for (const id of [1, 2, 3]) {
    user = auth = id;
    assert.deepEqual(call({ action: 'unpaid' }).data.map(b => b.id), [3, 2, 1]);
    assert.equal(call({ action: 'unpaidDetail', billId: 1 }).data.bill.total, 100);
  }
  user = auth = 1;
  for (const request of [{ action: 'unpaid', account: 'B' }, { action: 'unpaidDetail', billId: 0 }, { action: 'unpaidDetail', billId: 1.5 }, { action: 'unpaidDetail', billId: 999 }, { action: 'unpaidDetail', billId: 1, extra: true }]) assert.equal(call(request).ok, false);
  assert.equal(handler({ allowed: false }, { action: 'unpaid' }).ok, false);
  db.prepare("DELETE FROM user_permissions WHERE user_id=1 AND permission='employees.view'").run();
  assert.equal(call({ action: 'unpaid' }).ok, false);
  db.prepare("INSERT INTO user_permissions VALUES(1,'employees.view')").run();
  user = auth = 4; assert.equal(call({ action: 'unpaid' }).ok, false);
  user = 1; auth = 2; assert.equal(call({ action: 'unpaidDetail', billId: 1 }).ok, false);
  db.exec("INSERT INTO payments(id,bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,3,100,'card','A'),(2,2,1,3,200,'cash','B')");
  for (const id of [1, 2, 3]) {
    user = auth = id;
    assert.deepEqual(call({ action: 'unpaid' }).data.map(b => b.id), [3]);
    assert.equal(call({ action: 'unpaidDetail', billId: 1 }).ok, false);
    assert.equal(call({ action: 'unpaidDetail', billId: 2 }).ok, false);
    assert.equal(call({ action: 'detail', paymentId: 1 }).ok, id !== 2);
    assert.equal(call({ action: 'detail', paymentId: 2 }).ok, id !== 1);
  }
  db.exec("INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(2,3,4,'sample')");
  user = auth = 1;
  const a = call({ action: 'detail', paymentId: 2 }).data;
  assert.equal(a.payment.account, 'A'); assert.equal(Object.hasOwn(a.payment, 'originalAccount'), false); assert.equal(a.corrections, null);
  assert.deepEqual({ ...call({ action: 'aggregate', account: null }).data }, { count: 2, total: 300 });
  user = auth = 2; assert.equal(call({ action: 'detail', paymentId: 2 }).ok, false);
  assert.deepEqual({ ...call({ action: 'aggregate', account: null }).data }, { count: 0, total: 0 });
  user = auth = 3;
  const combined = call({ action: 'detail', paymentId: 2 }).data;
  assert.equal(combined.payment.originalAccount, 'B'); assert.equal(combined.corrections[0].fromAccount, 'B');
  assert.equal(db.prepare('SELECT account FROM payments WHERE id=2').get().account, 'B');
});
