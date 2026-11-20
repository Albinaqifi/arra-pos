const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('../src/desktop/database');
const { registerBusinessDays } = require('../src/desktop/business-days');
const { createPf700PrinterControl } = require('../src/desktop/pf700-printer-control');

const serial = 'SYNTHETIC01';
function reply(frame, value) {
  const data = Buffer.from(value);
  const body = Buffer.concat([Buffer.from([43 + data.length, frame[2], frame[3]]), data,
    Buffer.from([4]), Buffer.from('888080e1809a', 'hex'), Buffer.from([5])]);
  const sum = body.reduce((a, b) => a + b, 0);
  return Buffer.concat([Buffer.from([1]), body, Buffer.from([12, 8, 4, 0].map(x => 48 + (sum >> x & 15))), Buffer.from([3])]);
}

test('periodic printing rechecks sender, session and permission after the identity probe', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); migrate(db);
  db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'00',x'00'); INSERT INTO financial_scopes VALUES(1,'A'); INSERT INTO user_permissions VALUES(1,'employees.view');");
  let handler, actor = 1, generation = 0, trusted = true, release;
  const commands = [];
  const adapter = createPf700PrinterControl({expectedSerial:serial, openPipe:async () => ({
    exchange:frame => { commands.push(frame[3]); return new Promise(resolve => { release = () => resolve(reply(frame, '1.00 231014 1230,ABCD,0011,1,' + serial)); }); },
    close:async () => {}
  })});
  registerBusinessDays({handle:(_, fn) => handler = fn}, () => trusted, db,
    {currentUserId:() => actor, authenticatedUserId:() => actor, identityGeneration:() => generation}, undefined, null, adapter);
  for (const change of [() => { actor = null; }, () => { generation++; }, () => { trusted = false; },
    () => db.exec("DELETE FROM user_permissions WHERE user_id=1"), () => db.exec("UPDATE financial_scopes SET scope='B' WHERE user_id=1")]) {
    actor = 1; trusted = true; commands.length = 0;
    db.exec("UPDATE financial_scopes SET scope='A' WHERE user_id=1; INSERT OR IGNORE INTO user_permissions VALUES(1,'employees.view')");
    const pending = handler({}, {action:'accountAPrinterPeriodicReport', range:'record', format:'short', start:'1', end:'2'});
    await new Promise(setImmediate); change(); release();
    assert.deepEqual(await pending, {ok:false}); assert.deepEqual(commands, [90]);
  }
  commands.length = 0;
  assert.equal((await handler({}, {action:'accountAPrinterUnknown', range:'record', format:'short', start:'1', end:'2'})).ok, false);
  assert.deepEqual(commands, []);
});

test('periodic report leaves a populated B payment and open Arra day untouched', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); migrate(db);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'00',x'00');
    INSERT INTO financial_scopes VALUES(1,'combined'); INSERT INTO user_permissions VALUES(1,'business_days.close');
    INSERT INTO dining_tables(id,area) VALUES(1,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,30,'sample');
    INSERT INTO payments(id,bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,2,30,'cash','B');`);
  let handler; const frames = [];
  const adapter = createPf700PrinterControl({expectedSerial:serial, openPipe:async () => ({
    exchange:async frame => { frames.push(Buffer.from(frame)); return reply(frame, frame[3] === 90 ? '1.00 231014 1230,ABCD,0011,1,' + serial : ''); }, close:async () => {}
  })});
  registerBusinessDays({handle:(_, fn) => handler = fn}, () => true, db,
    {currentUserId:() => 1, authenticatedUserId:() => 1}, undefined, null, adapter);
  const before = ['payments', 'business_days', 'payment_business_days'].map(name => db.prepare(`SELECT * FROM ${name}`).all());
  const changes = db.prepare('SELECT total_changes() AS n').get().n;
  db.exec('PRAGMA query_only=ON');
  assert.deepEqual(await handler({}, {action:'accountAPrinterPeriodicReport',range:'record',format:'detailed',start:'1',end:'1095'}), {ok:true});
  assert.deepEqual(frames.map(frame => frame[3]), [90, 73]);
  assert.equal(frames[1].subarray(4,-6).toString('ascii'), '0001,1095');
  assert.deepEqual(['payments', 'business_days', 'payment_business_days'].map(name => db.prepare(`SELECT * FROM ${name}`).all()), before);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changes);
  assert.equal(db.prepare('SELECT closed_at FROM business_days').get().closed_at, null);
});
