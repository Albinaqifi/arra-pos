const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { registerBillHistory } = require('../src/desktop/bill-history');

test('direct scoped print and export keep midnight payments in their recorded business day', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-history-independent-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  for (const [id, scope] of [[1, 'A'], [2, 'B'], [3, 'combined'], [4, 'waiter']]) {
    db.prepare('INSERT INTO local_users(id,username,salt,password_hash) VALUES(?,?,?,?)').run(id, `sample-${id}`, Buffer.from([1]), Buffer.from([1]));
    db.prepare('INSERT INTO financial_scopes VALUES (?,?)').run(id, scope);
    db.prepare("INSERT INTO user_permissions VALUES (?, 'employees.view')").run(id);
  }
  db.exec("INSERT INTO dining_tables(id,area) VALUES(1,'sample')");
  const midnight = new Date(2025, 0, 2).getTime();
  const order = db.prepare("INSERT INTO orders(id,table_id,opened_at,status) VALUES(?,1,1,'open')");
  const bill = db.prepare("INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(?,?,1,1,100,'sample')");
  const payment = db.prepare("INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(?,1,?,100,'cash',?)");
  for (const [id, at, account] of [[1, midnight - 1, 'A'], [2, midnight, 'B'], [3, midnight + 1, 'B']]) {
    order.run(id); bill.run(id, id); payment.run(id, at, account);
    db.prepare("UPDATE orders SET status='completed' WHERE id=?").run(id);
  }
  order.run(4); bill.run(4, 4);
  db.prepare("INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(2,1,?,'sample')").run(midnight + 2);
  let actor = 3, handler, jobs = [], target = path.join(dir, 'out.xml');
  registerBillHistory({handle: (_, fn) => { handler = fn; }}, e => e.allowed, db,
    {currentUserId: () => actor, authenticatedUserId: () => actor, identityGeneration: () => 1},
    { print: async job => { jobs.push(job); return 'accepted'; }, saveDialog: async () => ({canceled: false, filePath: target}) });
  const call = (action, extra = {}) => handler({allowed: true}, {action, from: midnight - 1, to: midnight + 2, ...(action === 'page' ? {page: 0, token: null} : {}), ...(['print', 'export'].includes(action) ? {language: 'en'} : {}), ...extra});
  const all = (await call('page')).data.records;
  assert.deepEqual(all.map(r => r.billId), [3, 2, 1]);
  assert.equal(new Set(all.map(r => r.dayId)).size, 1);
  assert.deepEqual((await call('page', {from: midnight, to: midnight + 1})).data.records.map(r => r.billId), [2]);
  for (const [id, expected] of [[1, [2, 1]], [2, [3]], [3, [3, 2, 1]]]) {
    actor = id; jobs = [];
    assert.equal((await call('print')).ok, true);
    assert.deepEqual(jobs.flatMap(j => j.snapshot.rows.map(r => r.billId)), expected);
    assert.equal(jobs.at(-1).snapshot.total, String(expected.length * 100));
    target = path.join(dir, `${id}.xml`);
    assert.equal((await call('export')).ok, true);
    const xml = fs.readFileSync(target, 'utf8');
    assert.equal((xml.match(/<Row>/g) || []).length, expected.length + 2);
  }
  actor = 4; jobs = [];
  assert.equal((await call('page')).ok, false);
  assert.equal((await call('print')).ok, false);
  assert.equal((await call('export')).ok, false);
  assert.equal(jobs.length, 0);
  actor = 3; jobs = [];
  assert.equal((await call('print', {from: midnight + 10, to: midnight + 11})).ok, true);
  assert.deepEqual(jobs[0].snapshot.rows, []);
  assert.equal(jobs[0].snapshot.total, '0');
  actor = 3; target = path.join(dir, 'missing', 'out.xml');
  assert.equal((await call('export')).ok, false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n, 3);
  assert.equal(db.prepare('SELECT count(*) AS n FROM payment_account_corrections').get().n, 1);
});

