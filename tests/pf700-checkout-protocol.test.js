const test = require('node:test');
const assert = require('node:assert/strict');
const { randomInt } = require('node:crypto');
const { executePf700Checkout, registerSimulatedPf700Sale } = require('../src/desktop/pf700-checkout-protocol');
const { sections } = require('../src/desktop/arra-menu');

const coffee = { name: 'Çaj me Mjaltë', taxGroup: 'В', taxRate: 10, unitPrice: 70, quantity: 2 };
const beer = { name: 'Beer', taxGroup: 'А', taxRate: 18, unitPrice: 150, quantity: 1 };
const sale = { billId: 23, account: 'A', currency: 'MKD', method: 'cash', lines: [coffee, beer], total: 290 };
const operator = () => ({ firstSequence: 0x7d, operatorNumber: 1, tillNumber: 14,
  operatorPassword: String(randomInt(100000, 1000000)) });
const idle = Buffer.from('888080e1809a', 'hex');
const opened = Buffer.from('888088e1809a', 'hex');
const commands = [74, 76, 97, 113, 48, 49, 49, 51, 103, 53, 76, 56, 76, 113];
const data = [idle, '0,0001,+000000070,+000000070', '18.00,5.00,10.00,0.00', '0000045',
  '  27,0003', '', '', '290,150,0,140,0', '0,150,0,140,0', 'R+000000000', '1,0002,+000000290,+000000290',
  '0028,0003', '0,0002,+000000290,+000000290', '0000046'];

function reply(sequence, command, payload, status) {
  const bytes = Buffer.from(payload, 'latin1');
  const body = Buffer.concat([Buffer.from([43 + bytes.length, sequence, command]), bytes, Buffer.from([4]), status, Buffer.from([5])]);
  const sum = body.reduce((n, byte) => n + byte, 0).toString(16).padStart(4, '0');
  return Buffer.concat([Buffer.from([1]), body, Buffer.from([...sum].map(hex => 48 + parseInt(hex, 16))), Buffer.from([3])]);
}

function scenario(change = {}, responses = data) {
  const seen = [];
  function exchange(request) {
    const index = seen.length;
    const command = request[3];
    seen.push({ command, sequence: request[2], data: command === 48 ? null : request.subarray(4, -6) });
    if (change.fail === index) throw Error('Simulated lost reply');
    const status = index >= 4 && index <= 10 ? opened : idle;
    const frame = reply(request[2], command, index === change.index ? change.data ?? responses[index] : responses[index],
      index === change.index ? change.status ?? status : status);
    if (index === change.corrupt) frame[frame.length - 2] ^= 1;
    return frame;
  }
  return { seen, exchange };
}

test('fixed sequence emits split quantities, both verified tax bytes and explicit tender, then verifies receipt evidence', async () => {
  for (const [method, tender] of [['cash', 'P'], ['card', 'D']]) {
    const port = scenario();
    const settings = { ...operator(), beforeOpen() { assert.equal(port.seen.length, 4); } };
    const result = await executePf700Checkout({ ...sale, method }, settings, port.exchange);
    assert.deepEqual(result, { status: 'accepted', reference: '0000046',
      evidence: { documentNumber: '0000046', fiscalReceiptCount: 28, reversalCount: 3 } });
    assert.deepEqual(port.seen.map(s => s.command), commands);
    assert.deepEqual(port.seen.slice(0, 5).map(s => s.sequence), [0x7d, 0x7e, 0x7f, 0x20, 0x21]);
    assert.equal(port.seen[5].data.toString('hex'), '43616a206d65204d6a616c746509c237302a32');
    assert.equal(port.seen[6].data.toString('hex'), '4265657209c03135302a31');
    assert.equal(port.seen[9].data.toString(), '\t' + tender + '290');
    assert.equal(port.seen[11].data.length, 0);
  }
});

// The command 76 and 103 payloads are literal wire fixtures, independent of
// the simulator's formatter. The two taxable lines total 290 whole MKD.
const onsiteCommands = [74, 76, 97, 113, 48, 49, 49, 76, 103, 53, 76, 56, 76, 113];
const onsiteData = [idle, '0,0001,+000007000,+000007000', '18.00,5.00,10.00,0.00', '0000045',
  '  27,0003', '', '', '1,0002,+000029000,+000000000', '1,+000015000,+000000000,+000014000,+000000000',
  'D+000000000', '1,0002,+000029000,+000029000', '0028,0003', '0,0002,+000029000,+000029000', '0000046'];

