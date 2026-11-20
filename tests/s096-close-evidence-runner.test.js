const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectOnce, markerPath } = require('../scripts/pf700-close-evidence/collect');

const candidate = { serial:'SYNTHETIC01', billId:2, attemptId:3, total:150, expectedDocument:'0000030',
  binding:'a'.repeat(64), sequence:60, openingFiscalReceiptCount:4, openingReversalCount:0 };

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-close-reader-'));
  t.after(() => fs.rmSync(dir, {force:true, recursive:true}));
  return dir;
}

function reply(command, data, flags = '888080e1809a') {
  const status = Buffer.from(flags, 'hex');
  const payload = command === 74 ? status : Buffer.from(data, 'ascii');
  const body = Buffer.concat([Buffer.from([43 + payload.length, candidate.sequence, command]), payload,
    Buffer.from([4]), status, Buffer.from([5])]);
  const sum = body.reduce((a,b) => a + b, 0);
  return {source:'PROBE', frame:Buffer.concat([Buffer.from([1]),body,
    Buffer.from([12,8,4,0].map(shift => 48 + ((sum >> shift) & 15))),Buffer.from([3])])};
}

test('a durable reservation precedes the capture and prevents a concurrent or later second send', t => {
  const dir = scratch(t);
  const file = markerPath(dir, candidate.serial);
  const forbidden = () => assert.fail('second probe');
  const message = collectOnce(candidate, dir, sequence => {
    assert.equal(sequence, candidate.sequence);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).binding, candidate.binding);
    assert.match(collectOnce(candidate, dir, forbidden), /already reserved/);
    return reply(56, '0005,0000');
  });
  assert.match(message, /^CLOSE REPLY SAVED\..*Fiscal count 4 to 5.*Closed and ready: yes/);
  assert.match(collectOnce(candidate, dir, forbidden), /already reserved/);
  const [first,second] = fs.readFileSync(file,'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(first.billId,2);
  assert.equal(second.observation.countersMatch,true);
  assert.match(second.observation.responseHash,/^[a-f0-9]{64}$/);
});

test('an interrupted capture cannot acquire a second reservation', t => {
  const dir = scratch(t);
  assert.throws(() => collectOnce(candidate, dir, () => { throw Error('Interrupted'); }));
  assert.match(collectOnce(candidate, dir, () => assert.fail('second probe')), /already reserved/);
});

test('display distinguishes an open or faulty close, unexpected counters, and status-only capture', t => {
  for (const [input, expected] of [
    [reply(56,'0005,0000','888088e1809a'), /^INCONCLUSIVE CLOSE REPLY/],
    [reply(56,'0005,0000','898080e1809a'), /^INCONCLUSIVE CLOSE REPLY/],
    [reply(56,'0004,0000'), /^INCONCLUSIVE CLOSE REPLY/],
    [reply(74,null,'898080e1809a'), /^INCONCLUSIVE STATUS REPLY/],
    [reply(74,null,'888088e1809a'), /^STATUS REPLY SAVED.*open/],
    [{...reply(74), source:'PENDING'}, /^INCONCLUSIVE.*already queued/],
    [{...reply(56,'0005,0000'), source:'PENDING'}, /^CLOSE REPLY SAVED.*Already in the receive queue/],
    [null, /^INCONCLUSIVE\./]
  ]) {
    assert.match(collectOnce(candidate, scratch(t), () => input), expected);
  }
});
