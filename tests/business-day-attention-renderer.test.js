const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function make(api) {
  class Component {
    constructor(props) { this.props = props; }
    setState(value) { Object.assign(this.state, value); }
  }
  const React = { Component, Fragment: 'fragment', createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const context = { React, window: { arra: api, confirm: () => true }, crypto: { randomUUID: () => 'test-token' } };
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  return context.ArraComponents;
}
function expand(node) {
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function' && !node.type.prototype?.render) return expand(node.type(node.props));
  return { ...node, children: (node.children || []).flat().map(expand) };
}
function nodes(node) {
  return !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flat().flatMap(nodes)];
}
const issues = { orders: [], printJobs: [] };
function fixture() {
  return { scope: 'combined', queue: 'sample', issues, days: [
    { id: 4, openedAt: 4000, closedAt: null },
    { id: 3, openedAt: 3000, closedAt: 4000, closedBy: 1, issues, reportId: 3, printAttempts: 1, printResult: 'failed', otherPrints: [{ scope: 'A', printAttempts: 2, printResult: 'failed' }, { scope: 'B', printAttempts: 1, printResult: 'accepted' }] },
    { id: 2, openedAt: 2000, closedAt: 3000, closedBy: 1, issues, reportId: 2, printAttempts: 0, printResult: null, otherPrints: [{ scope: 'B', printAttempts: 1, printResult: 'uncertain' }] },
  ] };
}

test('attention identifies each failed day and report without unrelated print actions', async () => {
  const calls = [], data = fixture();
  const c = make({ businessDays: async request => { calls.push(request); return request.action === 'list' ? { ok: true, data } : { ok: true }; }, financialVisibility: async () => ({ ok: true, data: { groups: [] } }) });
  const screen = new c.BusinessDays({});
  await screen.load();
  const tree = expand(screen.render());
  const cards = nodes(tree).filter(n => n.props?.className?.split(' ').includes('day-recovery-report'));
  assert.equal(cards.length, 3);
  const day3 = cards.filter(n => JSON.stringify(n).toLowerCase().includes('day #3'));
  const day2 = cards.find(n => JSON.stringify(n).toLowerCase().includes('day #2'));
  assert.equal(day3.length, 2); assert.ok(day2);
  assert.match(JSON.stringify(day3), /Combined report/);
  assert.match(JSON.stringify(day3), /Account A report/);
  assert.doesNotMatch(JSON.stringify(day3), /Account B report/);
  assert.match(JSON.stringify(day2), /Account B report/);
  assert.doesNotMatch(JSON.stringify(day2), /Combined report/);
  assert.equal(day3.flatMap(nodes).filter(n => n.type === 'button').length, 2);
  assert.equal(nodes(day2).filter(n => n.type === 'button').length, 1);
  await nodes(day2).find(n => n.type === 'button').props.onClick();
  const retry = calls.find(request => request.action === 'retry');
  assert.equal(retry.dayId, 2);
  assert.equal(retry.scope, 'B');
  assert.equal(retry.checked, true);
});

test('repeated failures keep the affected report visible until its latest result is accepted', async () => {
  const data = fixture();
  const c = make({ businessDays: async () => ({ ok: true, data }), financialVisibility: async () => ({ ok: true, data: { groups: [] } }) });
  const screen = new c.BusinessDays({});
  await screen.load();
  const cards = () => nodes(expand(screen.render())).filter(n => n.props?.className?.split(' ').includes('day-recovery-report'));
  const a = data.days[1].otherPrints[0];
  a.printAttempts = 3;
  await screen.load();
  assert.ok(cards().some(n => JSON.stringify(n).toLowerCase().includes('day #3') && JSON.stringify(n).includes('Account A report')));
  a.printResult = 'accepted';
  await screen.load();
  const day3 = JSON.stringify(cards().find(n => JSON.stringify(n).toLowerCase().includes('day #3')));
  assert.doesNotMatch(day3, /Account A report/);
  assert.match(day3, /Combined report/);
  assert.ok(cards().some(n => JSON.stringify(n).toLowerCase().includes('day #2')));
});
