const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('../src/desktop/database');
const { registerBusinessDays } = require('../src/desktop/business-days');
const { createPf700PrinterControl } = require('../src/desktop/pf700-printer-control');
const { encodeRequest } = require('../src/desktop/pf700-frame');

const serial = 'SYNTHETIC01';
function reply(sequence, command, value) {
  const data = Buffer.from(value), status = Buffer.from('888080e1809a', 'hex');
  const body = Buffer.concat([Buffer.from([43 + data.length, sequence, command]), data, Buffer.from([4]), status, Buffer.from([5])]);
  const sum = body.reduce((a, b) => a + b, 0);
  return Buffer.concat([Buffer.from([1]), body, Buffer.from([12, 8, 4, 0].map(x => 48 + (sum >> x & 15))), Buffer.from([3])]);
}
test('cash movements send one exact frame each and write no Arra data', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); migrate(db);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES (1,'a',x'00',x'00'),(2,'b',x'00',x'00');
    INSERT INTO financial_scopes VALUES (1,'A'),(2,'B'); INSERT INTO user_permissions VALUES (1,'employees.view'),(2,'employees.view');`);
  let actor = 1, handler, balance = 0;
  const frames = [];
  const adapter = createPf700PrinterControl({expectedSerial:serial, openPipe:async () => ({
    exchange:async frame => {
      frames.push(Buffer.from(frame));
      if (frame[3] === 90) return reply(frame[2], 90, '1.00 231014 1230,ABCD,0011,1,' + serial);
      assert.equal(frame[3], 70);
      balance += Number(frame.subarray(4, -6).toString('ascii'));
      return reply(frame[2], 70, 'P,' + balance + ',0,0');
    }, close:async () => {}
  })});
  registerBusinessDays({handle:(_, fn) => handler = fn}, event => event.trusted, db,
    {currentUserId:() => actor, authenticatedUserId:() => actor}, undefined, null, adapter);
  const request = (direction, amount) => ({action:'accountAPrinterCashMovement', direction, amount});
  for (const req of [request('in','0'), request('out','0.00'), request('in','1.001'), request('in','1000000'),
    request('out','100000'), request('in','-1'), request('in','1e2'), request('other','1'), request('in',1),
    {...request('in','1'), command:70}]) {
    assert.equal((await handler({trusted:true}, req)).ok, false);
  }
  actor = 2; assert.equal((await handler({trusted:true}, request('in','2'))).ok, false);
  actor = 1; assert.equal((await handler({trusted:false}, request('in','2'))).ok, false);
  assert.deepEqual(frames, []);
  db.exec('PRAGMA query_only=ON');
  const changes = db.prepare('SELECT total_changes() AS n').get().n;
  assert.deepEqual(await handler({trusted:true}, request('in','2000')), {ok:true,outcome:'accepted'});
  assert.equal(balance, 2000);
  assert.deepEqual(await handler({trusted:true}, request('out','500')), {ok:true,outcome:'accepted'});
  assert.equal(balance, 1500);
  assert.deepEqual(frames.map(f => f[3]), [90,70,90,70]);
  for (const [index, payload] of [[1,'2000.00'],[3,'-500.00']]) {
    assert.deepEqual(frames[index], encodeRequest({sequence:frames[index][2],command:70,data:Buffer.from(payload)}));
  }
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changes);
  assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n, 0);
});

test('cash response distinguishes fulfilled, declined and unreadable replies', async () => {
  for (const [value, expected] of [
    ['P,2000.00,2000.00,0.00','accepted'], ['F,2000.00,0.00,0.00','declined'],
    ['F,2000.00,0.00','unknown'], ['P,2000.00,0.00','unknown'], ['P,2000.00,0.00,0.00,extra','unknown'],
    ['P,not-a-number,0,0','unknown'], ['', 'unknown']
  ]) {
    const commands = [];
    const adapter = createPf700PrinterControl({expectedSerial:serial, openPipe:async () => ({
      exchange:async frame => { commands.push(frame[3]); return frame[3] === 90
        ? reply(frame[2],90,'1.00 231014 1230,ABCD,0011,1,' + serial) : reply(frame[2],70,value); }, close:async () => {}
    })});
    assert.equal(await adapter.printCashMovement('1.00', () => true), expected, value);
    assert.deepEqual(commands, [90,70]);
  }
});

test('cash boundaries are formatted before the nine-byte limit and a lost reply is never retried', async t => {
  const { cashMovementPayload } = require('../src/desktop/pf700-cash-movement');
  assert.equal(cashMovementPayload('in','999999.99'), '999999.99');
  assert.equal(cashMovementPayload('out','99999.99'), '-99999.99');
  assert.equal(cashMovementPayload('out','100000.00'), null);
  assert.equal(cashMovementPayload('in','0001.2'), '1.20');
  let commands = [];
  const adapter = createPf700PrinterControl({expectedSerial:serial,openPipe:async () => ({
    exchange:async frame => { commands.push(frame[3]); if (frame[3] === 90) return reply(frame[2],90,'1.00 231014 1230,ABCD,0011,1,' + serial); throw Error('lost'); },
    close:async () => {}
  })});
  assert.equal(await adapter.printCashMovement('1.00', () => true), 'unknown');
  assert.deepEqual(commands, [90,70]);
  commands = [];
  assert.equal(await adapter.printCashMovement('1.00', () => false), 'not_sent');
  assert.deepEqual(commands, [90]);
});

test('cash outcomes cross the trusted handler without retrying a dispatched command', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); migrate(db);
  db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'00',x'00'); INSERT INTO financial_scopes VALUES(1,'A'); INSERT INTO user_permissions VALUES(1,'employees.view');");
  const req = {action:'accountAPrinterCashMovement',direction:'in',amount:'2000'};
  for (const scenario of ['declined','lost','unreadable','syncThrow','probeFailure','openFailure']) {
    let handler; const commands = [];
    const adapter = createPf700PrinterControl({expectedSerial:serial,openPipe:async () => {
      if (scenario === 'openFailure') throw Error('unavailable');
      return {exchange:frame => {
        commands.push(frame[3]);
        if (frame[3] === 90) {
          if (scenario === 'probeFailure') throw Error('probe failed');
          return reply(frame[2],90,'1.00 231014 1230,ABCD,0011,1,' + serial);
        }
        if (scenario === 'syncThrow') throw Error('write failed');
        if (scenario === 'lost') return Promise.reject(Error('lost reply'));
        if (scenario === 'unreadable') return Buffer.from('invalid');
        return reply(frame[2],70,'F,0,0,0');
      },close:async () => {}};
    }});
    registerBusinessDays({handle:(_,fn) => handler = fn}, () => true, db,
      {currentUserId:() => 1,authenticatedUserId:() => 1}, undefined, null, adapter);
    const outcome = scenario === 'declined' ? 'declined' : ['probeFailure','openFailure'].includes(scenario) ? 'not_sent' : 'unknown';
    assert.deepEqual(await handler({}, req), {ok:false,outcome}, scenario);
    assert.deepEqual(commands, scenario === 'openFailure' ? [] : scenario === 'probeFailure' ? [90] : [90,70], scenario);
  }
});