test('identified on-site firmware checks unpaid, paid and closed receipts in hundredths and sends one tender', async () => {
  for (const [method, tender, zero] of [['cash', '\t', 'R+000000000'], ['card', '\tD290', 'D 0.00']]) {
    const port = scenario({ index: 9, data: zero }, onsiteData);
    const result = await executePf700Checkout({ ...sale, method }, { ...operator(), onsiteFirmware: true }, port.exchange);
    assert.deepEqual(result, { status: 'accepted', reference: '0000046',
      evidence: { documentNumber: '0000046', fiscalReceiptCount: 28, reversalCount: 3 } });
    assert.deepEqual(port.seen.map(s => s.command), onsiteCommands);
    assert.equal(port.seen[9].data.toString(), tender);
  }
});

test('on-site mismatches stop the sequence and never release a second tender or close', async () => {
  for (const [index, value] of [
    [7, '1,0002,+000000290,+000000000'], [7, '1,0002,+000029000,+000000001'],
    [7, '1,0003,+000029000,+000000000'], [7, '1,0002,+000029000,-000000000'],
    [8, '1,+000014000,+000000000,+000015000,+000000000'], [8, '1,+000000150,+000000000,+000000140,+000000000'],
    [8, '1,+000015000,+000000000,+000014001,+000000000'], [8, '0,+000015000,+000000000,+000014000,+000000000'],
    [8, '1,150.00,0.00,140.00,0.00'], [9, 'X+000000000'], [9, 'D+1'], [9, 'R-0'],
    [10, '1,0002,+000029000,+000000000'], [10, '1,0002,+000029000,+000028999'],
    [11, '0027,0003'], [11, '0028,0004'], [12, '1,0002,+000029000,+000029000'],
    [12, '0,0002,+000029000,+000000290'], [13, '0000047']
  ]) {
    const port = scenario({ index, data: value }, onsiteData);
    assert.deepEqual(await executePf700Checkout(sale, { ...operator(), onsiteFirmware: true }, port.exchange),
      { status: 'uncertain' });
    assert.deepEqual(port.seen.map(s => s.command), onsiteCommands.slice(0, index + 1));
  }
  for (let index = 4; index < onsiteCommands.length; index++) {
    const port = scenario({ fail: index }, onsiteData);
    assert.deepEqual(await executePf700Checkout(sale, { ...operator(), onsiteFirmware: true }, port.exchange),
      { status: 'uncertain' });
    assert.deepEqual(port.seen.map(s => s.command), onsiteCommands.slice(0, index + 1));
  }
});

test('a receipt must fit nine digits in hundredths before the on-site printer opens', async () => {
  const priced = total => ({ ...sale, lines: [{ ...coffee, quantity: 1, unitPrice: total }], total });
  assert.deepEqual(await registerSimulatedPf700Sale(priced(9999999)), { status: 'accepted', reference: 'SIM-23' });
  const port = scenario();
  assert.deepEqual(await executePf700Checkout(priced(10000000), { ...operator(), onsiteFirmware: true }, port.exchange),
    { status: 'failed' });
  assert.equal(port.seen.length, 0);
});

test('unknown or malformed preflight state, rates, permissions, or fiscal mode produce no opening command', async () => {
  const invalid = [
    { index: 0, data: Buffer.from('888180e1809a', 'hex') },
    { index: 1, data: '1,0000,+000000000,+000000000' },
    { index: 1, data: '0,0000,+000000000' },
    { index: 2, data: '18.00,10.00,5.00,0.00' },
    { index: 2, data: '18,5,10,?' },
    { index: 3, data: '9999999' }, { index: 3, data: '1' },
    { index: 0, status: Buffer.from('888080e18092', 'hex') }, // non-fiscal mode
    { index: 2, status: Buffer.from('88a080e1809a', 'hex') }, // cover open
    { index: 3, status: Buffer.from('888081e1809a', 'hex') }, // no paper
    { corrupt: 2 }, { fail: 0 }
  ];
  for (const change of invalid) {
    const port = scenario(change);
    assert.deepEqual(await executePf700Checkout(sale, operator(), port.exchange), { status: 'failed' });
    assert.ok(!port.seen.some(s => s.command === 48));
  }
  const port = scenario();
  assert.deepEqual(await executePf700Checkout(sale, { ...operator(), beforeOpen() { throw Error(); } }, port.exchange),
    { status: 'failed' });
  assert.equal(port.seen.length, 4);
});

