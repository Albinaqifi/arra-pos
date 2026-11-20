// By default exercise the transformation on RC2. With --packaged exercise the
// actual renderer shipped inside the restaurant ZIP.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { patchRenderer } = require('./renderer.cjs');
const packaged = process.argv[2] === '--packaged';
const input = fs.readFileSync(process.argv[packaged ? 3 : 2]);
const patched = packaged ? input.toString('utf8') : patchRenderer(input);
const startup = 'startRenderer(() => Promise.resolve().then(() => (init_App(), App_exports)));';
assert.ok(patched.includes(startup));
const compiled = new vm.Script(patched.replace(startup,
  'init_DesktopBill(); init_AccountABills(); globalThis.Bill = DesktopBill; globalThis.Preview = AccountABills;'));

const preview = { fastPayVersion: 1, orderId: 4, total: 100, fingerprint: 'a'.repeat(64),
  lines: [{ itemId: 1, name: 'Coffee', quantity: 2, unitPrice: 50, modifiers: [] }] };
const savedBill = { ...preview, id: 7 };
const success = selection => ({ ok: true, data: { ...selection, id: 9, receiptStatus: 'queued' } });

function fixture({ data = savedBill, generate, payment = success, language = 'en' } = {}) {
  const calls = [], events = [];
  let current = true;
  const api = {
    bill: async request => {
      calls.push({ ...request });
      return request.action === 'review' ? { ok: true, data } : generate ? generate(request) : { ok: true, data: savedBill };
    },
    payment: async request => { calls.push({ ...request }); return payment(request); },
  };
  class Component {
    constructor(props) { this.props = props; }
    setState(patch) { Object.assign(this.state, patch); }
  }
  const context = { React: { Component, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) }, window: { arra: api } };
  compiled.runInNewContext(context);
  const instance = new context.Bill({
    orderId: 4, language, isCurrent: () => current, beginOperation: kind => { events.push('begin ' + kind); return kind; },
    endOperation: lease => events.push('end ' + lease), onUncertain: value => events.push('uncertain ' + value),
    onClose: () => events.push('close'), onConfirmed: () => events.push('confirmed'), onPaid: () => events.push('paid'),
  });
  return { instance, calls, events, Admin: context.Preview, invalidate() { current = false; } };
}
function walk(node) {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== 'object') return [node];
  return [node, ...node.children.flatMap(walk)];
}
function button(instance, label) {
  return walk(instance.render()).find(n => n?.type === 'button' && (n.children.includes(label) || n.props['aria-label'] === label));
}
function click(instance, label) {
  const control = button(instance, label);
  assert.ok(control && !control.props.disabled, label + ' should be enabled');
  return control.props.onClick();
}

