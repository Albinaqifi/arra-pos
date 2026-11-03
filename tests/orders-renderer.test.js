const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('desktop opens and restores an order and reports an open failure', async () => {
  let saved = null, fail = false;
  const api = {
    getMenu: async () => ({ ok: true, data: { categories: [], products: [] } }),
    getTables: async () => ({ ok: true, data: [{ id: 1, area: 'Inside', orderId: saved?.id ?? null, openedAt: saved?.openedAt ?? null }] }),
    openOrder: async tableId => fail ? { ok: false } : { ok: true, data: saved ||= { id: 5, tableId, openedAt: Date.now() } }
  };
  class Component { setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } }
  const context = { React: { Component, createElement() {} }, ReactDOM: { createRoot() { return { render() {} }; } }, document: { getElementById() {} }, window: { arra: api }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'), 'utf8') + '\nthis.Demo = WaiterDemo;', context);
  const load = async () => { const app = new context.Demo(); app.componentDidMount(); await new Promise(resolve => setImmediate(resolve)); return app; };
  let app = await load();
  assert.equal(app.renderVals().sections[0].tables[0].free, true);
  await app.openTable(1);
  assert.equal(app.state.screen, 'order'); assert.equal(app.state.orders[1].id, 5);
  app.goTables(); assert.equal(app.renderVals().sections[0].tables[0].taken, true);
  app = await load(); assert.equal(app.renderVals().sections[0].tables[0].taken, true);
  await app.openTable(1); assert.equal(app.state.orders[1].id, 5);
  app.goTables(); fail = true; await app.openTable(1);
  assert.equal(app.state.screen, 'tables'); assert.match(app.state.toast.msg, /Could not open/);
});
