const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('history renders corrected and unpaid details, empty results, and failed refresh', async () => {
  let fail = false;
  const bill = { id: 7, orderId: 8, tableId: 9, openedAt: 10, actorId: 11, generatedAt: 12, total: 100 };
  const api = { financialVisibility: async request => {
    if (fail && request.action === 'unpaid') return { ok: false };
    if (request.action === 'search') return { ok: true, data: [] };
    if (request.action === 'aggregate') return { ok: true, data: { count: 0, total: 0 } };
    if (request.action === 'unpaid') return { ok: true, data: [] };
    if (request.action === 'unpaidDetail') return { ok: true, data: { bill, lines: [] } };
    return { ok: true, data: { bill, lines: [], payment: { id: 1, actorId: 2, paidAt: 30, method: 'cash', amount: 100, originalAccount: 'B', account: 'A' }, corrections: [{ id: 3, actorId: 4, occurredAt: 40, fromAccount: 'B', toAccount: 'A', reason: 'sample reason' }] } };
  }};
  class Component { constructor(props) { this.props = props; } setState(update) { Object.assign(this.state, update); } }
  const React = { Component, Fragment: 'fragment', createElement(type, props, ...children) { return { type, children }; } };
  const context = { React, ReactDOM: { createRoot: () => ({ render() {} }) }, document: { getElementById() {} }, window: { arra: api }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'), 'utf8') + '\nthis.Financial = FinancialVisibility;', context);
  const screen = new context.Financial({ onBack() {} });
  const text = node => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.children) : String(node || '');
  await screen.load();
  assert.match(text(screen.render()), /No payments\./);
  assert.match(text(screen.render()), /No unpaid bills\./);
  await screen.detail(1);
  const paid = text(screen.render());
  for (const expected of ['Bill #7', 'Order #8', 'actor #11', 'actor #2', 'Original account B', 'Effective account A', 'Correction #3', 'Actor #4', 'sample reason']) assert.ok(paid.includes(expected), expected);
  await screen.unpaidDetail(7);
  assert.match(text(screen.render()), /Bill #7.*Unpaid/);
  fail = true;
  await screen.load();
  assert.match(text(screen.render()), /Financial information unavailable/);
  assert.equal(screen.state.detail, null);
  assert.equal(screen.state.totals, null);
});
