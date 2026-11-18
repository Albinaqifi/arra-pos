const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const bundle = require('./support/admin-bundle');
class Component { constructor(props) { this.props = props; } setState(patch) { Object.assign(this.state, patch); } }
const React = { Component, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
function text(node) { if (node == null || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); return (node.children || []).flat(Infinity).map(text).join(' '); }
function setup(service, language = 'en') {
  const confirms = [];
  const context = { React, TextEncoder, window: { arra: { legacyOrderAssignment: service }, confirm: msg => { confirms.push(msg); return true; } } };
  vm.runInNewContext(bundle(), context);
  return { page: new context.ArraComponents.LegacyOrderAssignment({ language }), confirms };
}
test('assignment confirms details and preserves the exact request until an unknown outcome resolves', async () => {
  const calls = []; let attempt = 0;
  const service = async req => {
    calls.push(JSON.parse(JSON.stringify(req)));
    if (req.action === 'list') return { ok: true, data: { orders: attempt === 3 ? [] : [{ orderId: 7, tableId: 4 }], waiters: [{ id: 11, name: 'Sample' }] } };
    attempt++; return attempt === 1 ? { ok: false, uncertain: true } : attempt === 2 ? { ok: false } : { ok: true };
  };
  const { page, confirms } = setup(service);
  await page.load(); Object.assign(page.state, { orderId: '7', waiterId: '11' });
  await page.submit(); assert.equal(page.leaveEditor(), false); assert.match(page.state.error, /uncertain/); assert.match(confirms[0], /Table 4.*Sample/);
  await page.submit(); assert.equal(page.leaveEditor(), false);
  await page.submit(); assert.equal(page.leaveEditor(), true); assert.match(page.state.notice, /Order assigned/);
  assert.deepEqual(calls.filter(x => x.action === 'assign'), Array(3).fill({ action: 'assign', orderId: 7, waiterId: 11 }));
  assert.equal(confirms.length, 1); assert.match(text(page.render()), /No existing orders need assignment/);
});
test('denial hides choices and Albanian view explains one-time assignment', async () => {
  const { page } = setup(async () => ({ ok: false }), 'sq');
  await page.load(); const denied = text(page.render()); assert.match(denied, /qasja u refuzua/); assert.doesNotMatch(denied, /Zgjidhni nje porosi/);
  page.state.error = ''; page.state.orders = [{ orderId: 7, tableId: 4 }]; page.state.waiters = [{ id: 11, name: 'Sample' }];
  const view = text(page.render()); assert.match(view, /vetem nje here/); assert.match(view, /Cakto porosine/); assert.match(view, /Sample/);
});
test('a pending request blocks duplicate clicks and late results do not update an unmounted page', async () => {
  let resolve; const waiting = new Promise(r => { resolve = r; }); let assigns = 0;
  const { page } = setup(async req => req.action === 'list' ? { ok: true, data: { orders: [{ orderId: 7, tableId: 4 }], waiters: [{ id: 11, name: 'Sample' }] } } : (assigns++, waiting));
  await page.load(); Object.assign(page.state, { orderId: '7', waiterId: '11' });
  const first = page.submit(); await page.submit(); assert.equal(assigns, 1); assert.equal(page.leaveEditor(), false);
  page.componentWillUnmount(); resolve({ ok: true }); await first; assert.equal(page.state.notice, '');
});
