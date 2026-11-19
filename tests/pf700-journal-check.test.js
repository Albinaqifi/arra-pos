const test = require('node:test');
const assert = require('node:assert/strict');
const { readJournal, MAX_LINES } = require('../scripts/pf700-journal-check/journal-check');
const serial = 'SYNTHETIC01', doc = '0000001';

function wrapped(seq, cmd, data, status = '888080e1809a') {
  const body = Buffer.concat([Buffer.from([43 + data.length, seq, cmd]), data,
    Buffer.from([4]), Buffer.from(status,'hex'), Buffer.from([5])]);
  const sum = body.reduce((a,b) => a+b,0);
  return Buffer.concat([Buffer.from([1]),body,Buffer.from([12,8,4,0].map(x=>48+(sum>>x&15))),Buffer.from([3])]);
}
function device(options = {}) {
  const calls = [];
  const lines = [...(options.lines || ['P,Coffee 70', 'P,Cash', '*,'])];
  return { calls, async exchange(frame) {
    const command = frame[3], payload = frame.subarray(4,-6).toString('ascii');
    calls.push([command,payload]);
    let result;
    if (command === 90) result = 'QA-700DEMOX,1.00MK 23OCT14 1230,BEEF,01001101,7,' + (options.serial || serial);
    else if (command === 76) result = options.state || '0,0001,+000007000,+000007000';
    else if (command === 113) result = options.document || doc;
    else if (command === 119) result = lines.shift() ?? 'P,more';
    else throw Error('Unexpected command');
    return wrapped(frame[2],command,Buffer.from(result,'latin1'),options.status);
  }};
}

test('only allowed read commands, bounded to a document, return redacted local comparisons', async () => {
  const d = device();
  const result = await readJournal(d.exchange,serial,doc,['coffee','cash','other'],0x7f);
  assert.deepEqual(result, {lines:2,end:'document separator',matches:[true,true,false]});
  assert.deepEqual(d.calls,[[90,'0'],[90,'0'],[76,'T'],[113,''],[119,'R,'+doc],[119,'N'],[119,'N']]);
  assert.doesNotMatch(JSON.stringify(result), /coffee|cash|0000001/i);
});

test('invalid input and identity, open receipt, mismatched document stop before reading trail', async () => {
  let d = device(); await assert.rejects(readJournal(d.exchange,serial,'oops')); assert.equal(d.calls.length,0);
  d = device({serial:'DIFFERENT01'}); await assert.rejects(readJournal(d.exchange,serial,doc)); assert.equal(d.calls.length,1);
  d = device({state:'1,0001,+000007000,+000000000'}); await assert.rejects(readJournal(d.exchange,serial,doc)); assert.deepEqual(d.calls.map(x=>x[0]),[90,90,76]);
  d = device({document:'0000002'}); await assert.rejects(readJournal(d.exchange,serial,doc)); assert.deepEqual(d.calls.map(x=>x[0]),[90,90,76,113]);
  d = device({status:'888088e1809a'}); await assert.rejects(readJournal(d.exchange,serial,doc)); assert.equal(d.calls.length,1);
});

test('end of data, malformed data and excessive lines never trigger writes or unbounded reads', async () => {
  let d = device({lines:['F']}); assert.equal((await readJournal(d.exchange,serial,doc)).end,'end-of-data');
  d = device({lines:['bad']}); await assert.rejects(readJournal(d.exchange,serial,doc)); assert.equal(d.calls.length,5);
  d = device(); d.exchange = async frame => { d.calls.push([frame[3]]); const c=frame[3]; const value=c===90?'QA-700DEMOX,1.00MK 23OCT14 1230,BEEF,01001101,7,'+serial:c===76?'0,0001,+000007000,+000007000':c===113?doc:'P,x'; return wrapped(frame[2],c,Buffer.from(value)); };
  await assert.rejects(readJournal(d.exchange,serial,doc),/line limit/);
  assert.equal(d.calls.length, 4+MAX_LINES+1);
  assert.ok(d.calls.every(([cmd])=>[90,76,113,119].includes(cmd)));
});

test('a stale first identity cannot establish the identity of a different printer', async () => {
  let count = 0;
  const d = device();
  const exchange = async frame => {
    if (frame[3] !== 90) throw Error('Query continued beyond identity');
    count++;
    const deviceSerial = count === 1 ? serial : 'DIFFERENT01';
    return wrapped(frame[2],90,Buffer.from('QA-700DEMOX,1.00MK 23OCT14 1230,BEEF,01001101,7,'+deviceSerial));
  };
  await assert.rejects(readJournal(exchange,serial,doc));
  assert.equal(count,2);
});

test('compares Windows-1251 text locally and rejects a bad checksum', async () => {
  const d = device({lines:['P,\xc2', '*,']});
  assert.deepEqual((await readJournal(d.exchange,serial,doc,['В'])).matches,[true]);
  const bad = device();
  await assert.rejects(readJournal(async frame => { const reply = await bad.exchange(frame); reply[reply.length-2] ^= 1; return reply; },serial,doc));
  assert.equal(bad.calls.length,1);
});
