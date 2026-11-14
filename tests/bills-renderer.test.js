const { arrange, routeOf } = require('./support/renderer-fixture');
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');

test('desktop bill review displays amounts and modifiers, decline leaves no bill, and confirmation generates it', async () => {
  const calls = [], preview = { orderId: 5, tableId: 1, total: 460, fingerprint: 'a'.repeat(64), lines: [{ itemId: 1, name: 'Dish snapshot', unitPrice: 230, quantity: 2, modifiers: [{ groupName: 'Size', optionName: 'Large', adjustment: 10 }] }] };
  const api = { bill: async request => { calls.push(request); return { ok: true, data: request.action === 'review' ? preview : { ...preview, id: 7 } }; } };
  class Component { constructor(props) { this.props = props; } setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } }
  const React = { Component, Fragment: 'fragment', createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const context = { React, ArraComponents: {}, ReactDOM: { createRoot() { return { render() {} }; } }, document: { getElementById() {} }, window: { arra: api }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(require('./support/waiter-views')() + '\n' + require('./support/renderer-bundle')() + '\nthis.Demo = WaiterDemo; this.Bill = DesktopBill;', context);
  const find = (n, predicate) => { if (!n || typeof n !== 'object') return null; if (predicate(n)) return n; for (const child of n.children || []) for (const c of Array.isArray(child) ? child : [child]) { const found = find(c, predicate); if (found) return found; } return null; };
  const button = (tree, text) => find(tree, n => n.type === 'button' && n.children.includes(text));
  const app = new context.Demo(); arrange(app, { screen: 'order', tableId: 1, orders: { 1: { id: 5, openedAt: 1, rounds: 1, log: [] } } });
  app.billing.open(); let element = find(app.render(), n => n.type === context.Bill); assert.ok(element);
  let bill = new element.type(element.props); bill.componentDidMount(); await new Promise(setImmediate);
  let tree = bill.render(); assert.ok(find(tree, n => n.type === 'li' && n.children.some(c => typeof c === 'string' && c.includes('2 × Dish snapshot · 460 den'))));
  assert.ok(find(tree, n => n.type === 'div' && n.children.includes('Size: Large (10)'))); assert.ok(find(tree, n => n.type === 'strong' && n.children.includes('Total: 460 den')));
  button(tree, 'No, go back').props.onClick(); assert.equal(app.billing.state.desktop, null); assert.equal(app.demoBilling.state.dialog, null); assert.deepEqual(calls.map(x => x.action), ['review']);
  app.billing.open(); element = find(app.render(), n => n.type === context.Bill); bill = new element.type(element.props); bill.componentDidMount(); await new Promise(setImmediate);
  await button(bill.render(), 'Generate bill').props.onClick(); tree = bill.render(); assert.ok(find(tree, n => n.type === 'h2' && n.children.includes('Bill generated #7')));
  assert.equal(calls.at(-1).action, 'generate'); assert.equal(calls.at(-1).fingerprint, preview.fingerprint); assert.equal(button(tree, 'Generate bill'), null);
});