test('after opening, rejection, mismatch or lost acknowledgement at any stage is uncertain and never replayed', async () => {
  for (const [index, value] of [
    [4, '01,02'], [5, 'F'], [7, '290,140,0,150,0'], [7, '290,27,0,13,0'],
    [8, '1,140,0,150,0'], [8, 'E,150,0,140,0'],
    [9, 'F'], [9, 'R+1'], [9, 'D+0'], [9, 'X+000000000'], [10, '1,0002,+000000290,+000000289'],
    [10, '0,0002,+000000290,+000000290'], [10, '1,0001,+000000290,+000000290'],
    [11, '0027,0003'], [11, '0028,0004'], [12, '1,0002,+000000290,+000000290'],
    [13, '0000045'], [13, '0000047']
  ]) {
    const port = scenario({ index, data: value });
    assert.deepEqual(await executePf700Checkout(sale, operator(), port.exchange), { status: 'uncertain' });
    assert.deepEqual(port.seen.map(s => s.command), commands.slice(0, index + 1));
  }
  for (let index = 4; index < commands.length; index++) {
    const port = scenario({ fail: index });
    assert.deepEqual(await executePf700Checkout(sale, operator(), port.exchange), { status: 'uncertain' });
    assert.equal(port.seen.length, index + 1);
  }
});

test('the optional domestic origin byte is explicit and confined to a single confirmed product', async () => {
  const single = { ...sale, lines: [coffee], total: 140 };
  for (const domesticProduct of [true, false]) {
    const port = scenario({ fail: 6 });
    assert.deepEqual(await executePf700Checkout(single, { ...operator(), domesticProduct }, port.exchange),
      { status: 'uncertain' });
    assert.equal(port.seen[5].data.subarray(-7).toString('hex'),
      domesticProduct ? '0940c237302a32' : '6509c237302a32');
  }
  for (const [snapshot, domesticProduct] of [[sale, true], [single, 'true'], [single, null]]) {
    const port = scenario();
    assert.deepEqual(await executePf700Checkout(snapshot, { ...operator(), domesticProduct }, port.exchange),
      { status: 'failed' });
    assert.equal(port.seen.length, 0);
  }
});

test('no frame for invalid checkout, unsupported names, excessive items or amount', async () => {
  const invalidLines = [
    { taxGroup: 'A' }, { taxRate: 18 }, { quantity: 1.5 }, { quantity: 0 },
    { unitPrice: -1 }, { unitPrice: 1.2 }, { unitPrice: 50000000 }, { name: 'X'.repeat(51) },
    { name: 'x\nY' }, { name: '€' }
  ];
  for (const invalid of [
    ...invalidLines.map(overrides => ({ ...sale, lines: [{ ...coffee, ...overrides }, beer] })),
    { ...sale, billId: 0 }, { ...sale, total: 291 }, { ...sale, account: 'B' }, { ...sale, method: 'N' },
    { ...sale, currency: 'EUR' }, { ...sale, lines: [] }, { ...sale, lines: Array(513).fill(coffee) }
  ]) {
    const port = scenario();
    assert.deepEqual(await executePf700Checkout(invalid, operator(), port.exchange), { status: 'failed' });
    assert.equal(port.seen.length, 0);
  }
});

test('simulator issues only SIM references and handles the full two-line label and 512 item bound', async () => {
  const longLine = { ...coffee, name: 'Muskat Temjanika e bardhë 0.70 l' };
  for (const method of ['cash', 'card']) {
    assert.deepEqual(await registerSimulatedPf700Sale({ ...sale, method, lines: [longLine, beer] }),
      { status: 'accepted', reference: 'SIM-23' });
  }
  assert.deepEqual(await registerSimulatedPf700Sale({ ...sale, lines: Array(512).fill(coffee), total: 512 * 140 }),
    { status: 'accepted', reference: 'SIM-23' });
});

test('all 105 packaged product names fit the two-line profile, including wine size suffixes and Albanian accents', async () => {
  const lines = sections.flatMap(([, products], index) => products.map(([name, unitPrice]) => ({
    name, unitPrice, quantity: 1, taxGroup: index < 12 ? 'В' : 'А', taxRate: index < 12 ? 10 : 18
  })));
  assert.equal(lines.filter(line => line.taxGroup === 'В').length, 89);
  assert.equal(lines.filter(line => line.taxGroup === 'А').length, 16);
  const total = lines.reduce((sum, line) => sum + line.unitPrice, 0);
  assert.deepEqual(await registerSimulatedPf700Sale({ ...sale, lines, total }), { status: 'accepted', reference: 'SIM-23' });
});
