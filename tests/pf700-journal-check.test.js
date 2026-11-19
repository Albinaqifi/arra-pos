const test = require('node:test');
const assert = require('node:assert/strict');
const { readJournal, MAX_LINES } = require('../scripts/pf700-journal-check/journal-check');
const serial = 'SYNTHETIC01', doc = '0000001';
const paper = { item: 'Sample drink', total: 'TOTAL 24,00', cash: 'ГОТОВО 24,00', amount: '24,00' };
const cashBytes = '\xc3\xce\xd2\xce\xc2\xce'; // Windows-1251 for the synthetic cash label above

function wrapped(seq, cmd, data, status = '888080e1809a') {
  const body = Buffer.concat([Buffer.from([43 + data.length, seq, cmd]), data,
    Buffer.from([4]), Buffer.from(status,'hex'), Buffer.from([5])]);
  const sum = body.reduce((a,b) => a+b,0);
  return Buffer.concat([Buffer.from([1]),body,Buffer.from([12,8,4,0].map(x=>48+(sum>>x&15))),Buffer.from([3])]);
}
function device(options = {}) {
  const calls = [];
  const lines = [...(options.lines || ['P,  Sample    drink', 'P,TOTAL    24,00 ', 'P,' + cashBytes + ' 24,00', 'P,Doc: ' + doc, '*,'])];
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
  const result = await readJournal(d.exchange,serial,doc,paper,0x7f);
  assert.deepEqual(result, {lines:4,end:'document separator',matches:{item:1,total:1,cash:1,documentNumber:1}});
  assert.deepEqual(d.calls,[[90,'0'],[90,'0'],[76,'T'],[113,''],[119,'R,'+doc],[119,'N'],[119,'N'],[119,'N'],[119,'N']]);
  assert.doesNotMatch(JSON.stringify(result), /sample|ГОТОВО|24,00|0000001|SYNTHETIC01/i);
});

test('invalid input and identity, open receipt, mismatched document stop before reading trail', async () => {
  let d = device(); await assert.rejects(readJournal(d.exchange,serial,'oops',paper)); assert.equal(d.calls.length,0);
  d = device({serial:'DIFFERENT01'}); await assert.rejects(readJournal(d.exchange,serial,doc,paper)); assert.equal(d.calls.length,1);
  d = device({state:'1,0001,+000007000,+000000000'}); await assert.rejects(readJournal(d.exchange,serial,doc,paper)); assert.deepEqual(d.calls.map(x=>x[0]),[90,90,76]);
  for (const document of ['0000002', '\xb0' + doc.slice(1)]) {
    d = device({document}); await assert.rejects(readJournal(d.exchange,serial,doc,paper)); assert.deepEqual(d.calls.map(x=>x[0]),[90,90,76,113]);
  }
  d = device({status:'888088e1809a'}); await assert.rejects(readJournal(d.exchange,serial,doc,paper)); assert.equal(d.calls.length,1);
});

test('end of data, malformed data and excessive lines never trigger writes or unbounded reads', async () => {
  let d = device({lines:['F']}); assert.equal((await readJournal(d.exchange,serial,doc,paper)).end,'end-of-data');
  d = device({lines:['bad']}); await assert.rejects(readJournal(d.exchange,serial,doc,paper)); assert.equal(d.calls.length,5);
  d = device(); d.exchange = async frame => { d.calls.push([frame[3]]); const c=frame[3]; const value=c===90?'QA-700DEMOX,1.00MK 23OCT14 1230,BEEF,01001101,7,'+serial:c===76?'0,0001,+000007000,+000007000':c===113?doc:'P,x'; return wrapped(frame[2],c,Buffer.from(value)); };
  await assert.rejects(readJournal(d.exchange,serial,doc,paper),/line limit/);
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
  await assert.rejects(readJournal(exchange,serial,doc,paper));
  assert.equal(count,2);
});

test('a matching case serial with a legacy identity layout cannot establish the installed firmware', async () => {
  const legacy = '1.00MK 231014 1230,BEEF,0101,7,' + serial;
  const onsite = 'QA-700DEMOX,1.00MK 23OCT14 1230,BEEF,01001101,7,' + serial;
  for (const replies of [[legacy], [onsite, legacy]]) {
    let count = 0;
    const exchange = async frame => {
      assert.equal(frame[3], 90);
      return wrapped(frame[2], 90, Buffer.from(replies[count++]));
    };
    await assert.rejects(readJournal(exchange, serial, doc, paper), /installed firmware/);
    assert.equal(count, replies.length);
  }
});

test('compares Windows-1251 text locally and rejects a bad checksum', async () => {
  const d = device({lines:['P,\xc2', '*,']});
  assert.equal((await readJournal(d.exchange,serial,doc,{...paper, item:'В'})).matches.item,1);
  const bad = device();
  await assert.rejects(readJournal(async frame => { const reply = await bad.exchange(frame); reply[reply.length-2] ^= 1; return reply; },serial,doc,paper));
  assert.equal(bad.calls.length,1);
});

test('a complete item line distinguishes Latin B from a Windows-1251 Cyrillic В', async () => {
  const itemPrefix = 'Sample drink 2 x 12,00 24,00 ';
  const lines = ['P,' + itemPrefix + '\xc2', 'P,TOTAL 24,00', 'P,' + cashBytes + ' 24,00',
    'P,Doc: ' + doc, '*,'];
  for (const [mark, itemMatches] of [['\u0042', 0], ['\u0412', 1]]) {
    const result = await readJournal(device({ lines }).exchange, serial, doc, { ...paper, item: itemPrefix + mark });
    assert.deepEqual(result, { lines: 4, end: 'document separator',
      matches: { item: itemMatches, total: 1, cash: 1, documentNumber: 1 } });
  }
});

test('partial amounts, mixed fields and unsupported paper layouts stop before connecting', async () => {
  const d = device();
  for (const patch of [
    {amount:'2'}, {amount:'24'}, {total:'TOTAL 124,00'}, {total:'VAT 2 TOTAL 24,00'},
    {cash:'ГОТОВО -24,00'}, {cash:'Cash 24,00'}, {cash:'ГОТОВО'}, {total:'24,00'},
    {item:paper.total}, {total:paper.cash}, {item:'Sample\nline'}
  ]) {
    await assert.rejects(readJournal(d.exchange,serial,doc,{...paper,...patch}));
  }
  assert.deepEqual(d.calls,[]);
});

test('matching preserves full lines, case, amount punctuation and duplicates within the selected document', async () => {
  const d = device({lines:[
    'P,Sample drinks', 'P,sample drink', 'P,VAT TOTAL 24,00', 'P,TOTAL 124,00',
    'P,TOTAL 24.00', 'P,' + cashBytes, 'P,24,00', 'P,' + cashBytes + ' 24,00',
    'P,' + cashBytes + '    24,00', 'P,X' + doc, 'P,' + doc + '2', 'P,1' + doc,
    '*,', 'P,Sample drink', 'P,TOTAL 24,00', 'P,Document #' + doc
  ]});
  const result = await readJournal(d.exchange,serial,doc,paper);
  assert.deepEqual(result, {lines:12,end:'document separator',matches:{item:0,total:0,cash:2,documentNumber:0}});
});
