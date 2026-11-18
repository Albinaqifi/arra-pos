const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { encodeRequest, decodeResponse } = require('../src/desktop/pf700-frame');
const commands = require('../src/desktop/pf700-commands');
const { openFiscalSimulation } = require('../src/desktop/fiscal-simulation');

function response(data) {
  const body = Buffer.concat([Buffer.from([0x2b + data.length, 0xff, 0x7f]), data, Buffer.from([4]), Buffer.alloc(6, 0xff), Buffer.from([5])]);
  const sum = [...body].reduce((a, b) => a + b, 0);
  const checksum = Buffer.from([12, 8, 4, 0].map(shift => 0x30 + ((sum >> shift) & 15)));
  return Buffer.concat([Buffer.from([1]), body, checksum, Buffer.from([3])]);
}

test('maximum documented response and checksum validation', () => {
  const frame = response(Buffer.alloc(84, 0xff));
  assert.equal(frame.length, 101);
  const result = decodeResponse(frame, {sequence:0xff, command:0x7f});
  assert.deepEqual(result.data, Buffer.alloc(84, 0xff));
  assert.deepEqual(result.status, Buffer.alloc(6, 0xff));
  assert.throws(() => decodeResponse(response(Buffer.alloc(85, 0xff)), {sequence:0xff, command:0x7f}));
  const changed = Buffer.from(frame); changed[4] ^= 1;
  assert.throws(() => decodeResponse(changed, {sequence:0xff, command:0x7f}));
});

test('simulation rejects invalid lifecycle operations without altering the prepared snapshot', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-independent-sim-'));
  const simulation = openFiscalSimulation(dir);
  t.after(() => { simulation.close(); fs.rmSync(dir, {recursive:true, force:true}); });
  const receipt = {paymentRef:'synthetic-1', method:'cash', account:'A', lines:[{name:'Item', unitMinor:10, quantity:2, taxGroup:'sample'}]};
  const id = simulation.prepareReceipt(receipt);
  assert.throws(() => simulation.finishSimulated(id, 'simulated_accept'));
  assert.throws(() => simulation.reserve(id + 1));
  assert.throws(() => simulation.prepareReceipt({...receipt, lines:[{...receipt.lines[0], quantity:0}]}));
  assert.throws(() => simulation.prepareReceipt({...receipt, lines:[{...receipt.lines[0], name:'bad\nname'}]}));
  assert.equal(simulation.get(id).state, 'prepared');
  assert.equal(simulation.get(id).payload.totalMinor, 20);
  simulation.reserve(id);
  assert.throws(() => simulation.finishSimulated(id, 'accepted'));
  assert.equal(simulation.get(id).state, 'uncertain');
});

test('command payload boundaries remain explicit and frame without rewriting', () => {
  const item = commands.sale({description:'x'.repeat(25), taxGroup:'D', price:'999999.99'});
  assert.equal(item.data.toString('ascii'), `${'x'.repeat(25)}\tD999999.99`);
  const frame = encodeRequest({sequence:0xff, ...item});
  assert.deepEqual(frame.subarray(4, -6), item.data);
  assert.equal(commands.total({mode:'debit', tendered:'0.01'}).data.toString('ascii'), '\tD0.01');
  for (const price of ['0.00', '9999999.99', '1.234', ' 1', '1\n'])
    assert.throws(() => commands.sale({description:'x', taxGroup:'A', price}));
  for (const option of ['01', '2N', ' 2', undefined]) assert.throws(() => commands.dailyReport({option}));
  assert.throws(() => commands.total({mode:'toString', tendered:'1'}));
});
