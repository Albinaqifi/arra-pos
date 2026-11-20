const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('../src/desktop/database');
const { registerBusinessDays } = require('../src/desktop/business-days');
const { createPf700PrinterControl } = require('../src/desktop/pf700-printer-control');

const serial = 'SYNTHETIC01';
function reply(frame, text) {
  const data = Buffer.from(text), status = Buffer.from('888080e1809a', 'hex');
  const body = Buffer.concat([Buffer.from([43 + data.length, frame[2], frame[3]]), data, Buffer.from([4]), status, Buffer.from([5])]);
  const sum = body.reduce((a, b) => a + b, 0);
  return Buffer.concat([Buffer.from([1]), body, Buffer.from([12, 8, 4, 0].map(x => 48 + (sum >> x & 15))), Buffer.from([3])]);
}

test('cash movement rechecks authorization after the device identity probe', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); migrate(db);
  db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'00',x'00'); INSERT INTO financial_scopes VALUES(1,'A'); INSERT INTO user_permissions VALUES(1,'employees.view');");
  let handler, generation = 0, trusted = true, release;
  const commands = [];
  const adapter = createPf700PrinterControl({expectedSerial:serial, openPipe:async () => ({
    exchange:frame => { commands.push(frame[3]); return new Promise(resolve => { release = () => resolve(reply(frame, '1.00 231014 1230,ABCD,0011,1,' + serial)); }); },
    close:async () => {}
  })});
  registerBusinessDays({handle:(_, fn) => handler = fn}, () => trusted, db,
    {currentUserId:() => 1, authenticatedUserId:() => 1, identityGeneration:() => generation}, undefined, null, adapter);
  for (const change of [() => generation++, () => {trusted = false;}, () => db.exec("DELETE FROM user_permissions WHERE user_id=1")]) {
    trusted = true; db.exec("INSERT OR IGNORE INTO user_permissions VALUES(1,'employees.view')"); commands.length = 0;
    const pending = handler({}, {action:'accountAPrinterCashMovement', direction:'out', amount:'500'});
    await new Promise(setImmediate); change(); release();
    assert.deepEqual(await pending, {ok:false}); assert.deepEqual(commands, [90]);
  }
});

test('cash and daily control cannot overlap on the shared printer adapter', async () => {
  const commands = []; let release, started;
  const sending = new Promise(resolve => { started = resolve; });
  const adapter = createPf700PrinterControl({expectedSerial:serial, openPipe:async () => ({
    exchange:async frame => {
      commands.push(frame[3]);
      if (frame[3] === 90) return reply(frame, '1.00 231014 1230,ABCD,0011,1,' + serial);
      started(); await new Promise(resolve => { release = resolve; });
      return reply(frame, 'P,2000.00,2000.00,0.00');
    }, close:async () => {}
  })});
  const pending = adapter.printCashMovement('2000.00', () => true);
  await sending;
  assert.equal(await adapter.printDailyControl(() => true), 'failed');
  release(); assert.equal(await pending, 'accepted');
  assert.deepEqual(commands, [90, 70]);
});