for (const [label, method] of [['Cash A', 'cash'], ['Card A', 'card']]) {
  test(label + ' generates the reviewed bill and pays with one action', async () => {
    const { instance, calls, events } = fixture({ data: preview });
    await instance.review();
    assert.equal(button(instance, 'Pay').props.disabled, true);
    click(instance, label);
    assert.ok(walk(instance.render()).includes('2 × Coffee · 100 den'));
    await click(instance, 'Pay');
    assert.deepEqual(calls, [{ action: 'review', orderId: 4 }, { action: 'generate', orderId: 4, fingerprint: preview.fingerprint },
      { billId: 7, method, account: 'A', fastPay: true }]);
    assert.deepEqual(events.slice(-4), ['confirmed', 'uncertain false', 'end payment', 'paid']);
  });
}
test('in-flight clicks and a lost payment reply preserve the same selection and hand off once', async () => {
  let release, attempts = 0;
  const { instance, calls, events } = fixture({ payment: async request => {
    if (++attempts === 1) return new Promise((_, reject) => { release = () => reject(Error('Synthetic lost reply')); });
    return success(request);
  } });
  await instance.review();
  click(instance, 'Card A');
  const waiting = click(instance, 'Pay');
  const duplicate = instance.payFast();
  instance.close();
  instance.selectMethod('cash', 'B');
  assert.equal(attempts, 1);
  release();
  await Promise.all([waiting, duplicate]);
  assert.equal(button(instance, 'Cash A').props.disabled, true);
  assert.equal(button(instance, 'Close').props.disabled, true);
  await click(instance, 'Retry');
  assert.deepEqual(calls.slice(1), Array(2).fill({ billId: 7, method: 'card', account: 'A', fastPay: true }));
  assert.equal(events.filter(event => event === 'paid').length, 1);
});
test('unmatched success and denied or definite failures keep the table open', async () => {
  for (const response of [{ ok: true }, { ok: true, data: { ...success({ billId: 8, account: 'A', method: 'cash' }).data } },
    { ok: false, error: 'Access denied' }, { ok: false, error: 'Could not record payment. Retry the same selection.' }]) {
    const { instance, events } = fixture({ payment: () => response });
    await instance.review();
    click(instance, 'Cash A');
    await click(instance, 'Pay');
    assert.ok(instance.state.error);
    assert.equal(instance.state.uncertain, response.ok);
    assert.ok(!events.includes('paid'));
    if (response.error === 'Access denied') assert.equal(instance.state.data, null);
  }
});
test('a fingerprint conflict requires fresh review and sends no payment', async () => {
  const { instance, calls } = fixture({ data: preview, generate: () => ({ ok: false, error: 'Order changed; review the bill again' }) });
  await instance.review();
  click(instance, 'Cash A');
  await click(instance, 'Pay');
  assert.deepEqual(calls.map(r => r.action), ['review', 'generate']);
  assert.ok(button(instance, 'Review again'));
  assert.equal(button(instance, 'Pay'), undefined);
});
test('legacy fiscal records never expose Pay or printer/terminal actions', async () => {
  for (const legacy of [{ fastPayLegacyHeld: true }, { physicalCashIntent: { id: 1 } }, { physicalCardIntent: { id: 2 } }, { physicalCardHold: true },
    { fiscal: { status: 'submitted' } }, { fiscal: { status: 'accepted' } }, { simulatedCardIntent: { id: 3 } }]) {
    const { instance, calls } = fixture({ data: { ...savedBill, ...legacy } });
    await instance.review();
    assert.ok(!button(instance, 'Pay'));
    assert.ok(button(instance, 'Reload saved bill'));
    assert.equal(button(instance, 'Select Cash B').props.disabled, true);
    instance.selectMethod('card', 'A');
    await instance.payFast();
    assert.equal(calls.length, 1);
  }
});
test('a hold acquired after review or during bill generation blocks every tender', async () => {
  for (const options of [
    { payment: () => ({ ok: false, fiscalStatus: 'blocked' }) },
    { data: preview, generate: () => ({ ok: true, data: { ...savedBill, physicalCardHold: true } }) },
  ]) {
    const { instance, events } = fixture(options);
    await instance.review(); click(instance, 'Card A'); await click(instance, 'Pay');
    assert.ok(!button(instance, 'Pay'));
    assert.ok(!events.includes('paid'));
    assert.equal(button(instance, 'Select Cash B').props.disabled, true);
  }
});
test('the waiter sees the fiscal setup error and the bill stays open', async () => {
  for (const [status, fragment] of [['unmapped','VAT group'],['origin','Macedonian-product mark'],
    ['scope','enrolled printer'],['unavailable','items or amounts']]) {
    const f = fixture({ payment: () => ({ ok: false, fiscalStatus: status }) });
    await f.instance.review();
    click(f.instance, 'Cash A');
    await click(f.instance, 'Pay');
    assert.ok(walk(f.instance.render()).some(node => typeof node === 'string' && node.includes(fragment)));
    assert.ok(!f.events.includes('paid'));
  }
});
test('late payment results never dismiss a new identity', async () => {
  let resolve;
  const { instance, events, invalidate } = fixture({ payment: selection => new Promise(r => { resolve = () => r(success(selection)); }) });
  await instance.review(); click(instance, 'Cash A');
  const waiting = click(instance, 'Pay');
  invalidate(); resolve(); await waiting;
  assert.ok(!events.includes('paid') && !events.includes('confirmed'));
  assert.equal(events.at(-1), 'end payment');
});
test('Cash B preserves the installed payment request and Albanian renders tender labels', async () => {
  const { instance, calls, events } = fixture({ payment: () => ({ ok: true, data: { id: 11 } }) });
  await instance.review(); click(instance, 'Select Cash B'); await click(instance, 'Pay');
  assert.deepEqual(calls.at(-1), { billId: 7, method: 'cash', account: 'B' });
  assert.equal(events.at(-1), 'paid');
  const sq = fixture({ language: 'sq' }).instance;
  await sq.review(); click(sq, 'Kartë A'); await click(sq, 'Paguaj');
  assert.equal(sq.confirmed, true);
});
test('unmarked bills use the original RC2 module and mismatched kits are rejected', async () => {
  const data = { ...savedBill };
  delete data.fastPayVersion;
  const { instance } = fixture({ data });
  await instance.review();
  assert.ok(button(instance, 'Cash'));
  assert.ok(!button(instance, 'Cash A'));
  const mismatched = Buffer.concat([input, Buffer.from('\n')]);
  assert.throws(() => patchRenderer(mismatched), /Expected the original RC2/);
  assert.throws(() => patchRenderer(mismatched, true), /Expected the Cash B Bar RC3/);
});
test('Account A preview shows receipt state only on enriched rows and a verified document on acknowledgement', () => {
  const { Admin } = fixture();
  const admin = new Admin({ language: 'en' });
  admin.state = { data: { days: [] }, preview: { id: 3, total: 400, cash: 300, card: 100,
    records: [{ billId: 1, amount: 100 }, { billId: 2, amount: 100, receiptStatus: 'queued' },
      { billId: 3, amount: 100, receiptStatus: 'unconfirmed', documentNumber: '0000001' },
      { billId: 4, amount: 100, receiptStatus: 'acknowledged', documentNumber: '0000002' }] } };
  const labels = walk(admin.render()).filter(v => typeof v === 'string' && v.includes('Fiscal receipt'));
  assert.deepEqual(labels, ['Fiscal receipt queued', 'Fiscal receipt unconfirmed', 'Fiscal receipt acknowledged · 0000002']);
});
