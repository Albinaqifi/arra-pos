const { arrange, routeOf } = require('./support/renderer-fixture');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('extracted waiter views connect table, order and move controls to the existing state', () => {
  class Component { setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } forceUpdate() {} }
  const React = { Component, Fragment: 'fragment', createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const context = { React, ArraComponents: {}, ReactDOM: { createRoot: () => ({ render() {} }) }, document: { getElementById() {} }, window: {}, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  for (const name of ['Tables', 'Order', 'MoveTable', 'Bill', 'DesktopBill']) vm.runInNewContext(require('./support/renderer-bundle')(), context);
  vm.runInNewContext(require('./support/renderer-bundle')() + '\nthis.Demo = WaiterDemo;', context);
  const app = new context.Demo();
  function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.children)]; }
  function label(node) { return (node.children || []).map(child => typeof child === 'string' ? child : child && typeof child === 'object' ? label(child) : '').join(''); }
  const sampleOrders = app.tableOrders.state.orders;
  arrange(app, { screen: 'order', tableId: 1, orders: {} });
  const emptyMove = nodes(app.render()).find(n => n.type === 'button' && label(n).includes('Move whole table'));
  assert.equal(emptyMove.props.disabled, true);
  assert.equal(emptyMove.props.style.background, '#F8FAFC');
  arrange(app, { screen: 'tables', orders: sampleOrders });
  let table = nodes(app.render()).find(n => n.type === 'button' && n.props['aria-label'] && n.props['aria-label'].startsWith('Table 1,'));
  assert.ok(table); table.props.onClick(); assert.equal(routeOf(app), 'order'); assert.equal(app.tableOrders.state.tableId, 1);
  arrange(app, { orders: { ...app.tableOrders.state.orders, 1: { openedAt: 1, rounds: 0, log: [] } } });
  let move = nodes(app.render()).find(n => n.type === 'button' && label(n).includes('Move whole table'));
  assert.ok(move); assert.equal(move.props.disabled, false); assert.equal(move.props.style.background, '#F5F3FF'); move.props.onClick(); assert.equal(app.moveWorkflow.view().isMoveTable, true);
  const free = app.moveWorkflow.view().mtTables.find(t => !t.disabled);
  let dest = nodes(app.render()).find(n => n.type === 'button' && n.props['aria-label'] === free.aria);
  assert.ok(dest); dest.props.onClick(); assert.equal(app.moveWorkflow.state.dialog.dest, Number(free.num));
  arrange(app, { modal: null });
  assert.equal(nodes(app.render()).some(n => n.type === 'button' && label(n).includes('Move items')), false);
  arrange(app, { modal: { type: 'bill', step: 'method', method: null, account: null, printed: 0, backup: false } });
  const card = nodes(app.render()).find(n => n.type === 'button' && label(n).trim() === 'Card');
  assert.ok(card); card.props.onClick();
  assert.equal(app.demoBilling.state.dialog.method, 'Card'); assert.equal(app.demoBilling.state.dialog.account, 'A');
  assert.ok(nodes(app.render()).some(n => n.type === 'button' && label(n).includes('Print bill')));
});

