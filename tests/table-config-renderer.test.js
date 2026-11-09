const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('manage tables navigation opens configuration and returns to refreshed grid', async () => {
  let loads = 0, configLoads = 0;
  const api = {
    getMenu: async () => ({ ok: true, data: { categories: [], products: [] } }),
    getTables: async () => { loads++; return { ok: true, data: [] }; },
    tableConfig: async request => { assert.equal(request.action, 'list'); configLoads++; return { ok: true, data: { areas: [], tables: [] } }; }
  };
  class Component { constructor(props) { this.props = props; } setState(update) { Object.assign(this.state, update); } }
  const React = { Component, Fragment: 'fragment', createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
  const context = { React, ReactDOM: { createRoot() { return { render() {} }; } }, document: { getElementById() {} }, window: { arra: api }, setInterval() {}, clearInterval() {}, clearTimeout() {} };
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'), 'utf8') + '\nthis.Demo = WaiterDemo; this.Config = ArraComponents.TableConfig;', context);
  const app = new context.Demo(); app.componentDidMount(); app.setState({ screen: 'tables', adminAccess: true });
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of node.children || []) {
      for (const item of Array.isArray(child) ? child : [child]) { const found = find(item, predicate); if (found) return found; }
    }
    return null;
  };
  const button = find(app.render(), node => node.type === 'button' && node.children.includes('Administration →'));
  assert.ok(button); button.props.onClick();
  let shell = app.render(); const overview = shell.type(shell.props);
  find(overview, node => node.type === 'button' && JSON.stringify(node.children).includes('Areas and tables')).props.onClick();
  shell = app.render(); const configElement = shell.children[0]; assert.equal(configElement.type, context.Config);
  const config = new configElement.type(configElement.props); config.componentDidMount();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(configLoads, 1);
  assert.ok(find(config.render(), node => node.type === 'h1' && node.children.includes('Areas and tables')));
  configElement.props.onBack(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.state.screen, 'admin');
  shell = app.render(); shell.props.back(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.state.screen, 'tables'); assert.equal(loads, 1);
  assert.ok(find(app.render(), node => node.type === 'button' && node.children.includes('Administration →')));
});
