const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { collectOnce, markerPath } = require('../scripts/pf700-close-evidence/collect');
const { savedCapture, collectJournal, resultPath } = require('../scripts/pf700-close-evidence/read-journal');

const candidate = {billId:2,attemptId:3,sequence:43,serial:'SYNTHETIC01',expectedDocument:'0000030',
  total:150,openingFiscalReceiptCount:12,openingReversalCount:0,binding:'b'.repeat(64)};

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'arra-journal-gate-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  // Stored 74/X response: both data and status carry the observed six flags.
  const body = Buffer.from('312b4a888082e1809a04888082e1809a05','hex');
  const sum = body.reduce((a,b) => a + b,0);
  const checksum = Buffer.from([12,8,4,0].map(shift => 48 + ((sum >> shift) & 15)));
  const frame = Buffer.concat([Buffer.from([1]),body,checksum,Buffer.from([3])]);
  collectOnce(candidate,dir,() => ({source:'PROBE',frame}));
  const file = markerPath(dir,candidate.serial);
  const original = fs.readFileSync(file,'utf8');
  return {dir,file,original};
}

test('a different, unbound, incomplete or stale prior capture cannot start a journal read', async t => {
  const {dir,file,original} = fixture(t);
  const hash = savedCapture(dir,candidate);
  assert.match(hash,/^[a-f0-9]{64}$/);
  for (const [from,to] of [['"PROBE"','"PENDING"'], ['"open":false','"open":true'],
    ['"ready":true','"ready":false'], ['"source":"PROBE"','"source":"UNKNOWN"'],
    ['"sequence":43','"sequence":44'], [candidate.binding,'a'.repeat(64)],
    ['"responseHash":"','"responseHash":"0'], ['888082e1809a','888080e1809a']]) {
    const modified = original.replace(from,to);
    assert.notEqual(modified,original);
    fs.writeFileSync(file, modified);
    let connected = false;
    await assert.rejects(collectJournal(candidate,dir,hash,() => { connected = true; }));
    assert.equal(connected,false);
    assert.equal(fs.existsSync(resultPath(dir,candidate)),false);
  }
});

test('one journal request holds a durable reservation, preserves capture, and can report an inconclusive read', async t => {
  const {dir,file,original} = fixture(t);
  const hash = savedCapture(dir,candidate);
  let connections = 0, closed = 0;
  const connect = () => {
    connections++;
    assert.equal(JSON.parse(fs.readFileSync(resultPath(dir,candidate),'utf8')).priorCaptureHash,hash);
    return {exchange() { throw Error('Synthetic first inquiry failed'); },close() { closed++; }};
  };
  const result = await collectJournal(candidate,dir,hash,connect);
  assert.equal(result.outcome,'inconclusive');
  assert.equal(result.reason,'identity');
  await assert.rejects(collectJournal(candidate,dir,hash,connect), {code:'EEXIST'});
  assert.equal(connections,1); assert.equal(closed,1);
  assert.equal(fs.readFileSync(file,'utf8'),original);
  const observations = fs.readFileSync(resultPath(dir,candidate),'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(observations.map(entry => entry.type),['journal-reserved','journal-observation']);
});