test('page token preserves membership after day close and fails closed after correction', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-history-pages-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample-b',x'01',x'01'),(2,'sample-a',x'01',x'01'); INSERT INTO financial_scopes VALUES(1,'B'),(2,'A'); INSERT INTO user_permissions VALUES(1,'employees.view'),(2,'employees.view'); INSERT INTO dining_tables(id,area) VALUES(1,'sample')");
  const order = db.prepare("INSERT INTO orders(id,table_id,opened_at,status) VALUES(?,1,1,'open')");
  const bill = db.prepare("INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(?,?,1,1,100,'sample')");
  const payment = db.prepare("INSERT INTO payments(id,bill_id,actor_id,paid_at,amount,method,account) VALUES(?,?,1,?,100,'cash','B')");
  for (let id = 1; id <= 102; id++) {
    order.run(id); bill.run(id, id); payment.run(id, id, 1000 + id);
    db.prepare("UPDATE orders SET status='completed' WHERE id=?").run(id);
  }
  let actor = 1, handler;
  registerBillHistory({handle: (_, fn) => { handler = fn; }}, () => true, db,
    {currentUserId: () => actor, authenticatedUserId: () => actor, identityGeneration: () => 1});
  const page = (number, token) => handler({}, {action: 'page', from: 0, to: 2000, page: number, token});
  const first = await page(0, null);
  assert.equal(first.data.count, 102);
  db.exec("UPDATE business_days SET closed_at=1300,closed_by=1,issues='{}' WHERE closed_at IS NULL; INSERT INTO business_days(opened_at) VALUES(1300)");
  order.run(103); bill.run(103, 103); payment.run(103, 103, 1103);
  const second = await page(1, first.data.token);
  assert.equal(second.ok, true);
  assert.equal(second.data.count, 102);
  assert.equal(second.data.records.find(row => row.id === 50).account, 'B');
  assert.ok(second.data.records.every(row => row.closedAt === null));
  const third = await page(2, first.data.token);
  assert.deepEqual([...first.data.records, ...second.data.records, ...third.data.records].map(row => row.id), Array.from({length: 102}, (_, i) => 102 - i));
  // Payment 50 belongs to the closed day; corrections are only valid on an open day.
  // Start a fresh view of the new day and correct its B payment.
  const beforeCorrection = await page(0, null);
  db.prepare("INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(103,1,1400,'sample')").run();
  assert.equal((await page(1, beforeCorrection.data.token)).ok, false);
  const refreshed = await page(0, null);
  assert.equal(refreshed.data.count, 102);
  assert.equal(refreshed.data.records[0].id, 102);
  actor = 2;
  assert.equal((await page(1, first.data.token)).ok, false);
  const a = await page(0, null);
  assert.deepEqual(a.data.records.map(row => row.id), [103]);
});

test('multipart printed total covers exactly the scoped corrected payments', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-history-total-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample-a',x'01',x'01'),(2,'sample-b',x'01',x'01'),(3,'sample-combined',x'01',x'01'); INSERT INTO financial_scopes VALUES(1,'A'),(2,'B'),(3,'combined'); INSERT INTO user_permissions VALUES(1,'employees.view'),(2,'employees.view'),(3,'employees.view'); INSERT INTO dining_tables(id,area) VALUES(1,'sample')");
  const order = db.prepare("INSERT INTO orders(id,table_id,opened_at,status) VALUES(?,1,1,'open')");
  const bill = db.prepare("INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(?,?,1,1,220,'sample')");
  const payment = db.prepare("INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(?,1,1000,220,'cash','B')");
  const done = db.prepare("UPDATE orders SET status='completed' WHERE id=?");
  db.exec('BEGIN');
  for (let id = 1; id <= 201; id++) { order.run(id); bill.run(id,id); payment.run(id); done.run(id); }
  db.exec("INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(1,1,1100,'sample'); COMMIT");
  let actor = 1, handler, jobs = [];
  registerBillHistory({handle: (_, fn) => { handler = fn; }}, () => true, db,
    {currentUserId: () => actor, authenticatedUserId: () => actor, identityGeneration: () => 1},
    {print: async job => { jobs.push(job); return 'accepted'; }});
  for (const [id, count, total, parts] of [[1, 1, '220', 1], [2, 200, '44000', 1], [3, 201, '44220', 2]]) {
    actor = id; jobs = [];
    assert.equal((await handler({}, {action:'print', from:0, to:2000, language:'en'})).ok, true);
    assert.equal(jobs.length, parts);
    assert.equal(jobs.flatMap(job => job.snapshot.rows).length, count);
    assert.ok(jobs.every(job => job.snapshot.total === total));
    assert.equal(new Set(jobs.flatMap(job => job.snapshot.rows.map(row => row.id))).size, count);
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n, 201);
});
