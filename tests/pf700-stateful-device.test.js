const test = require('node:test');
const assert = require('node:assert/strict');
const { randomInt } = require('node:crypto');
const { createWindowsPf700Checkout } = require('../src/desktop/pf700-windows-checkout');
const { encodeRequest, decodeResponse } = require('../src/desktop/pf700-frame');
const { createStatefulPf700 } = require('./support/pf700-stateful-device');

const windows = { skip: process.platform !== 'win32' };
const receipt = { billId: 1, account: 'A', method: 'cash', currency: 'MKD', total: 75,
  domesticProduct: false, lines: [
    { name: 'Sample tea', quantity: 2, unitPrice: 20, taxGroup: 'В', taxRate: 10, domesticProduct: false },
    { name: 'Sample item', quantity: 1, unitPrice: 35, taxGroup: 'А', taxRate: 18, domesticProduct: true }
  ] };
function profile(device) {
  return { expectedSerial: device.serial, operatorNumber: 2, tillNumber: 1,
    operatorPassword: String(randomInt(100000, 1000000)), domesticProduct: false };
}
const scenarios = [
  { command: 48, mode: 'before', expected: [false,0,0,0] },
  { command: 48, mode: 'after', expected: [true,0,0,0] },
  { command: 49, mode: 'before', expected: [true,0,0,0] },
  { command: 49, mode: 'after', expected: [true,1,0,0] },
  { command: 49, mode: 'before', occurrence: 2, expected: [true,1,0,0] },
  { command: 49, mode: 'after', occurrence: 2, expected: [true,2,0,0] },
  { command: 53, mode: 'before', expected: [true,2,0,0] },
  { command: 53, mode: 'after', expected: [true,2,1,0] },
  { command: 56, mode: 'before', expected: [true,2,1,0] },
  { command: 56, mode: 'after', expected: [false,2,1,1] }
];

for (const scenario of scenarios) test(`physical adapter: command ${scenario.command} ${scenario.mode} execution, item ${scenario.occurrence || 1}`, windows, async () => {
  const device = createStatefulPf700(), config = profile(device);
  device.fault(scenario.command, scenario.mode, scenario.occurrence);
  let baseline = null;
  const intents = [], acks = [];
  const adapter = createWindowsPf700Checkout(config, device.start);
  const result = await adapter.registerSale(receipt, {
    beforeOpen(value) { baseline = value; },
    beforeCommand(value) { intents.push(value); return intents.length; },
    afterCommand(value) { acks.push(value); }
  });
  assert.equal(result.status, 'uncertain');
  assert.deepEqual(baseline, {previousDocumentNumber:'0000001'});
  const s = device.state;
  assert.deepEqual([s.open,s.items,s.tenders,s.closes],scenario.expected);
  assert.equal(s.document, 1 + s.closes);
  assert.equal(device.transcript.at(-1).effect, scenario.mode === 'before' ? 'dropped-before' : 'executed-reply-lost');
  assert.deepEqual(intents.map(({command,sequence}) => ({command,sequence})),
    device.transcript.map(({command,sequence}) => ({command,sequence})));
  assert.equal(acks.length, intents.length - 1, 'the lost reply must remain unacknowledged');
  assert.deepEqual(acks.map(({id}) => id), Array.from({length:acks.length}, (_, i) => i + 1));
  assert.ok(acks.every(({responseHash}) => /^[a-f0-9]{64}$/.test(responseHash)));
  assert.ok(intents.every(({command,requestHash}) => command === 48 ? requestHash === null : /^[a-f0-9]{64}$/.test(requestHash)));
  assert.ok(intents.every(entry => Object.keys(entry).sort().join(',') === 'command,requestHash,sequence'));
  assert.ok(device.transcript.every(event => Object.keys(event).sort().join(',') === 'command,effect,sequence'));
});

test('same sequence replays only the most recent response; an intervening inquiry loses that protection', () => {
  const device = createStatefulPf700();
  const credential = String(randomInt(100000, 1000000));
  const request = (seq, cmd, text = '', controls = []) => encodeRequest({sequence:seq,command:cmd,data:Buffer.from(text,'latin1'),allowedControls:controls});
  device.exchange(request(0x21,48,`2,${credential},1`));
  device.exchange(request(0x22,49,'Sample\t\xc2' + '75*1',[9]));
  device.fault(53,'after');
  assert.throws(() => device.exchange(request(0x23,53,'\t',[9])));
  assert.equal(device.state.tenders, 1);
  const replay = device.exchange(request(0x23,53,'\t',[9]));
  assert.equal(decodeResponse(replay,{sequence:0x23,command:53}).data.toString('latin1'),'R+000000000');
  assert.equal(device.state.tenders,1);
  device.exchange(request(0x24,76,'T'));
  device.exchange(request(0x23,53,'\t',[9]));
  assert.equal(device.state.tenders,2, 'an intervening request makes the old sequence unsafe to repeat');
});

test('power-cycle cache loss prevents assuming a repeated sequence is idempotent', () => {
  const device = createStatefulPf700();
  const credential = String(randomInt(100000, 1000000));
  const req = (seq, cmd, text, controls = []) => encodeRequest({sequence:seq,command:cmd,data:Buffer.from(text,'latin1'),allowedControls:controls});
  device.exchange(req(0x30,48,`2,${credential},1`));
  device.exchange(req(0x31,49,'Sample\t\xc2' + '75*1',[9]));
  device.exchange(req(0x32,53,'\t',[9]));
  device.resetCache();
  device.exchange(req(0x32,53,'\t',[9]));
  assert.equal(device.state.tenders,2);
});
