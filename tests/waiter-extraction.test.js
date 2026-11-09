const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('extracted waiter views connect table, order and move controls to the existing state', () => {
  class Component { setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } forceUpdate() {} }
  const React = { Component, Fragment: 'fragment', createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const context = { React, ArraComponents: {}, ReactDOM: { createRoot: () => ({ render() {} }) }, document: { getElementById() {} }, window: {}, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  for (const name of ['Tables', 'Order', 'MoveTable', 'MoveItems', 'Bill', 'DesktopBill']) vm.runInNewContext(fs.readFileSync(require.resolve('../src/waiter/' + name + '.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'), 'utf8') + '\nthis.Demo = WaiterDemo;', context);
  const app = new context.Demo();
  function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.children)]; }
  function label(node) { return (node.children || []).map(child => typeof child === 'string' ? child : child && typeof child === 'object' ? label(child) : '').join(''); }
  app.setState({ screen: 'tables' });
  let table = nodes(app.render()).find(n => n.type === 'button' && n.props['aria-label'] && n.props['aria-label'].startsWith('Table 1,'));
  assert.ok(table); table.props.onClick(); assert.equal(app.state.screen, 'order'); assert.equal(app.state.tableId, 1);
  let move = nodes(app.render()).find(n => n.type === 'button' && label(n).includes('Move whole table'));
  assert.ok(move); move.props.onClick(); assert.equal(app.state.modal.type, 'moveTable');
  const free = app.renderVals().mtTables.find(t => !t.disabled);
  let dest = nodes(app.render()).find(n => n.type === 'button' && n.props['aria-label'] === free.aria);
  assert.ok(dest); dest.props.onClick(); assert.equal(app.state.modal.dest, Number(free.num));
  app.setState({ modal: { type: 'moveItems', sel: {}, dest: null } });
  assert.ok(nodes(app.render()).some(n => n.type === 'button' && label(n).includes('Tick at least one item')));
  app.setState({ modal: { type: 'bill', step: 'method', method: null, account: null, printed: 0, backup: false } });
  const card = nodes(app.render()).find(n => n.type === 'button' && label(n).trim() === 'Card');
  assert.ok(card); card.props.onClick();
  assert.equal(app.state.modal.method, 'Card'); assert.equal(app.state.modal.account, 'A');
  assert.ok(nodes(app.render()).some(n => n.type === 'button' && label(n).includes('Print bill')));
});

