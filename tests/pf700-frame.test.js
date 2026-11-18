const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeRequest, decodeResponse } = require('../src/desktop/pf700-frame');

test('encodes documented frame structure and checksum without accessing a device', () => {
  assert.deepEqual(encodeRequest({ sequence: 0x20, command: 0x4a }), Buffer.from([0x01,0x24,0x20,0x4a,0x05,0x30,0x30,0x39,0x33,0x03]));
  assert.deepEqual(encodeRequest({ sequence: 0x20, command: 0x4a, data: Buffer.from('X') }), Buffer.from([0x01,0x25,0x20,0x4a,0x58,0x05,0x30,0x30,0x3e,0x3c,0x03]));
  const largest = encodeRequest({ sequence: 0xff, command: 0x7f, data: Buffer.alloc(91, 0x20) });
  assert.equal(largest[1], 0x7f);
  assert.equal(largest.length, 101);
  for (const input of [{sequence:0x1f,command:0x4a},{sequence:0x100,command:0x4a},{sequence:0x20,command:0x80},{sequence:0x20,command:0x4a,data:Buffer.alloc(92)},{sequence:0x20,command:0x4a,data:'x'}]) assert.throws(() => encodeRequest(input));
});

test('validates a response and returns independent data and all six status bytes', () => {
  const frame = Buffer.from([0x01,0x2b,0x20,0x4a,0x04,0x80,0x80,0x80,0x80,0x80,0x80,0x05,0x30,0x33,0x39,0x3e,0x03]);
  const result = decodeResponse(frame, { sequence:0x20, command:0x4a });
  assert.deepEqual(result.data, Buffer.alloc(0));
  assert.deepEqual(result.status, Buffer.alloc(6,0x80));
  frame[5] = 0xff;
  assert.equal(result.status[0],0x80);
  const withData = Buffer.from([0x01,0x2d,0x20,0x4a,0x41,0x42,0x04,0x80,0x80,0x80,0x80,0x80,0x80,0x05,0x30,0x34,0x32,0x33,0x03]);
  assert.deepEqual(decodeResponse(withData,{sequence:0x20,command:0x4a}).data,Buffer.from('AB'));
});

test('rejects malformed, truncated and mismatched responses', () => {
  const valid = Buffer.from([0x01,0x2b,0x20,0x4a,0x04,0x80,0x80,0x80,0x80,0x80,0x80,0x05,0x30,0x33,0x39,0x3e,0x03]);
  const expected = { sequence:0x20, command:0x4a };
  for (const [index,value] of [[0,2],[1,0x2c],[2,0x21],[3,0x4b],[4,5],[5,0x7f],[11,4],[12,0x31],[16,0]]) {
    const changed=Buffer.from(valid); changed[index]=value;
    assert.throws(() => decodeResponse(changed,expected));
  }
  assert.throws(() => decodeResponse(valid.subarray(0,-1),expected));
  assert.throws(() => decodeResponse(Buffer.concat([valid,Buffer.from([0])]),expected));
  assert.throws(() => decodeResponse(Buffer.from([0x15]),expected));
  assert.throws(() => decodeResponse(valid,{sequence:0x1f,command:0x4a}));
});

test('validates encoded data without rewriting command-specific controls', () => {
  const expected = {sequence:0x20,command:0x4a};
  const escaped=encodeRequest({...expected,data:Buffer.from([0x10,0x44])});
  assert.deepEqual(escaped,Buffer.from([0x01,0x26,0x20,0x4a,0x10,0x44,0x05,0x30,0x30,0x3e,0x39,0x03]));
  for(const data of [Buffer.from([0x01]),Buffer.from([0x04]),Buffer.from([0x05]),Buffer.from([0x09]),Buffer.from([0x10]),Buffer.from([0x10,0x20]),Buffer.from([0x10,0x60])]) assert.throws(()=>encodeRequest({...expected,data}));
  const tab=encodeRequest({...expected,data:Buffer.from([0x09]),allowedControls:[0x09]});
  assert.equal(tab[4],0x09);
  assert.throws(()=>encodeRequest({...expected,data:Buffer.alloc(0),allowedControls:[0x04]}));
  const response=Buffer.from([0x01,0x2d,0x20,0x4a,0x10,0x44,0x04,0x80,0x80,0x80,0x80,0x80,0x80,0x05,0x30,0x33,0x3f,0x34,0x03]);
  assert.deepEqual(decodeResponse(response,expected).data,Buffer.from([0x10,0x44]));
  const unsafe=Buffer.from([0x01,0x2c,0x20,0x4a,0x04,0x04,0x80,0x80,0x80,0x80,0x80,0x80,0x05,0x30,0x33,0x3a,0x33,0x03]);
  assert.throws(()=>decodeResponse(unsafe,expected),/control/);
});
